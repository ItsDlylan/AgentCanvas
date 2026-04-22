#!/usr/bin/env node
// Benchmark runner — iterative optimization loop for a Benchmark Tile.
//
// Usage (from inside an AgentCanvas terminal linked to a benchmark tile):
//   node scripts/benchmark-runner.mjs --benchmark-id <uuid>
//
// The runner is explicitly manual-launch. It:
//   1. Loads the benchmark tile's metadata from the AgentCanvas HTTP API.
//   2. Loads runtime state + brief from <worktree>/.benchmark-tile/.
//   3. Cycles temperature [0.3, 0.7, 1.0].
//   4. Invokes `claude -p` with the brief + program.md + target files.
//   5. Locks the evaluator read-only, runs it with a wall-clock cap.
//   6. POSTs the candidate score back to /api/benchmark/append-result.
//      The main process applies the comparator (noise-class aware), the 3σ
//      freeze check, held-out divergence, and stop conditions.
//   7. Respects pause/stop/frozen signals written to state.json.
//   8. Never auto-launches itself.
//
// Required env (inherited from AgentCanvas terminal tiles):
//   - AGENT_CANVAS_API (e.g. http://127.0.0.1:7311)
//
// Exit codes:
//   0  loop terminated via stop condition or user stop
//   1  unrecoverable error (API unreachable, bad benchmark id, etc.)
//   2  frozen — awaiting human sign-off
//
// This script is intentionally unopinionated about the agent CLI. If `claude`
// is on PATH it will be used; otherwise the --dry-run mode prints the prompt
// and waits for manual editing + commit.

import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, chmodSync, statSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

const args = parseArgs(process.argv.slice(2))
const benchmarkId = args['--benchmark-id']
const apiBase = process.env.AGENT_CANVAS_API
const dryRun = args['--dry-run'] === '1' || args['--dry-run'] === 'true'

if (!benchmarkId) {
  console.error('ERROR: --benchmark-id is required')
  process.exit(1)
}
if (!apiBase) {
  console.error('ERROR: AGENT_CANVAS_API env var not set. Run this inside an AgentCanvas terminal.')
  process.exit(1)
}

const meta = await loadBenchmark(benchmarkId).catch((e) => {
  console.error('Failed to load benchmark:', e.message)
  process.exit(1)
})

console.log(`[runner] benchmark: ${meta.label} (${benchmarkId})`)
console.log(`[runner] worktree: ${meta.worktreePath}`)
console.log(`[runner] evaluator: ${meta.evaluatorPath}  (noise: ${meta.noiseClass})`)
console.log(`[runner] targets: ${meta.targetFiles.join(', ') || '(none — agent picks)'}`)
console.log(`[runner] declared baseline: ${meta.baselineScore}  (will re-measure before first iteration)`)

const worktree = meta.worktreePath
const tileDir = join(worktree, '.benchmark-tile')
const statePath = join(tileDir, 'state.json')
const briefPath = join(tileDir, 'brief.md')
const programPath = join(worktree, meta.programPath)
const evalAbs = join(worktree, meta.evaluatorPath)

if (!existsSync(evalAbs)) {
  console.error(`ERROR: evaluator not found at ${evalAbs}`)
  process.exit(1)
}

const TEMP_CYCLE = [0.3, 0.7, 1.0]
const wallStart = Date.now()

