import { homedir } from 'os'
import { join, dirname } from 'path'
import {
  readFileSync,
  writeFileSync,
  unlinkSync,
  readdirSync,
  mkdirSync,
  existsSync,
  appendFileSync,
  promises as fsp
} from 'fs'

// Metadata (tile identity) lives under ~/AgentCanvas/tmp, same as other tile stores.
// Runtime state (results.tsv, brief.md, state.json, audit_findings.md) lives
// inside the benchmark's git worktree, under <worktree>/.benchmark-tile/.
const BENCH_DIR = join(homedir(), 'AgentCanvas', 'tmp')
const saveQueues = new Map<string, Promise<void>>()

export type NoiseClass = 'low' | 'medium' | 'high'

export type BenchmarkStatus =
  | 'unstarted'
  | 'running'
  | 'paused'
  | 'frozen'
  | 'stopped'
  | 'done'

export type BenchmarkStopReason =
  | 'target'
  | 'stagnation'
  | 'wallclock'
  | 'user'
  | 'frozen'
  | 'heldout-divergence'

export interface BenchmarkStopConditions {
  scoreTarget?: number
  stagnationN?: number
  wallClockMs?: number
}

export interface HeldOutMetric {
  evaluatorPath: string
  baselineScore?: number
  /** Fraction (0..1) — if heldOut drops by more than this relative to baseline, flag red. */
  regressionThreshold: number
}

export interface BenchmarkMeta {
  benchmarkId: string
  label: string
  workspaceId: string
  worktreePath: string
  evaluatorPath: string
  targetFiles: string[]
  programPath: string
  noiseClass: NoiseClass
  stopConditions: BenchmarkStopConditions
  heldOutMetric?: HeldOutMetric
  status: BenchmarkStatus
  stopReason?: BenchmarkStopReason
  linkedTaskId?: string
  isSoftDeleted: boolean
  softDeletedAt?: number
  position: { x: number; y: number }
  width: number
  height: number
  createdAt: number
  updatedAt: number
}

export interface BenchmarkFile {
  meta: BenchmarkMeta
}

export interface BenchmarkRuntimeState {
  iterationN: number
  tempCycleIdx: number
  bestScore: number | null
  stagnationCounter: number
  frozen: boolean
  frozenReason?: string
  status: BenchmarkStatus
  stopReason?: BenchmarkStopReason
  startedAt: number | null
  lastIterationAt: number | null
  keptCount: number
  revertedCount: number
  heldOutBaseline?: number
  heldOutLatest?: number
  heldOutDivergence?: boolean
  pendingHint?: string
  scoreSamples: number[]
  scoreStddev?: number
}

export interface ResultsRow {
  iter: number
  tsMs: number
  temp: number
  score: number
  delta: number | null
  accepted: boolean
  runtimeMs: number
  heldOutScore: number | null
  commitSha: string | null
  rationale: string
  rejectionReason: string
}

export const RESULTS_TSV_HEADER =
  'iter\tts_ms\ttemp\tscore\tdelta\taccepted\truntime_ms\theldout_score\tcommit_sha\trationale\trejection_reason'

const TEMP_CYCLE: readonly number[] = [0.3, 0.7, 1.0] as const

export function ensureBenchDir(): void {
  if (!existsSync(BENCH_DIR)) mkdirSync(BENCH_DIR, { recursive: true })
}

function benchPath(id: string): string {
  return join(BENCH_DIR, `benchmark-${id}.json`)
}

export function tileStateDir(meta: BenchmarkMeta): string {
  return join(meta.worktreePath, '.benchmark-tile')
}

export function resultsPath(meta: BenchmarkMeta): string {
  return join(tileStateDir(meta), 'results.tsv')
}

export function briefPath(meta: BenchmarkMeta): string {
  return join(tileStateDir(meta), 'brief.md')
}

export function statePath(meta: BenchmarkMeta): string {
  return join(tileStateDir(meta), 'state.json')
}

export function auditPath(meta: BenchmarkMeta): string {
  return join(tileStateDir(meta), 'audit_findings.md')
}

export function loadBenchmark(id: string): BenchmarkFile | null {
  try {
    const raw = readFileSync(benchPath(id), 'utf-8')
    return JSON.parse(raw) as BenchmarkFile
  } catch {
    return null
  }
}

