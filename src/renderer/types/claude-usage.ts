/**
 * Raw Claude Code usage snapshot, sourced from ~/.claude/usage.json
 * (maintained by the user's statusline script) or, as a fallback,
 * fetched directly by AgentCanvas from Anthropic's /api/oauth/usage
 * when that file does not exist.
 */
export interface ClaudeUsageSnapshot {
  /** False when we have no way to load data (e.g. no keychain token on non-macOS). UI should hide the widget. */
  configured: boolean
  /** The raw Anthropic response, or null if unknown. */
  usage: Record<string, unknown> | null
  /** ISO timestamp of the most recent successful update. */
  lastUpdatedAt: string | null
  /** Human-readable error from the last attempt, if any. */
  error: string | null
  /** Where the current `usage` came from. 'file' = statusline is maintaining it; 'api' = AgentCanvas is polling. */
  source: 'file' | 'api' | null
}

/**
 * Derived view of a single usage window (5h, 7d, ...) for rendering.
 */
export interface WindowUsage {
  label: string
  percentage: number
  used: number
  limit: number
  resetAt: string | null
}

export const EMPTY_CLAUDE_USAGE_SNAPSHOT: ClaudeUsageSnapshot = {
  configured: false,
  usage: null,
  lastUpdatedAt: null,
  error: null,
  source: null
}