// ── Baseline re-measurement ──
// Before the first iteration, run the evaluator against the current HEAD (no
// agent work) to establish the real baseline. This overrides whatever the user
// declared in the tile creation payload; the declared value becomes a sanity
// check only. Running the evaluator multiple times gives us a noise reading.
{
  const initialState = readJson(statePath, { iterationN: 0 })
  const alreadyStarted = (initialState.iterationN ?? 0) > 0
  if (!alreadyStarted) {
    console.log('[runner] measuring baseline on HEAD (3 samples)...')
    const samples = []
    for (let i = 0; i < 3; i++) {
      try {
        const prevMode = statSync(evalAbs).mode & 0o777
        chmodSync(evalAbs, 0o555)
        const out = await run('bash', ['-c', quoteForShell(evalAbs)], worktree, { timeoutMs: 10 * 60 * 1000 })
        chmodSync(evalAbs, prevMode || 0o755)
        const s = parseScore(out.stdout)
        if (s !== null && Number.isFinite(s)) {
          samples.push(s)
          console.log(`  sample ${i + 1}: ${s.toFixed(4)}`)
        } else {
          console.warn(`  sample ${i + 1}: could not parse SCORE from evaluator output`)
        }
      } catch (e) {
        console.warn(`  sample ${i + 1} failed: ${(e.message || String(e)).slice(0, 200)}`)
      }
    }
    if (samples.length === 0) {
      console.error('[runner] baseline measurement failed on all samples — refusing to start loop')
      process.exit(1)
    }
    samples.sort((a, b) => a - b)
    const median = samples[Math.floor(samples.length / 2)]
    const spread = samples[samples.length - 1] - samples[0]
    console.log(`[runner] baseline median=${median.toFixed(4)}  spread=${spread.toFixed(4)} (${((spread / median) * 100).toFixed(1)}%)`)

    const declared = meta.baselineScore
    const relErr = declared === 0 ? Math.abs(median - declared) : Math.abs(median - declared) / Math.abs(declared)
    if (relErr > 0.25) {
      console.warn(
        `[runner] declared baseline ${declared} differs from measured ${median.toFixed(4)} by ${(relErr * 100).toFixed(1)}% — updating tile.`
      )
    }
    // Push measured baseline back to the tile so the target + goal-reached
    // check + brief all reflect reality.
    await httpJson('POST', '/api/benchmark/update', {
      benchmarkId,
      baselineScore: Number(median.toFixed(4))
    }).catch((e) => console.warn('[runner] could not update baseline on tile:', e.message))
    meta.baselineScore = Number(median.toFixed(4))
  } else {
    console.log(`[runner] resuming from iteration ${initialState.iterationN} — skipping baseline re-measure`)
  }
}