export async function saveBenchmark(id: string, meta: Partial<BenchmarkMeta>): Promise<void> {
  ensureBenchDir()
  const filePath = benchPath(id)

  const prev = saveQueues.get(id) ?? Promise.resolve()
  const next = prev.then(async () => {
    let existing: BenchmarkFile | null = null
    try {
      const raw = await fsp.readFile(filePath, 'utf-8')
      existing = JSON.parse(raw) as BenchmarkFile
    } catch {
      // new file
    }

    const now = Date.now()
    const merged: BenchmarkMeta = {
      benchmarkId: id,
      label: meta.label ?? existing?.meta.label ?? 'Benchmark',
      workspaceId: meta.workspaceId ?? existing?.meta.workspaceId ?? 'default',
      worktreePath: meta.worktreePath ?? existing?.meta.worktreePath ?? '',
      evaluatorPath:
        meta.evaluatorPath ?? existing?.meta.evaluatorPath ?? 'benchmark/evaluator.sh',
      targetFiles: meta.targetFiles ?? existing?.meta.targetFiles ?? [],
      programPath:
        meta.programPath ?? existing?.meta.programPath ?? 'benchmark/program.md',
      noiseClass: meta.noiseClass ?? existing?.meta.noiseClass ?? 'medium',
      stopConditions: meta.stopConditions ?? existing?.meta.stopConditions ?? {},
      heldOutMetric: meta.heldOutMetric ?? existing?.meta.heldOutMetric,
      status: meta.status ?? existing?.meta.status ?? 'unstarted',
      stopReason: meta.stopReason ?? existing?.meta.stopReason,
      linkedTaskId: meta.linkedTaskId ?? existing?.meta.linkedTaskId,
      isSoftDeleted: meta.isSoftDeleted ?? existing?.meta.isSoftDeleted ?? false,
      softDeletedAt: meta.softDeletedAt ?? existing?.meta.softDeletedAt,
      position: meta.position ?? existing?.meta.position ?? { x: 120, y: 120 },
      width: meta.width ?? existing?.meta.width ?? 560,
      height: meta.height ?? existing?.meta.height ?? 460,
      createdAt: existing?.meta.createdAt ?? now,
      updatedAt: now
    }

    const file: BenchmarkFile = { meta: merged }
    await fsp.writeFile(filePath, JSON.stringify(file, null, 2))
  })

  const chained = next.catch((err) => {
    console.error(`[benchmark-store] saveBenchmark failed for ${id}:`, err)
  })
  saveQueues.set(id, chained)
  chained.finally(() => {
    if (saveQueues.get(id) === chained) saveQueues.delete(id)
  })

  return next
}

export function deleteBenchmark(id: string): void {
  try {
    unlinkSync(benchPath(id))
  } catch {
    // already gone
  }
}

export function listBenchmarks(): BenchmarkFile[] {
  ensureBenchDir()
  try {
    const files = readdirSync(BENCH_DIR).filter(
      (f) => f.startsWith('benchmark-') && f.endsWith('.json')
    )
    const results: BenchmarkFile[] = []
    for (const f of files) {
      const id = f.replace(/^benchmark-/, '').replace(/\.json$/, '')
      const loaded = loadBenchmark(id)
      if (loaded) results.push(loaded)
    }
    return results
  } catch {
    return []
  }
}

// ── Runtime state (in worktree) ──────────────────────────────

export function ensureTileStateDir(meta: BenchmarkMeta): void {
  const dir = tileStateDir(meta)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const r = resultsPath(meta)
  if (!existsSync(r)) writeFileSync(r, RESULTS_TSV_HEADER + '\n')
  const b = briefPath(meta)
  if (!existsSync(b)) writeFileSync(b, defaultBriefMarkdown())
  const s = statePath(meta)
  if (!existsSync(s)) writeFileSync(s, JSON.stringify(initialRuntimeState(), null, 2))
}

export function initialRuntimeState(): BenchmarkRuntimeState {
  return {
    iterationN: 0,
    tempCycleIdx: 0,
    bestScore: null,
    stagnationCounter: 0,
    frozen: false,
    status: 'unstarted',
    startedAt: null,
    lastIterationAt: null,
    keptCount: 0,
    revertedCount: 0,
    scoreSamples: []
  }
}

