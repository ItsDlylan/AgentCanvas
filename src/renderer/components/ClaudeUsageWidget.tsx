import { memo, useEffect, useRef, useState } from 'react'
import { useClaudeUsage } from '@/hooks/useClaudeUsage'
import type { WindowUsage } from '@/types/claude-usage'

const BRAND_ORANGE = '#d97757' // Anthropic brand orange

function getTextColor(pct: number): string {
  if (pct >= 80) return 'text-red-400'
  if (pct >= 50) return 'text-amber-400'
  return 'text-emerald-400'
}

function getBarColor(pct: number): string {
  if (pct >= 80) return 'bg-red-500'
  if (pct >= 50) return 'bg-amber-500'
  return 'bg-emerald-500'
}

function formatResetTime(resetAt: string | null): string | null {
  if (!resetAt) return null
  const date = new Date(resetAt)
  if (Number.isNaN(date.getTime())) return null
  const diffMs = date.getTime() - Date.now()
  if (diffMs <= 0) return 'soon'
  const diffMin = Math.round(diffMs / 60_000)
  if (diffMin < 60) return `${diffMin}m`
  const diffH = Math.round(diffMin / 60)
  if (diffH < 24) return `${diffH}h`
  const diffD = Math.round(diffH / 24)
  return `${diffD}d`
}

// ── Brand mark ──────────────────────────────────────────
// Simplified Anthropic-style eight-point starburst.

function ClaudeMark({
  className = '',
  style
}: {
  className?: string
  style?: React.CSSProperties
}): React.ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      style={{ color: BRAND_ORANGE, ...style }}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 2.5l1.8 6.7L20 8l-5.5 4 5.5 4-6.2-1.2L12 21.5l-1.8-6.7L4 16l5.5-4L4 8l6.2 1.2z" />
    </svg>
  )
}

// ── Compact titlebar badge ──────────────────────────────

function CompactBadge({
  windows,
  hasError,
  onClick
}: {
  windows: WindowUsage[]
  hasError: boolean
  onClick: () => void
}): React.ReactElement {
  const primary = windows[0]
  const secondary = windows[1]
  const primaryPct = primary?.percentage ?? 0

  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-all hover:bg-zinc-800"
      title="Claude Code usage"
      aria-label={`Claude Code usage: ${primaryPct}%`}
    >
      <ClaudeMark className="h-3.5 w-3.5" />
      {hasError ? (
        <span className="text-amber-400">!</span>
      ) : (
        <span className="tabular-nums">
          {primary ? (
            <span className={getTextColor(primary.percentage)}>{primary.percentage}%</span>
          ) : (
            <span className="text-zinc-500">—</span>
          )}
          {secondary && (
            <>
              <span className="text-zinc-600">/</span>
              <span className={`${getTextColor(secondary.percentage)} opacity-70`}>
                {secondary.percentage}%
              </span>
            </>
          )}
        </span>
      )}
    </button>
  )
}

// ── Expanded popover ────────────────────────────────────

function ExpandedPopover({
  windows,
  source,
  error,
  lastUpdatedAt
}: {
  windows: WindowUsage[]
  source: 'file' | 'api' | null
  error: string | null
  lastUpdatedAt: string | null
}): React.ReactElement {
  const sourceHint =
    source === 'file'
      ? 'Synced from Claude Code statusline'
      : source === 'api'
        ? 'Polled by AgentCanvas every 10 min'
        : null

  return (
    <div
      className="absolute right-0 top-full z-50 mt-2 w-72 rounded-lg border border-zinc-700 bg-zinc-900 p-4 shadow-2xl"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2">
        <ClaudeMark className="h-4 w-4" />
        <h4 className="text-sm font-medium text-zinc-100">Claude Code Usage</h4>
      </div>
      <p className="mt-0.5 text-[10px] text-zinc-500">
        5-hour and 7-day limits on your Claude Code plan
      </p>

      {error && (
        <div className="mt-3 rounded bg-amber-500/10 px-2 py-1.5 text-xs text-amber-400">
          Claude Code: {error}
        </div>
      )}

      {windows.length > 0 && (
        <div className="mt-3 space-y-2.5">
          {windows.map((win) => (
            <div key={win.label} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-300">{win.label}</span>
                <span className={`font-medium tabular-nums ${getTextColor(win.percentage)}`}>
                  {win.percentage}%
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${getBarColor(win.percentage)}`}
                  style={{ width: `${win.percentage}%` }}
                />
              </div>
              {win.resetAt && (
                <div className="text-[10px] text-zinc-500">
                  Resets in {formatResetTime(win.resetAt)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {windows.length === 0 && !error && (
        <div className="mt-3 text-xs text-zinc-500">Waiting for data…</div>
      )}

      <div className="mt-3 flex items-center justify-between border-t border-zinc-800 pt-2">
        {sourceHint && <span className="text-[10px] text-zinc-600">{sourceHint}</span>}
        {lastUpdatedAt && (
          <span className="text-[10px] text-zinc-600">
            {new Date(lastUpdatedAt).toLocaleTimeString()}
          </span>
        )}
      </div>
    </div>
  )
}

// ── Main component ──────────────────────────────────────

export const ClaudeUsageWidget = memo(function ClaudeUsageWidget(): React.ReactElement | null {
  const { snapshot, windows } = useClaudeUsage()
  const [expanded, setExpanded] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Click outside to close
  useEffect(() => {
    if (!expanded) return
    const handler = (e: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(e.target as HTMLElement)) {
        setExpanded(false)
      }
    }
    const timer = setTimeout(() => document.addEventListener('mousedown', handler), 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handler)
    }
  }, [expanded])

  // Escape to close
  useEffect(() => {
    if (!expanded) return
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setExpanded(false)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [expanded])

  if (!snapshot.configured) return null
  if (windows.length === 0 && !snapshot.error) return null

  return (
    <div ref={containerRef} className="relative">
      <CompactBadge
        windows={windows}
        hasError={!!snapshot.error}
        onClick={() => setExpanded((v) => !v)}
      />
      {expanded && (
        <ExpandedPopover
          windows={windows}
          source={snapshot.source}
          error={snapshot.error}
          lastUpdatedAt={snapshot.lastUpdatedAt}
        />
      )}
    </div>
  )
})
