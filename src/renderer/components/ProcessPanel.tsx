import { memo } from 'react'
import type { Node } from '@xyflow/react'
import { useAllTerminalStatuses, type TerminalStatus } from '@/hooks/useTerminalStatus'

interface ProcessPanelProps {
  nodes: Node[]
  focusedId: string | null
  onFocus: (sessionId: string) => void
  onKill: (sessionId: string) => void
  onAdd: () => void
  open: boolean
  onToggle: () => void
}

const STATUS_CONFIG: Record<TerminalStatus, { dot: string; label: string; labelColor: string }> = {
  idle: { dot: 'bg-zinc-500', label: 'Idle', labelColor: 'text-zinc-600' },
  running: { dot: 'bg-green-500', label: 'Running', labelColor: 'text-green-500/70' },
  waiting: { dot: 'bg-amber-400 animate-pulse', label: 'Waiting', labelColor: 'text-amber-400/70' }
}

function shortenPath(path: string): string {
  const home = path.replace(/^\/Users\/[^/]+/, '~')
  const parts = home.split('/')
  if (parts.length <= 3) return home
  return parts[0] + '/.../' + parts.slice(-2).join('/')
}

function ProcessPanelComponent({
  nodes,
  focusedId,
  onFocus,
  onKill,
  onAdd,
  open,
  onToggle
}: ProcessPanelProps) {
  const terminals = nodes.filter((n) => n.type === 'terminal')
  const statuses = useAllTerminalStatuses()

  return (
    <>
      {/* Toggle pill on the edge */}
      <button
        onClick={onToggle}
        className="absolute top-1/2 z-20 flex -translate-y-1/2 items-center rounded-l-full border border-r-0 border-zinc-700 bg-zinc-800 px-1.5 py-4 text-zinc-500 transition-all hover:bg-zinc-700 hover:text-zinc-200"
        style={{ right: open ? 256 : 0 }}
      >
        <svg
          className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
      </button>

      {/* Panel */}
      <div
        className="absolute right-0 top-0 z-10 flex h-full flex-col border-l border-zinc-800 bg-zinc-900/95 backdrop-blur-sm transition-transform"
        style={{
          width: 256,
          transform: open ? 'translateX(0)' : 'translateX(100%)'
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Processes
          </span>
          <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] font-medium text-zinc-400">
            {terminals.length}
          </span>
        </div>

        {/* Process list */}
        <div className="flex-1 overflow-y-auto p-2">
          {terminals.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <span className="text-xs text-zinc-600">No active terminals</span>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {terminals.map((node) => {
                const data = node.data as Record<string, unknown>
                const sessionId = data.sessionId as string
                const label = data.label as string
                const isFocused = focusedId === sessionId
                const info = statuses.get(sessionId)
                const status = info?.status ?? 'running'
                const cwd = info?.cwd
                const foreground = info?.foregroundProcess
                const cfg = STATUS_CONFIG[status]

                return (
                  <button
                    key={node.id}
                    onClick={() => onFocus(sessionId)}
                    className={`group flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors ${
                      isFocused
                        ? 'bg-blue-500/10 ring-1 ring-blue-500/20'
                        : 'hover:bg-zinc-800'
                    }`}
                  >
                    {/* Status dot */}
                    <span
                      className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${isFocused ? 'bg-blue-400' : cfg.dot}`}
                    />

                    {/* Info */}
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      {/* Name + status */}
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`truncate text-xs font-medium ${
                            isFocused ? 'text-blue-300' : 'text-zinc-300'
                          }`}
                        >
                          {label}
                        </span>
                        <span className={`shrink-0 text-[10px] ${cfg.labelColor}`}>
                          {cfg.label}
                        </span>
                      </div>

                      {/* CWD */}
                      {cwd && (
                        <span className="truncate text-[10px] text-zinc-600" title={cwd}>
                          {shortenPath(cwd)}
                        </span>
                      )}

                      {/* Foreground process (if not shell) */}
                      {foreground && !['zsh', 'bash', 'fish', 'sh'].includes(foreground) && (
                        <span className="truncate text-[10px] text-zinc-500">
                          {foreground}
                        </span>
                      )}
                    </div>

                    {/* Kill button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onKill(sessionId)
                      }}
                      className="mt-0.5 shrink-0 rounded p-0.5 text-zinc-600 opacity-0 transition-opacity hover:bg-zinc-700 hover:text-red-400 group-hover:opacity-100"
                    >
                      <svg
                        className="h-3 w-3"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-zinc-800 p-2">
          <button
            onClick={onAdd}
            className="flex w-full items-center justify-center gap-1.5 rounded-md bg-zinc-800 py-2 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-700 hover:text-white"
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            New Terminal
          </button>
        </div>
      </div>
    </>
  )
}

export const ProcessPanel = memo(ProcessPanelComponent)