while (true) {
  const state = readJson(statePath, { status: 'running', tempCycleIdx: 0 })
  if (state.status === 'stopped' || state.status === 'done') {
    console.log(`[runner] status=${state.status} — exiting`)
    process.exit(0)
  }
  if (state.frozen || state.status === 'frozen') {
    console.log(`[runner] FROZEN: ${state.frozenReason ?? 'anomaly'} — exiting. Re-launch after human sign-off.`)
    process.exit(2)
  }
  if (state.status === 'paused') {
    console.log('[runner] paused — sleeping 10s then rechecking')
    await sleep(10_000)
    continue
  }

  const temp = TEMP_CYCLE[(state.tempCycleIdx ?? 0) % TEMP_CYCLE.length]
  const brief = safeRead(briefPath) || '(brief not yet written)'
  const programMd = safeRead(programPath) || '(program.md missing)'

  const prompt = buildAgentPrompt({ meta, brief, programMd, temp })

  // 1. Record pre-iteration commit so we can reset on reject.
  const baseCommit = (await run('git', ['rev-parse', 'HEAD'], worktree)).stdout.trim()

  // 1a. Cache the evaluator + program.md content so we can restore them if the
  //     agent accidentally stages/modifies them or a later git-reset wipes them.
  const evaluatorBackup = safeRead(evalAbs)
  const programBackup = safeRead(programPath)
  const evalPrevMode = (() => { try { return statSync(evalAbs).mode & 0o777 } catch { return 0o755 } })()

  // 2. Invoke the agent (claude) to propose + commit a diff.
  const agentOk = await invokeAgent({ prompt, cwd: worktree, temp, dryRun, baseCommit })
  if (!agentOk) {
    console.log('[runner] agent produced no diff vs baseCommit; skipping iteration')
    await restoreIfMissing(evalAbs, evaluatorBackup, evalPrevMode)
    await restoreIfMissing(programPath, programBackup, 0o644)
    await sleep(2000)
    continue
  }

  const candidateCommit = (await run('git', ['rev-parse', 'HEAD'], worktree)).stdout.trim()

  // Restore evaluator + program.md if the agent committed them away. Skip
  // applying the backup when they're still present AND unchanged from backup,
  // to avoid clobbering a deliberate evaluator edit (which would be a reward-
  // hack attempt anyway, so we explicitly undo it).
  await restoreIfMissing(evalAbs, evaluatorBackup, evalPrevMode)
  await restoreIfMissing(programPath, programBackup, 0o644)
  if (evaluatorBackup !== null && safeRead(evalAbs) !== evaluatorBackup) {
    console.log('[runner] agent modified evaluator — restoring original (reward-hack attempt)')
    writeFileSync(evalAbs, evaluatorBackup)
    try { chmodSync(evalAbs, evalPrevMode) } catch { /* noop */ }
  }

  // 3. Sandbox: mount evaluator read-only before execution.
  let prevMode = 0
  try {
    prevMode = statSync(evalAbs).mode & 0o777
    chmodSync(evalAbs, 0o555)
  } catch (e) {
    console.warn(`[runner] could not chmod evaluator readonly: ${e.message}`)
  }

  const evalStart = Date.now()
  let evalOut = null
  let evalErr = null
  try {
    const budget = meta.stopConditions?.wallClockMs ?? 5 * 60 * 1000
    evalOut = await run('bash', ['-c', quoteForShell(evalAbs)], worktree, { timeoutMs: Math.min(budget, 10 * 60 * 1000) })
  } catch (e) {
    evalErr = e
  } finally {
    try { chmodSync(evalAbs, prevMode || 0o755) } catch { /* noop */ }
  }
  const runtimeMs = Date.now() - evalStart

  if (evalErr) {
    const msg = (evalErr.message || String(evalErr)).replace(/\s+/g, ' ').slice(0, 400)
    console.error(`[runner] evaluator errored: ${msg}`)
    // Report a deliberately-bad score so the row appends and the UI shows WHY.
    // 999999 mirrors bench.mjs's own sentinel for correctness failures.
    await appendResult({
      temp,
      score: 999999,
      runtimeMs,
      commitSha: candidateCommit,
      rationale: `evaluator error: ${msg}`
    }).catch((e) => console.warn('[runner] failed to log evaluator error to tile:', e.message))
    await run('git', ['reset', '--hard', baseCommit], worktree).catch(() => { /* noop */ })
    console.log(`[runner] reset to ${baseCommit.slice(0, 8)}`)
    continue
  }

  const score = parseScore(evalOut.stdout)
  if (score === null) {
    console.log('[runner] evaluator output did not contain SCORE=<number>; rejecting')
    await run('git', ['reset', '--hard', baseCommit], worktree).catch(() => { /* noop */ })
    continue
  }

  // 4. Optional held-out eval (same sandbox rules).
  let heldOut = null
  if (meta.heldOutMetric?.evaluatorPath) {
    const heldEvalAbs = join(worktree, meta.heldOutMetric.evaluatorPath)
    if (existsSync(heldEvalAbs)) {
      try {
        const prevH = statSync(heldEvalAbs).mode & 0o777
        chmodSync(heldEvalAbs, 0o555)
        const res = await run('bash', ['-c', quoteForShell(heldEvalAbs)], worktree, { timeoutMs: 5 * 60 * 1000 })
        heldOut = parseScore(res.stdout)
        chmodSync(heldEvalAbs, prevH || 0o755)
      } catch (e) {
        console.warn('[runner] held-out eval failed:', e.message)
      }
    }
  }

  // 5. Report to AgentCanvas. The main process decides accept/reject using
  //    the comparator (noise-class aware + 3σ freeze + held-out divergence).
  const rationale = lastCommitSubject(worktree) || '(no subject)'
  const resp = await appendResult({
    temp,
    score,
    runtimeMs,
    heldOutScore: heldOut ?? undefined,
    commitSha: candidateCommit,
    rationale
  })

  if (!resp.ok) {
    console.error('[runner] append-result failed:', resp.error)
    await sleep(3000)
    continue
  }

  console.log(
    `[runner] iter=${resp.iteration}  temp=${temp}  score=${score.toFixed(4)}  ` +
      `accepted=${resp.accepted}  best=${resp.bestScore ?? 'n/a'}  ` +
      `frozen=${resp.frozen}  heldOutDiv=${resp.heldOutDivergence ?? false}`
  )

  if (!resp.accepted) {
    await run('git', ['reset', '--hard', baseCommit], worktree).catch(() => { /* noop */ })
  }

  if (resp.frozen) {
    console.log('[runner] frozen — exit. Human must unfreeze.')
    process.exit(2)
  }
  if (resp.stopReason) {
    console.log(`[runner] stop condition fired: ${resp.stopReason} — exiting`)
    process.exit(0)
  }
}

