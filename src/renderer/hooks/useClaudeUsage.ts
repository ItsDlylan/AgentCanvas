import { useEffect, useMemo, useState } from 'react'
import {
  EMPTY_CLAUDE_USAGE_SNAPSHOT,
  type ClaudeUsageSnapshot,
  type WindowUsage
} from '@/types/claude-usage'

/**
 * Subscribes to the main-process ClaudeUsageService and returns the current
 * snapshot plus a derived list of usage windows (5h, 7d, ...) shaped for UI.
 *
 * The raw `usage` blob comes straight from Anthropic's /api/oauth/usage,
 * so we tolerate a few field-name variants (utilization vs percentage,
 * resets_at vs reset_at) that may appear across API versions.
 */
export function useClaudeUsage(): {
  snapshot: ClaudeUsageSnapshot
  windows: WindowUsage[]
} {
  const [snapshot, setSnapshot] = useState<ClaudeUsageSnapshot>(EMPTY_CLAUDE_USAGE_SNAPSHOT)

  useEffect(() => {
    let mounted = true

    window.claudeUsage
      .load()
      .then((s) => {
        if (mounted) setSnapshot(s)
      })
      .catch(() => {
        // Main is not ready yet — the onChanged subscription will catch up.
      })

    const unsubscribe = window.claudeUsage.onChanged((s) => {
      if (mounted) setSnapshot(s)
    })

    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])

  const windows = useMemo(() => extractWindowUsage(snapshot.usage), [snapshot.usage])

  return { snapshot, windows }
}

function extractWindowUsage(usage: Record<string, unknown> | null): WindowUsage[] {
  if (!usage) return []

  const windows: WindowUsage[] = []
  const candidates = (usage.usage_windows ?? usage.windows ?? usage) as Record<string, unknown>
  if (!candidates || typeof candidates !== 'object') return []

  for (const [key, value] of Object.entries(candidates)) {
    if (typeof value !== 'object' || value === null) continue
    const win = value as Record<string, unknown>

    const used =
      typeof win.used === 'number'
        ? win.used
        : typeof win.tokens_used === 'number'
          ? win.tokens_used
          : null
    const limit =
      typeof win.limit === 'number'
        ? win.limit
        : typeof win.tokens_limit === 'number'
          ? win.tokens_limit
          : null
    const percentage =
      typeof win.percentage === 'number'
        ? win.percentage
        : typeof win.utilization === 'number'
          ? // Anthropic's response is already 0-100, not 0-1. Don't multiply.
            win.utilization
          : used !== null && limit !== null && limit > 0
            ? (used / limit) * 100
            : null

    if (percentage === null) continue

    windows.push({
      label: formatWindowLabel(key),
      percentage: Math.min(100, Math.round(percentage)),
      used: used ?? 0,
      limit: limit ?? 0,
      resetAt:
        typeof win.resets_at === 'string'
          ? win.resets_at
          : typeof win.reset_at === 'string'
            ? win.reset_at
            : null
    })
  }

  return windows.sort((a, b) => {
    const order = ['5 Hour', '5h', '7 Day', '7d', 'Daily', 'Weekly', 'Monthly']
    const aIdx = order.findIndex((o) => a.label.toLowerCase().includes(o.toLowerCase()))
    const bIdx = order.findIndex((o) => b.label.toLowerCase().includes(o.toLowerCase()))
    return (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx)
  })
}

function formatWindowLabel(key: string): string {
  if (key === 'five_hour') return '5 Hour'
  if (key === 'seven_day') return '7 Day'
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
