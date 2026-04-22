import type { NoiseClass, ResultsRow } from './benchmark-store'

export interface CompareInput {
  /** Current best (accepted) score. null → any finite score is an improvement. */
  bestScore: number | null
  /** The new candidate score produced by the current iteration. */
  candidateScore: number
  /** For best-of-3 paired comparison, optional replicates (median is compared). */
  candidateReplicates?: number[]
  /** For best-of-3 paired comparison, optional replicates of the baseline at the same seeds. */
  baselineReplicates?: number[]
  noiseClass: NoiseClass
  /** All previously accepted scores, used for observed-stddev computation. */
  history: number[]
  /**
   * Minimum number of history samples before the 3σ freeze rule activates.
   * Plan: "Once 10 iterations of history exist, compute per-step stddev".
   */
  sigmaActivationThreshold?: number
}

export interface CompareResult {
  accepted: boolean
  reason: string
  observedStddev: number | null
  sigmasDelta: number | null
  /** True when the delta exceeds 3σ of historical per-step changes. */
  flaggedAnomaly: boolean
  anomalyDetail?: string
  /** The effective score used for the decision (may be a median over replicates). */
  effectiveCandidate: number
  effectiveBaseline: number | null
}

/**
 * Compare a candidate iteration's score against the current best, honoring the
 * declared noise class.
 *
 * Low-noise:   strict `>` (Karpathy canonical).
 * Medium/high: best-of-3 paired median with noise-floor check (delta > observed_stddev).
 *              When replicates are not supplied, falls back to strict > with a
 *              noise-floor guard (delta must exceed observed stddev of accepted history).
 *
 * Reward-hack auto-freeze:
 *   If `history.length >= sigmaActivationThreshold` (default 10) and the absolute
 *   delta exceeds 3× the per-step stddev of prior accepted deltas, `flaggedAnomaly`
 *   is set. Callers should freeze the lineage and require human sign-off before
 *   continuing.
 */
export function compareScores(input: CompareInput): CompareResult {
  const {
    bestScore,
    candidateScore,
    noiseClass,
    history,
    sigmaActivationThreshold = 10
  } = input

  if (!Number.isFinite(candidateScore)) {
    return {
      accepted: false,
      reason: 'Candidate score is not a finite number',
      observedStddev: null,
      sigmasDelta: null,
      flaggedAnomaly: false,
      effectiveCandidate: candidateScore,
      effectiveBaseline: bestScore
    }
  }

  const effectiveCandidate = median(input.candidateReplicates) ?? candidateScore
  const effectiveBaseline = median(input.baselineReplicates) ?? bestScore

  if (effectiveBaseline === null) {
    // First iteration — any finite score is an improvement.
    const { stddev, deltaSigmas, flaggedAnomaly } = sigmaCheck(
      effectiveCandidate,
      null,
      history,
      sigmaActivationThreshold
    )
    return {
      accepted: !flaggedAnomaly,
      reason: flaggedAnomaly
        ? 'First-iteration score is anomalous vs history — frozen pending review'
        : 'First iteration (no baseline) — accepting candidate',
      observedStddev: stddev,
      sigmasDelta: deltaSigmas,
      flaggedAnomaly,
      anomalyDetail: flaggedAnomaly ? `${deltaSigmas?.toFixed(2)}σ vs observed ${stddev?.toFixed(4)}` : undefined,
      effectiveCandidate,
      effectiveBaseline: null
    }
  }

  const delta = effectiveCandidate - effectiveBaseline
  const { stddev, deltaSigmas, flaggedAnomaly } = sigmaCheck(
    effectiveCandidate,
    effectiveBaseline,
    history,
    sigmaActivationThreshold
  )

  if (flaggedAnomaly) {
    return {
      accepted: false,
      reason: 'Score jump exceeds 3σ of historical per-step stddev — frozen pending human sign-off',
      observedStddev: stddev,
      sigmasDelta: deltaSigmas,
      flaggedAnomaly: true,
      anomalyDetail: `Δ=${delta.toFixed(4)} vs σ=${stddev?.toFixed(4)} (${deltaSigmas?.toFixed(2)}σ)`,
      effectiveCandidate,
      effectiveBaseline
    }
  }

  if (noiseClass === 'low') {
    const accepted = effectiveCandidate > effectiveBaseline
    return {
      accepted,
      reason: accepted
        ? `strict >: ${effectiveCandidate} > ${effectiveBaseline}`
        : `strict >: ${effectiveCandidate} ≤ ${effectiveBaseline}`,
      observedStddev: stddev,
      sigmasDelta: deltaSigmas,
      flaggedAnomaly: false,
      effectiveCandidate,
      effectiveBaseline
    }
  }

  // medium / high: require delta > observed stddev (noise floor).
  // If we don't yet have a meaningful stddev estimate (too few samples), fall back
  // to strict > so we don't permanently block progress at low iteration counts.
  const noiseFloor = stddev ?? 0
  if (delta > noiseFloor && delta > 0) {
    return {
      accepted: true,
      reason:
        stddev === null
          ? `(${noiseClass} noise, warmup) strict >: ${effectiveCandidate} > ${effectiveBaseline}`
          : `(${noiseClass} noise) Δ=${delta.toFixed(4)} > σ=${stddev.toFixed(4)}`,
      observedStddev: stddev,
      sigmasDelta: deltaSigmas,
      flaggedAnomaly: false,
      effectiveCandidate,
      effectiveBaseline
    }
  }

  return {
    accepted: false,
    reason:
      stddev === null
        ? `(${noiseClass} noise) Δ=${delta.toFixed(4)} ≤ 0 — reject`
        : `(${noiseClass} noise) Δ=${delta.toFixed(4)} ≤ σ=${stddev.toFixed(4)} — within noise floor`,
    observedStddev: stddev,
    sigmasDelta: deltaSigmas,
    flaggedAnomaly: false,
    effectiveCandidate,
    effectiveBaseline
  }
}

