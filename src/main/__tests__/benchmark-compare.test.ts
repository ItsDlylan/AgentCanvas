/**
 * Tests for benchmark-compare.
 *
 * Run with:
 *   npm install -D vitest
 *   npx vitest run src/main/__tests__/benchmark-compare.test.ts
 */

import { describe, it, expect } from 'vitest'
import { compareScores, heldOutDiverged } from '../benchmark-compare'

describe('compareScores — low noise (Karpathy canonical)', () => {
  it('accepts strictly greater candidate', () => {
    const r = compareScores({
      bestScore: 0.5,
      candidateScore: 0.51,
      noiseClass: 'low',
      history: []
    })
    expect(r.accepted).toBe(true)
    expect(r.reason).toMatch(/strict >/)
  })

  it('rejects equal candidate', () => {
    const r = compareScores({
      bestScore: 0.5,
      candidateScore: 0.5,
      noiseClass: 'low',
      history: []
    })
    expect(r.accepted).toBe(false)
  })

  it('rejects NaN candidate', () => {
    const r = compareScores({
      bestScore: 0.5,
      candidateScore: Number.NaN,
      noiseClass: 'low',
      history: []
    })
    expect(r.accepted).toBe(false)
    expect(r.reason).toMatch(/not a finite number/)
  })

  it('accepts first iteration with no baseline', () => {
    const r = compareScores({
      bestScore: null,
      candidateScore: 0.5,
      noiseClass: 'low',
      history: []
    })
    expect(r.accepted).toBe(true)
  })
})

describe('compareScores — medium/high noise', () => {
  it('medium noise: accepts when delta exceeds observed stddev', () => {
    // History with tiny variance (stddev ~0.001)
    const history = [0.5, 0.501, 0.502, 0.503, 0.504, 0.505, 0.506, 0.507, 0.508, 0.509]
    const r = compareScores({
      bestScore: 0.509,
      candidateScore: 0.52, // Δ = 0.011, well above σ ~0.001
      noiseClass: 'medium',
      history
    })
    // 0.011 / 0.001 = 11σ → anomaly, frozen, not accepted via normal path.
    expect(r.flaggedAnomaly).toBe(true)
    expect(r.accepted).toBe(false)
  })

  it('medium noise: rejects when delta is within noise floor', () => {
    const history = [0.5, 0.52, 0.48, 0.51, 0.49, 0.53, 0.5, 0.52, 0.48, 0.51]
    const r = compareScores({
      bestScore: 0.51,
      candidateScore: 0.515, // tiny gain within stddev
      noiseClass: 'medium',
      history
    })
    expect(r.accepted).toBe(false)
    expect(r.reason).toMatch(/noise floor/)
  })

  it('medium noise with insufficient history: falls back to strict >', () => {
    const r = compareScores({
      bestScore: 0.5,
      candidateScore: 0.51,
      noiseClass: 'medium',
      history: [0.5, 0.49, 0.505] // < 10 samples → no σ activation
    })
    expect(r.accepted).toBe(true)
  })

  it('best-of-3 replicates: median of replicates used when provided', () => {
    const r = compareScores({
      bestScore: 0.5,
      candidateScore: 0.99, // would trigger anomaly if history existed
      candidateReplicates: [0.51, 0.52, 0.50], // median=0.51
      baselineReplicates: [0.49, 0.50, 0.51], // median=0.50
      noiseClass: 'medium',
      history: []
    })
    expect(r.effectiveCandidate).toBeCloseTo(0.51)
    expect(r.effectiveBaseline).toBeCloseTo(0.50)
    expect(r.accepted).toBe(true)
  })
})

describe('compareScores — 3σ auto-freeze', () => {
  it('flags anomalous jump when history ≥ 10', () => {
    const history = Array.from({ length: 12 }, (_, i) => 0.5 + i * 0.001)
    const r = compareScores({
      bestScore: 0.511,
      candidateScore: 0.99, // order-of-magnitude jump
      noiseClass: 'low',
      history
    })
    expect(r.flaggedAnomaly).toBe(true)
    expect(r.accepted).toBe(false)
    expect(r.reason).toMatch(/3σ|sign-off/)
    expect(r.sigmasDelta).toBeGreaterThan(3)
  })

  it('does not flag when history < activation threshold', () => {
    const r = compareScores({
      bestScore: 0.5,
      candidateScore: 10, // huge jump
      noiseClass: 'low',
      history: [0.5, 0.49] // only 2 samples
    })
    expect(r.flaggedAnomaly).toBe(false)
  })

  it('handles constant history (stddev=0) without false-positive anomaly', () => {
    const history = Array(12).fill(0.5)
    const r = compareScores({
      bestScore: 0.5,
      candidateScore: 0.6,
      noiseClass: 'low',
      history
    })
    expect(r.flaggedAnomaly).toBe(false)
  })
})

describe('heldOutDiverged', () => {
  it('flags when primary improves but held-out drops > threshold', () => {
    expect(
      heldOutDiverged({
        baseline: 0.8,
        latest: 0.7, // 12.5% drop
        regressionThreshold: 0.05,
        primaryImproved: true
      })
    ).toBe(true)
  })

  it('does not flag if primary did not improve', () => {
    expect(
      heldOutDiverged({
        baseline: 0.8,
        latest: 0.1,
        regressionThreshold: 0.05,
        primaryImproved: false
      })
    ).toBe(false)
  })

  it('does not flag small drops within threshold', () => {
    expect(
      heldOutDiverged({
        baseline: 0.8,
        latest: 0.78, // 2.5% drop
        regressionThreshold: 0.05,
        primaryImproved: true
      })
    ).toBe(false)
  })

  it('does not flag when baseline is undefined', () => {
    expect(
      heldOutDiverged({
        baseline: undefined,
        latest: 0.5,
        regressionThreshold: 0.05,
        primaryImproved: true
      })
    ).toBe(false)
  })
})
