import { memo, useState, useCallback, useRef, useEffect } from 'react'
import type { Node } from '@xyflow/react'
import type { Workspace } from '@/types/workspace'
import { useAllTerminalStatuses, type TerminalStatus } from '@/hooks/useTerminalStatus'
import { useAllBrowserStatuses } from '@/hooks/useBrowserStatus'
import { registerRender } from '@/hooks/usePerformanceDebug'

interface WorkspacePanelProps {
  workspaces: Workspace[]
  activeWorkspaceId: string
  tileWorkspaceMap: Map<string, string>
  nodes: Node[]
  focusedId: string | null
  onSelect: (id: string) => void
  onFocusProcess: (workspaceId: string, sessionId: string) => void
  onAdd: () => void
  onRemove: (id: string) => void
  onRename: (id: string, name: string) => void
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

function WorkspacePanelComponent({
  workspaces,
  activeWorkspaceId,
  tileWorkspaceMap,
  nodes,
  focusedId,
  onSelect,
  onFocusProcess,
  onAdd,
  onRemove,
  onRename,
  open,
  onToggle
}: WorkspacePanelProps) {
  registerRender('WorkspacePanel')
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const editInputRef = useRef<HTMLInputElement>(null)

  const terminalStatuses = useAllTerminalStatuses()
  const browserStatuses = useAllBrowserStatuses()

  const tilesForWorkspace = useCallback(
    (workspaceId: string) =>
      nodes.filter((n) => {
        const sid = (n.data as Record<string, unknown>).sessionId as string
        return tileWorkspaceMap.get(sid) === workspaceId
      }),
    [nodes, tileWorkspaceMap]
  )

  const tileCountFor = useCallback(
    (workspaceId: string) => {
      let count = 0
      for (const [, wid] of tileWorkspaceMap) {
        if (wid === workspaceId) count++
      }
      return count
    },
    [tileWorkspaceMap]
  )

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const startRename = useCallback((id: string, currentName: string) => {
    setEditingId(id)
    setEditValue(currentName)
  }, [])

  const commitRename = useCallback(() => {
    if (editingId && editValue.trim()) {
      onRename(editingId, editValue.trim())
    }
    setEditingId(null)
  }, [editingId, editValue, onRename])

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus()
      editInputRef.current.select()
    }
  }, [editingId])

  return (
    <>
      {/* Toggle pill on the left edge */}
      <button
        onClick={onToggle}
        className="absolute top-1/2 z-20 flex -translate-y-1/2 items-center rounded-r-full border border-l-0 border-zinc-700 bg-zinc-800 px-1.5 py-4 text-zinc-500 transition-all hover:bg-zinc-700 hover:text-zinc-200"
        style={{ left: open ? 240 : 0 }}
      >
        <svg
          className={`h-3 w-3 transition-transform ${open ? '' : 'rotate-180'}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>

      {/* Panel */}
      <div
        className="absolute left-0 top-0 z-10 flex h-full flex-col border-r border-zinc-800 bg-zinc-900"
        style={{
          width: 240,
          transform: open ? 'translateX(0)' : 'translateX(-100%)'
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Workspaces
          </span>
          <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] font-medium text-zinc-400">
            {workspaces.length}
          </span>
        </div>

        {/* Workspace list */}
        <div className="flex-1 overflow-y-auto p-2">
          <div className="flex flex-col gap-0.5">
            {workspaces.map((ws) => {
              const isActive = ws.id === activeWorkspaceId
              const count = tileCountFor(ws.id)
              const isEditing = editingId === ws.id
              const isExpanded = expandedIds.has(ws.id)
              const wsTiles = isExpanded ? tilesForWorkspace(ws.id) : []
              const wsTerminals = wsTiles.filter((n) => n.type === 'terminal')
              const wsBrowsers = wsTiles.filter((n) => n.type === 'browser')

              return (
                <div key={ws.id}>
                  {/* Workspace row — two click zones: chevron expands, rest selects */}
                  <div
                    className={`group flex w-full items-start gap-0 rounded-md text-left transition-colors ${
                      isActive
                        ? 'bg-blue-500/10 ring-1 ring-blue-500/20'
                        : 'hover:bg-zinc-800'
                    }`}
                  >
                    {/* Expand chevron — toggles process list */}
                    <button
                      onClick={() => toggleExpand(ws.id)}
                      className="flex shrink-0 items-center self-stretch rounded-l-md px-2 text-zinc-600 hover:text-zinc-300"
                    >
                      <svg
                        className={`h-3 w-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                    {/* Name area — switches to this workspace */}
                    <button
                      onClick={() => !isEditing && onSelect(ws.id)}
                      className="flex min-w-0 flex-1 items-start gap-2 py-2 pr-1 text-left"
                    >
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        {isEditing ? (
                          <input
                            ref={editInputRef}
                            type="text"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={commitRename}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitRename()
                              if (e.key === 'Escape') setEditingId(null)
                            }}
                            className="w-full rounded bg-zinc-800 px-1 py-0.5 text-xs text-zinc-200 outline-none ring-1 ring-blue-500/50"
                            onClick={(e) => e.stopPropagation()}
                          />
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`truncate text-xs font-medium ${
                                isActive ? 'text-blue-300' : 'text-zinc-300'
                              }`}
                            >
                              {ws.name}
                            </span>
                            {count > 0 && (
                              <span className="shrink-0 rounded-full bg-zinc-800 px-1.5 text-[10px] text-zinc-500">
                                {count}
                              </span>
                            )}
                          </div>
                        )}
                        {ws.path && (
                          <span className="truncate text-[10px] text-zinc-600" title={ws.path}>
                            {shortenPath(ws.path)}
                          </span>
                        )}
                      </div>
                    </button>
                    {/* Actions: rename + remove (not for default) */}
                    {!ws.isDefault && !isEditing && (
                      <div className="mt-1.5 flex shrink-0 gap-0.5 pr-1.5 opacity-0 group-hover:opacity-100">
                        <button
                          onClick={() => startRename(ws.id, ws.name)}
                          className="rounded p-0.5 text-zinc-600 hover:bg-zinc-700 hover:text-zinc-300"
                          title="Rename"
                        >
                          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => onRemove(ws.id)}
                          className="rounded p-0.5 text-zinc-600 hover:bg-zinc-700 hover:text-red-400"
                          title="Remove workspace"
                        >
                          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Expanded process list */}
                  {isExpanded && (
                    <div className="ml-4 mt-0.5 flex flex-col gap-0.5 border-l border-zinc-800 pl-2">
                      {wsTerminals.length === 0 && wsBrowsers.length === 0 && (
                        <span className="px-2 py-1.5 text-[10px] text-zinc-600">No tiles</span>
                      )}

                      {/* Terminals */}
                      {wsTerminals.map((node) => {
                        const data = node.data as Record<string, unknown>
                        const sessionId = data.sessionId as string
                        const label = data.label as string
                        const isFocused = focusedId === sessionId && isActive
                        const info = terminalStatuses.get(sessionId)
                        const status = info?.status ?? 'running'
                        const foreground = info?.foregroundProcess
                        const cfg = STATUS_CONFIG[status]

                        return (
                          <button
                            key={node.id}
                            onClick={() => onFocusProcess(ws.id, sessionId)}
                            className={`group flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors ${
                              isFocused
                                ? 'bg-blue-500/10 ring-1 ring-blue-500/20'
                                : 'hover:bg-zinc-800'
                            }`}
                          >
                            <span
                              className={`h-1.5 w-1.5 shrink-0 rounded-full ${isFocused ? 'bg-blue-400' : cfg.dot}`}
                            />
                            <span
                              className={`truncate text-[11px] ${
                                isFocused ? 'text-blue-300' : 'text-zinc-400'
                              }`}
                            >
                              {label}
                            </span>
                            {foreground && !['zsh', 'bash', 'fish', 'sh'].includes(foreground) && (
                              <span className="truncate text-[10px] text-zinc-600">
                                {foreground}
                              </span>
                            )}
                            <span className={`ml-auto shrink-0 text-[9px] ${cfg.labelColor}`}>
                              {cfg.label}
                            </span>
                          </button>
                        )
                      })}

                      {/* Browsers */}
                      {wsBrowsers.map((node) => {
                        const data = node.data as Record<string, unknown>
                        const sessionId = data.sessionId as string
                        const label = data.label as string
                        const isFocused = focusedId === sessionId && isActive
                        const info = browserStatuses.get(sessionId)
                        const title = info?.title || label
                        const isLoading = info?.loading ?? true

                        return (
                          <button
                            key={node.id}
                            onClick={() => onFocusProcess(ws.id, sessionId)}
                            className={`group flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors ${
                              isFocused
                                ? 'bg-blue-500/10 ring-1 ring-blue-500/20'
                                : 'hover:bg-zinc-800'
                            }`}
                          >
                            <span
                              className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                                isFocused ? 'bg-blue-400' : isLoading ? 'bg-blue-400 animate-pulse' : 'bg-emerald-500'
                              }`}
                            />
                            <span
                              className={`truncate text-[11px] ${
                                isFocused ? 'text-blue-300' : 'text-zinc-400'
                              }`}
                            >
                              {title}
                            </span>
                            <span className="ml-auto shrink-0 text-[9px] text-emerald-500/70">
                              Browser
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
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
            Workspace
          </button>
        </div>
      </div>
    </>
  )
}

export const WorkspacePanel = memo(WorkspacePanelComponent)