function sigmaCheck(
  candidate: number,
  baseline: number | null,
  history: number[],
  activationThreshold: number
): { stddev: number | null; deltaSigmas: number | null; flaggedAnomaly: boolean } {
  if (history.length < activationThreshold) {
    return { stddev: null, deltaSigmas: null, flaggedAnomaly: false }
  }
  // Per-step deltas: differences between consecutive accepted scores.
  const deltas: number[] = []
  for (let i = 1; i < history.length; i++) deltas.push(history[i] - history[i - 1])
  if (deltas.length < 2) return { stddev: null, deltaSigmas: null, flaggedAnomaly: false }

  const stddev = populationStddev(deltas)
  if (!Number.isFinite(stddev) || stddev === 0) {
    // All identical history → any change is infinitely anomalous. Treat as
    // no-signal to avoid false positives in bootstrap cases.
    return { stddev: stddev || null, deltaSigmas: null, flaggedAnomaly: false }
  }

  const delta = baseline === null ? candidate - mean(history) : candidate - baseline
  const sigmas = Math.abs(delta) / stddev
  return { stddev, deltaSigmas: sigmas, flaggedAnomaly: sigmas > 3 }
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0
  let sum = 0
  for (const x of xs) sum += x
  return sum / xs.length
}

function populationStddev(xs: number[]): number {
  if (xs.length === 0) return 0
  const m = mean(xs)
  let sumSq = 0
  for (const x of xs) sumSq += (x - m) ** 2
  return Math.sqrt(sumSq / xs.length)
}

function median(xs: number[] | undefined): number | null {
  if (!xs || xs.length === 0) return null
  const sorted = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[mid]
  return (sorted[mid - 1] + sorted[mid]) / 2
}

// ── Held-out divergence detector ────────────────────────────

export interface HeldOutDivergenceInput {
  baseline?: number
  latest: number
  regressionThreshold: number // fraction, e.g. 0.05 = 5%
  primaryImproved: boolean
}

export function heldOutDiverged(input: HeldOutDivergenceInput): boolean {
  if (!input.primaryImproved) return false
  if (input.baseline === undefined || !Number.isFinite(input.baseline)) return false
  const drop = input.baseline - input.latest
  // If baseline is zero, fall back to absolute comparison.
  const relative = input.baseline === 0 ? drop : drop / Math.abs(input.baseline)
  return relative > input.regressionThreshold
}

// ── Extract score history from results rows ─────────────────

export function acceptedScoresFromRows(rows: ResultsRow[]): number[] {
  return rows.filter((r) => r.accepted).map((r) => r.score)
}