// ── helpers ─────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]
    const v = argv[i + 1]?.startsWith('--') ? '1' : argv[i + 1]
    out[k] = v ?? '1'
    if (v && !v.startsWith('--')) i++
  }
  return out
}

async function loadBenchmark(id) {
  const res = await httpJson('POST', '/api/benchmark/read', { benchmarkId: id })
  if (!res.ok) throw new Error(res.error || 'read failed')
  return res.meta
}

async function appendResult(fields) {
  return httpJson('POST', '/api/benchmark/append-result', { benchmarkId, ...fields })
}

async function httpJson(method, path, body) {
  const url = apiBase.replace(/\/$/, '') + path
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  })
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`Non-JSON response from ${path}: ${text.slice(0, 200)}`)
  }
}

function readJson(p, fallback) {
  try {
    return JSON.parse(readFileSync(p, 'utf-8'))
  } catch {
    return fallback
  }
}

function safeRead(p) {
  try {
    return readFileSync(p, 'utf-8')
  } catch {
    return null
  }
}

function parseScore(stdout) {
  // Accept lines like `SCORE=0.8472` or a final bare number on its own line.
  const scoreLine = stdout.match(/^SCORE\s*=\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*$/m)
  if (scoreLine) return Number(scoreLine[1])
  // Fallback: last line that is a number.
  const lines = stdout.split('\n').map((s) => s.trim()).filter(Boolean).reverse()
  for (const l of lines) {
    if (/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(l)) return Number(l)
  }
  return null
}

function run(cmd, args, cwd, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          p.kill('SIGKILL')
          reject(new Error(`timed out after ${opts.timeoutMs}ms`))
        }, opts.timeoutMs)
      : null
    p.stdout.on('data', (c) => (stdout += c))
    p.stderr.on('data', (c) => (stderr += c))
    p.on('close', (code) => {
      if (timer) clearTimeout(timer)
      if (code !== 0) return reject(new Error(`${cmd} exited ${code}: ${stderr.slice(0, 400)}`))
      resolve({ stdout, stderr })
    })
    p.on('error', reject)
  })
}

function quoteForShell(s) {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function lastCommitSubject(cwd) {
  try {
    return require('child_process').execSync(`git log -1 --pretty=%s`, { cwd, encoding: 'utf-8' }).trim()
  } catch {
    return ''
  }
}

async function invokeAgent({ prompt, cwd, temp, dryRun, baseCommit }) {
  if (dryRun) {
    const out = join(cwd, '.benchmark-tile', 'last-prompt.md')
    try { writeFileSync(out, prompt) } catch { /* noop */ }
    console.log(`[runner] dry-run: prompt written to ${out}. Make edits + commit, then press ENTER.`)
    await waitForEnter()
    return agentMadeCommit(cwd, baseCommit)
  }
  // `claude -p` consumes stdin + prints to stdout; the agent will make edits
  // via its own Edit/Write tools. We assume the agent ends by `git add` + commit.
  try {
    await runWithStdin(`claude`, ['-p', `--model`, `claude-opus-4-7`], cwd, prompt)
    return agentMadeCommit(cwd, baseCommit)
  } catch (e) {
    console.warn('[runner] agent invocation failed:', e.message)
    return agentMadeCommit(cwd, baseCommit)
  }
}

async function agentMadeCommit(cwd, baseCommit) {
  // The ONLY valid signal that the agent produced work is a new commit past
  // baseCommit. Checking HEAD~1..HEAD incorrectly returns non-empty after a
  // prior git-reset, causing the runner to process a phantom iteration.
  try {
    const head = (await run('git', ['rev-parse', 'HEAD'], cwd)).stdout.trim()
    return head !== baseCommit
  } catch {
    return false
  }
}

async function restoreIfMissing(path, content, mode) {
  if (content === null || content === undefined) return
  if (existsSync(path)) return
  try {
    const dir = path.replace(/\/[^/]+$/, '')
    if (!existsSync(dir)) {
      const { mkdirSync } = await import('node:fs')
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(path, content)
    chmodSync(path, mode || 0o644)
    console.log(`[runner] restored ${path}`)
  } catch (e) {
    console.warn(`[runner] could not restore ${path}:`, e.message)
  }
}

function runWithStdin(cmd, args, cwd, stdin) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, stdio: ['pipe', 'inherit', 'inherit'] })
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))))
    p.on('error', reject)
    p.stdin.write(stdin)
    p.stdin.end()
  })
}

