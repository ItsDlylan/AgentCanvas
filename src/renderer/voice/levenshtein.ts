// ── Levenshtein distance utilities ───────────────────────
// Used by context-builder for fuzzy label matching and
// command-router for Tier 2 near-miss command matching.

export function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))

  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }

  return dp[m][n]
}

export function normalizedDistance(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length)
  if (maxLen === 0) return 0
  return levenshtein(a, b) / maxLen
}

export interface FuzzyResult<T> {
  item: T
  score: number
}

export function fuzzyMatch<T>(
  query: string,
  candidates: T[],
  getText: (item: T) => string,
  threshold = 0.3
): FuzzyResult<T> | null {
  let best: FuzzyResult<T> | null = null

  for (const item of candidates) {
    const text = getText(item).toLowerCase()
    const q = query.toLowerCase()
    const score = normalizedDistance(q, text)

    if (score <= threshold && (best === null || score < best.score)) {
      best = { item, score }
    }
  }

  return best
}

export function fuzzyMatchAll<T>(
  query: string,
  candidates: T[],
  getText: (item: T) => string,
  threshold = 0.3
): FuzzyResult<T>[] {
  return candidates
    .map((item) => ({ item, score: normalizedDistance(query.toLowerCase(), getText(item).toLowerCase()) }))
    .filter((r) => r.score <= threshold)
    .sort((a, b) => a.score - b.score)
}
