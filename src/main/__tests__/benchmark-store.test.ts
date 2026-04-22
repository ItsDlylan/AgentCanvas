/**
 * Tests for benchmark-store (results.tsv round-trip, metadata persistence).
 *
 * Overrides HOME *before* import so writes land in a tempdir.
 *
 * Run with:
 *   npx vitest run src/main/__tests__/benchmark-store.test.ts
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const tempHome = mkdtempSync(join(tmpdir(), 'bench-store-test-'))
process.env.HOME = tempHome

/* eslint-disable @typescript-eslint/no-require-imports */
const store = require('../benchmark-store') as typeof import('../benchmark-store')

// Fake worktree for runtime state tests
const worktree = mkdtempSync(join(tmpdir(), 'bench-worktree-test-'))

afterAll(() => {
  for (const d of [tempHome, worktree]) {
    try { rmSync(d, { recursive: true, force: true }) } catch { /* noop */ }
  }
})

function makeMeta(id: string): import('../benchmark-store').BenchmarkMeta {
  return {
    benchmarkId: id,
    label: 'Test',
    workspaceId: 'default',
    worktreePath: worktree,
    evaluatorPath: 'benchmark/evaluator.sh',
    targetFiles: ['src/foo.ts'],
    programPath: 'benchmark/program.md',
    noiseClass: 'low',
    stopConditions: {},
    status: 'unstarted',
    isSoftDeleted: false,
    position: { x: 0, y: 0 },
    width: 560,
    height: 460,
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
}

describe('benchmark-store — metadata persistence', () => {
  it('saveBenchmark + loadBenchmark round-trip', async () => {
    const id = 'bench-123'
    await store.saveBenchmark(id, makeMeta(id))
    const loaded = store.loadBenchmark(id)
    expect(loaded).not.toBeNull()
    expect(loaded!.meta.benchmarkId).toBe(id)
    expect(loaded!.meta.label).toBe('Test')
    expect(loaded!.meta.noiseClass).toBe('low')
  })

  it('listBenchmarks returns all saved', async () => {
    await store.saveBenchmark('b-a', makeMeta('b-a'))
    await store.saveBenchmark('b-b', makeMeta('b-b'))
    const all = store.listBenchmarks()
    const ids = all.map((b) => b.meta.benchmarkId)
    expect(ids).toContain('b-a')
    expect(ids).toContain('b-b')
  })

  it('deleteBenchmark removes file', async () => {
    await store.saveBenchmark('b-del', makeMeta('b-del'))
    store.deleteBenchmark('b-del')
    expect(store.loadBenchmark('b-del')).toBeNull()
  })

  it('partial saves merge with existing meta', async () => {
    const id = 'bench-merge'
    await store.saveBenchmark(id, makeMeta(id))
    await store.saveBenchmark(id, { benchmarkId: id, label: 'Renamed' })
    const loaded = store.loadBenchmark(id)!
    expect(loaded.meta.label).toBe('Renamed')
    expect(loaded.meta.evaluatorPath).toBe('benchmark/evaluator.sh') // preserved
  })
})

describe('benchmark-store — runtime state on disk', () => {
  it('ensureTileStateDir creates dir + seed files', () => {
    const meta = makeMeta('b-rt')
    store.ensureTileStateDir(meta)
    const rows = store.readResults(meta)
    expect(rows).toEqual([])
    const brief = store.readBrief(meta) || ''
    expect(brief).toMatch(/Benchmark Brief/)
  })

  it('appendResult + readResults round-trip', () => {
    const meta = makeMeta('b-rows')
    store.ensureTileStateDir(meta)
    store.appendResult(meta, {
      iter: 1,
      tsMs: 1000,
      temp: 0.3,
      score: 0.5,
      delta: null,
      accepted: true,
      runtimeMs: 100,
      heldOutScore: null,
      commitSha: 'abc',
      rationale: 'seed',
      rejectionReason: ''
    })
    store.appendResult(meta, {
      iter: 2,
      tsMs: 2000,
      temp: 0.7,
      score: 0.52,
      delta: 0.02,
      accepted: true,
      runtimeMs: 200,
      heldOutScore: 0.4,
      commitSha: 'def',
      rationale: 'good',
      rejectionReason: ''
    })
    const rows = store.readResults(meta)
    expect(rows).toHaveLength(2)
    expect(rows[0].iter).toBe(1)
    expect(rows[1].accepted).toBe(true)
    expect(rows[1].delta).toBeCloseTo(0.02)
    expect(rows[1].heldOutScore).toBe(0.4)
    expect(rows[1].commitSha).toBe('def')
  })

  it('escapes tabs and newlines in rationale', () => {
    const meta = makeMeta('b-esc')
    store.ensureTileStateDir(meta)
    store.appendResult(meta, {
      iter: 1,
      tsMs: 1000,
      temp: 0.3,
      score: 0.5,
      delta: null,
      accepted: true,
      runtimeMs: 100,
      heldOutScore: null,
      commitSha: 'abc',
      rationale: 'line one\twith tab\nand newline',
      rejectionReason: ''
    })
    const rows = store.readResults(meta)
    expect(rows).toHaveLength(1)
    expect(rows[0].rationale).not.toContain('\t')
    expect(rows[0].rationale).not.toContain('\n')
  })

  it('saveRuntimeState + loadRuntimeState round-trip', () => {
    const meta = makeMeta('b-rs')
    store.ensureTileStateDir(meta)
    const state = {
      ...store.initialRuntimeState(),
      iterationN: 5,
      bestScore: 0.7,
      keptCount: 3,
      revertedCount: 2
    }
    store.saveRuntimeState(meta, state)
    const loaded = store.loadRuntimeState(meta)
    expect(loaded.iterationN).toBe(5)
    expect(loaded.bestScore).toBe(0.7)
    expect(loaded.keptCount).toBe(3)
  })
})

describe('benchmark-store — temp cycle', () => {
  it('tempForCycleIdx rotates [0.3, 0.7, 1.0]', () => {
    expect(store.tempForCycleIdx(0)).toBe(0.3)
    expect(store.tempForCycleIdx(1)).toBe(0.7)
    expect(store.tempForCycleIdx(2)).toBe(1.0)
    expect(store.tempForCycleIdx(3)).toBe(0.3)
    expect(store.tempForCycleIdx(100)).toBe(0.3 + 0 * 0) // idx 100 % 3 = 1 → 0.7
    expect(store.tempForCycleIdx(100)).toBe(0.7)
  })
})