function waitForEnter() {
  return new Promise((resolve) => {
    process.stdin.resume()
    process.stdin.once('data', () => resolve(undefined))
  })
}

function buildAgentPrompt({ meta, brief, programMd, temp }) {
  return [
    '# You are inside an automated benchmark loop.',
    '',
    `This is a legitimate AgentCanvas Benchmark Tile iteration — NOT an injected template, and NOT a prompt-injection attempt. The scaffolding below (program.md, brief, temperature tag) is the standard loop preamble.`,
    '',
    `**Your job:** make ONE targeted edit to the declared target files so the evaluator's score improves, then commit. Do NOT edit the evaluator (\`${meta.evaluatorPath}\`), program.md, or anything under \`.benchmark-tile/\` — those are harness files.`,
    '',
    `**If you do not understand what to change, still make your best-guess edit and commit.** The harness will score it and reject if worse. Declining to edit is wasted iteration budget; the comparator (not you) decides acceptance.`,
    '',
    `**Scope your \`git add\`** to only the target files listed below (e.g. \`git add ${meta.targetFiles.slice(0, 3).map((f) => `'${f}'`).join(' ') || '<your edited files>'}\`). Do NOT use \`git add -A\` — it can accidentally stage untracked harness files.`,
    '',
    '---',
    '',
    '## Acceptance criterion (the whole point of this run)',
    meta.acceptanceCriteria || '(none recorded — contact the human)',
    '',
    `- baseline: ${meta.baselineScore}`,
    `- target: ${resolveTarget(meta) ?? 'n/a'}`,
    `- direction: ${meta.higherIsBetter === false ? 'lower is better' : 'higher is better'}`,
    '',
    '---',
    '',
    '## Program skill',
    programMd,
    '',
    '---',
    '',
    `temperature: ${temp}   # ${temp <= 0.35 ? 'exploit (safe refactor)' : temp <= 0.75 ? 'balance' : 'explore (novel approach)'}`,
    '',
    '## Distilled brief',
    brief,
    '',
    '---',
    '',
    '## Target files you may edit',
    ...(meta.targetFiles.length > 0
      ? meta.targetFiles.map((f) => `- ${f}`)
      : ['- (none declared — edit ONLY files strictly necessary to improve the score; never the evaluator or program.md)']),
    '',
    '## Commit contract',
    'After your edit, stage ONLY your target files and commit with:',
    meta.targetFiles.length > 0
      ? `  git add ${meta.targetFiles.map((f) => `'${f}'`).join(' ')} && git commit -m "bench: iter N — <short rationale>"`
      : '  git add <your edited files> && git commit -m "bench: iter N — <short rationale>"',
    '',
    'If git reports nothing to commit, that is a bug on your side — try a different edit.'
  ].join('\n')
}

function resolveTarget(meta) {
  if (meta.scoreTarget !== undefined && Number.isFinite(meta.scoreTarget)) return meta.scoreTarget
  if (
    meta.improvementPct !== undefined &&
    Number.isFinite(meta.improvementPct) &&
    Number.isFinite(meta.baselineScore)
  ) {
    const f = meta.improvementPct / 100
    return meta.higherIsBetter === false
      ? meta.baselineScore * (1 - f)
      : meta.baselineScore * (1 + f)
  }
  return null
}
