#!/usr/bin/env node
// Bench harness for src/main/markdown-to-tiptap.ts.
//
// Flow:
//   1. esbuild bundles the current source of markdown-to-tiptap.ts into a
//      temp ESM file so we always measure the agent's latest edits.
//   2. Imports the bundle. Runs a correctness check against corpus.md using
//      a SHA-256 hash of the produced JSON. If the hash does not match the
//      golden snapshot the iteration fails with a huge SCORE (makes it clearly
//      worse than baseline so the comparator rejects it).
//   3. Warms up for 0.5s, then measures mean ns/char over a fixed wall-clock
//      budget. Emits `SCORE=<ns_per_char>` — lower is better.
//
// Usage:
//   node benchmark/bench.mjs           # full bench
//   node benchmark/bench.mjs --record  # rewrites golden.json from current output
//
// Exit codes:
//   0   — wrote SCORE=<n>
//   1   — build failed / no output / no corpus
//
// Wall-clock budget: ~2s of measurement; dominated by the loop, not startup.

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import esbuild from 'esbuild'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')
const targetSrc = join(repoRoot, 'src', 'main', 'markdown-to-tiptap.ts')
const corpusPath = join(here, 'corpus.md')
const goldenPath = join(here, 'golden.json')
const outDir = join(here, '.build')
const outFile = join(outDir, 'markdown-to-tiptap.mjs')

const args = new Set(process.argv.slice(2))
const RECORD = args.has('--record')

if (!existsSync(targetSrc)) {
  console.error(`ERROR: target not found: ${targetSrc}`)
  console.error('SCORE=999999')
  process.exit(1)
}
if (!existsSync(corpusPath)) {
  console.error(`ERROR: corpus not found: ${corpusPath}`)
  console.error('SCORE=999999')
  process.exit(1)
}

if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })

try {
  await esbuild.build({
    entryPoints: [targetSrc],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    outfile: outFile,
    logLevel: 'silent',
    external: [] // bundle marked too so the agent's edits + tree are self-contained
  })
} catch (e) {
  console.error('esbuild failed:', e.message ?? e)
  console.log('SCORE=999999')
  process.exit(0)
}

const mod = await import(`file://${outFile}?t=${Date.now()}`)
const markdownToTiptap = mod.markdownToTiptap
if (typeof markdownToTiptap !== 'function') {
  console.error('markdownToTiptap export not found on built module')
  console.log('SCORE=999999')
  process.exit(0)
}

const corpus = readFileSync(corpusPath, 'utf-8')

// Generate a FRESH input on every call. Per-call unique suffix means any
// input-keyed cache has 0% hit rate — matches real usage (users never parse
// the same note twice in a tight loop). The suffix is tiny vs the base corpus
// so measured cost is dominated by parsing the base, not the suffix itself.
function makeInput(i) {
  return corpus + `\n\n## variant ${i}\n\nUnique perturbation token ${i}-${(i * 0x9e3779b1) >>> 0}.\n`
}

// --- Correctness check ------------------------------------------------------
// We hash ONLY the base corpus's output (not the perturbed pool) so the golden
// snapshot stays stable across bench edits. The pool is purely for throughput.
let result
try {
  result = markdownToTiptap(corpus)
} catch (e) {
  console.error('markdownToTiptap threw on corpus:', e.message ?? e)
  console.log('SCORE=999999')
  process.exit(0)
}
const canonical = canonicalize(result)
const actualHash = createHash('sha256').update(canonical).digest('hex')

if (RECORD) {
  writeFileSync(goldenPath, JSON.stringify({ hash: actualHash, sampleChars: canonical.length }, null, 2))
  console.log(`recorded golden: hash=${actualHash} chars=${canonical.length}`)
  // Still print a SCORE so runners don't blow up if they pipe bench.mjs in --record mode.
  console.log('SCORE=0')
  process.exit(0)
}

if (!existsSync(goldenPath)) {
  console.error('no golden.json yet — run: node benchmark/bench.mjs --record')
  console.log('SCORE=999999')
  process.exit(0)
}

const golden = JSON.parse(readFileSync(goldenPath, 'utf-8'))
if (golden.hash !== actualHash) {
  console.error(
    `CORRECTNESS FAILED — output hash changed.\n  expected: ${golden.hash}\n  actual:   ${actualHash}\n` +
      'If the semantics change is intentional, rerun with --record to update the golden.'
  )
  console.log('SCORE=999999')
  process.exit(0)
}

// --- Throughput measurement -------------------------------------------------
// Warmup: 0.5s with per-call unique inputs so JIT sees varied token streams.
const warmupDeadline = performance.now() + 500
let _warmupSink = 0
let warmupI = 0
while (performance.now() < warmupDeadline) {
  const r = markdownToTiptap(makeInput(warmupI++))
  _warmupSink += r.content?.length ?? 0
}
if (_warmupSink < 0) throw new Error('unreachable')

// Measure: 2s wall-clock with fresh input each call — no cache can hit.
const corpusBytes = Buffer.byteLength(corpus, 'utf-8')
const measureDeadline = performance.now() + 2000
let iters = 0
let totalChars = 0
const start = performance.now()
while (performance.now() < measureDeadline) {
  const inp = makeInput(warmupI + iters) // offset so we don't reuse warmup keys
  totalChars += inp.length
  markdownToTiptap(inp)
  iters++
}
const elapsedMs = performance.now() - start

const nsPerChar = (elapsedMs * 1_000_000) / totalChars
const msPerCall = elapsedMs / iters
const charsPerSec = (totalChars / (elapsedMs / 1000)) | 0

console.log(`iters=${iters} elapsed=${elapsedMs.toFixed(1)}ms corpus=${corpus.length}ch (${corpusBytes}B) fresh-per-call`)
console.log(`mean ${msPerCall.toFixed(3)}ms/call  ${charsPerSec.toLocaleString()} ch/s`)
console.log(`SCORE=${nsPerChar.toFixed(2)}`)

// Clean up bundle
try { rmSync(outDir, { recursive: true, force: true }) } catch { /* noop */ }

// ── helpers ───────────────────────────────────────────────

function canonicalize(obj) {
  // Stable JSON: sorted keys at every level. Ensures hash reflects semantic
  // content, not property ordering of the agent's output.
  return JSON.stringify(obj, (_k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const out = {}
      for (const k of Object.keys(v).sort()) out[k] = v[k]
      return out
    }
    return v
  })
}