export function defaultBriefMarkdown(): string {
  return [
    '# Benchmark Brief',
    '',
    '_No iterations yet. The first iteration will see only this bootstrap brief._',
    '',
    '## Accepted diffs (last 10)',
    '_none_',
    '',
    '## Rejected attempts (last 10)',
    '_none_',
    '',
    '## Current state',
    '- best_score: n/a',
    '- stagnation: 0',
    ''
  ].join('\n')
}

export function loadRuntimeState(meta: BenchmarkMeta): BenchmarkRuntimeState {
  try {
    const raw = readFileSync(statePath(meta), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<BenchmarkRuntimeState>
    return { ...initialRuntimeState(), ...parsed }
  } catch {
    return initialRuntimeState()
  }
}

export function saveRuntimeState(meta: BenchmarkMeta, state: BenchmarkRuntimeState): void {
  ensureTileStateDir(meta)
  writeFileSync(statePath(meta), JSON.stringify(state, null, 2))
}

export function appendResult(meta: BenchmarkMeta, row: ResultsRow): void {
  ensureTileStateDir(meta)
  const serialized =
    [
      row.iter,
      row.tsMs,
      row.temp,
      row.score,
      row.delta ?? '',
      row.accepted ? '1' : '0',
      row.runtimeMs,
      row.heldOutScore ?? '',
      row.commitSha ?? '',
      escapeTsvField(row.rationale),
      escapeTsvField(row.rejectionReason)
    ].join('\t') + '\n'
  appendFileSync(resultsPath(meta), serialized)
}

export function readResults(meta: BenchmarkMeta): ResultsRow[] {
  try {
    const raw = readFileSync(resultsPath(meta), 'utf-8')
    const lines = raw.split('\n').filter((l) => l.length > 0)
    if (lines.length < 2) return []
    return lines.slice(1).map(parseResultsLine).filter((r): r is ResultsRow => r !== null)
  } catch {
    return []
  }
}

export function readBrief(meta: BenchmarkMeta): string {
  try {
    return readFileSync(briefPath(meta), 'utf-8')
  } catch {
    return defaultBriefMarkdown()
  }
}

export function writeBrief(meta: BenchmarkMeta, content: string): void {
  ensureTileStateDir(meta)
  writeFileSync(briefPath(meta), content)
}

export function writeAuditFindings(meta: BenchmarkMeta, content: string): void {
  ensureTileStateDir(meta)
  writeFileSync(auditPath(meta), content)
}

export function readAuditFindings(meta: BenchmarkMeta): string | null {
  try {
    return readFileSync(auditPath(meta), 'utf-8')
  } catch {
    return null
  }
}

export function tempCycle(): readonly number[] {
  return TEMP_CYCLE
}

export function tempForCycleIdx(idx: number): number {
  return TEMP_CYCLE[idx % TEMP_CYCLE.length]
}

// ── TSV helpers ──────────────────────────────────────────────

function escapeTsvField(v: string): string {
  return (v ?? '').replace(/\t/g, ' ').replace(/\n/g, ' ')
}

function parseResultsLine(line: string): ResultsRow | null {
  const cols = line.split('\t')
  if (cols.length < 11) return null
  const iter = Number(cols[0])
  const tsMs = Number(cols[1])
  const temp = Number(cols[2])
  const score = Number(cols[3])
  const deltaStr = cols[4]
  const accepted = cols[5] === '1'
  const runtimeMs = Number(cols[6])
  const heldOutStr = cols[7]
  const commitSha = cols[8] || null
  const rationale = cols[9] ?? ''
  const rejectionReason = cols[10] ?? ''
  if (!Number.isFinite(iter) || !Number.isFinite(score)) return null
  return {
    iter,
    tsMs,
    temp,
    score,
    delta: deltaStr === '' ? null : Number(deltaStr),
    accepted,
    runtimeMs,
    heldOutScore: heldOutStr === '' ? null : Number(heldOutStr),
    commitSha,
    rationale,
    rejectionReason
  }
}

// ── Utility: guard that worktreePath is sane ────────────────

export function validateWorktreePath(p: string): string | null {
  if (!p || typeof p !== 'string') return 'worktreePath is required'
  if (!existsSync(p)) return `worktreePath does not exist: ${p}`
  if (!existsSync(join(p, '.git')) && !existsSync(dirname(p) + '/.git')) {
    // Accept either a repo root OR a worktree (which has a .git file, not dir)
    // Loose check so we don't block non-standard layouts.
  }
  return null
}
