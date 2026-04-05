import { memo, useState, useEffect } from 'react'
import type { Node } from '@xyflow/react'
import { useAllTerminalStatuses, type TerminalStatus } from '@/hooks/useTerminalStatus'
import { useAllBrowserStatuses } from '@/hooks/useBrowserStatus'
import { registerRender } from '@/hooks/usePerformanceDebug'
import { useSettings, type WorkspaceTemplate } from '@/hooks/useSettings'
import { TERMINAL_PRESETS, BROWSER_SPAWN_PRESETS, type DevicePreset } from '@/constants/devicePresets'
import type { Workspace } from '@/types/workspace'

interface ProcessPanelProps {
  nodes: Node[]
  focusedId: string | null
  onFocus: (sessionId: string) => void
  onFocusProcess: (workspaceId: string, sessionId: string) => void
  onKill: (sessionId: string) => void
  onAddTerminal: (width?: number, height?: number) => void
  onAddBrowser: (preset?: DevicePreset) => void
  onAddNote: () => void
  onSpawnTemplate: (template: WorkspaceTemplate) => void
  open: boolean
  onToggle: () => void
  tileWorkspaceMap: Map<string, string>
  workspaces: Workspace[]
  activeWorkspaceId: string
  jumpHints: Map<string, string>
}

function JumpBadge({ hint }: { hint: string | undefined }) {
  if (!hint) return null
  return (
    <span className="ml-auto shrink-0 rounded border border-blue-400/50 bg-blue-500/20 px-1.5 py-0.5 font-mono text-[10px] font-bold leading-none text-blue-300">
      {hint}
    </span>
  )
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
  onFocusProcess,
  onKill,
  onAddTerminal,
  onAddBrowser,
  onAddNote,
  onSpawnTemplate,
  open,
  onToggle,
  tileWorkspaceMap,
  workspaces,
  activeWorkspaceId,
  jumpHints
}: ProcessPanelProps) {
  registerRender('ProcessPanel')
  const terminals = nodes.filter((n) => n.type === 'terminal')
  const allBrowsers = nodes.filter((n) => n.type === 'browser')
  const notes = nodes.filter((n) => n.type === 'notes')
  const browsers = allBrowsers.filter((n) => {
    const sid = (n.data as Record<string, unknown>).sessionId as string
    return tileWorkspaceMap.get(sid) === activeWorkspaceId
  })
  const backgroundBrowsers = allBrowsers.filter((n) => {
    const sid = (n.data as Record<string, unknown>).sessionId as string
    return tileWorkspaceMap.get(sid) !== activeWorkspaceId
  })
  const statuses = useAllTerminalStatuses()
  const browserStatuses = useAllBrowserStatuses()
  const [terminalPresetsOpen, setTerminalPresetsOpen] = useState(false)
  const [browserPresetsOpen, setBrowserPresetsOpen] = useState(false)
  const [templateMenuOpen, setTemplateMenuOpen] = useState(false)
  const { settings } = useSettings()

  useEffect(() => {
    if (!terminalPresetsOpen && !browserPresetsOpen && !templateMenuOpen) return
    const handler = () => {
      setTerminalPresetsOpen(false)
      setBrowserPresetsOpen(false)
      setTemplateMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [terminalPresetsOpen, browserPresetsOpen, templateMenuOpen])

  const renderBrowserEntry = (node: Node, isBackground: boolean) => {
    const data = node.data as Record<string, unknown>
    const sessionId = data.sessionId as string
    const label = data.label as string
    const isFocused = focusedId === sessionId
    const info = browserStatuses.get(sessionId)
    const isLoading = info?.loading ?? true
    const title = info?.title || label
    const url = info?.url
    const wsId = tileWorkspaceMap.get(sessionId)
    const ws = isBackground ? workspaces.find((w) => w.id === wsId) : undefined

    return (
      <button
        key={node.id}
        onClick={() => {
          if (wsId && wsId !== activeWorkspaceId) {
            onFocusProcess(wsId, sessionId)
          } else {
            onFocus(sessionId)
          }
        }}
        className={`group flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors ${
          isFocused
            ? 'bg-blue-500/10 ring-1 ring-blue-500/20'
            : isBackground
              ? 'opacity-60 hover:bg-zinc-800 hover:opacity-100'
              : 'hover:bg-zinc-800'
        }`}
      >
        <span
          className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
            isFocused ? 'bg-blue-400' : isLoading ? 'bg-blue-400 animate-pulse' : 'bg-emerald-500'
          }`}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            <span
              className={`truncate text-xs font-medium ${
                isFocused ? 'text-blue-300' : 'text-zinc-300'
              }`}
            >
              {title}
            </span>
            <span className="shrink-0 text-[10px] text-emerald-500/70">
              Browser
            </span>
          </div>
          {url && (
            <span className="truncate text-[10px] text-zinc-600" title={url}>
              {url.replace(/^https?:\/\//, '')}
            </span>
          )}
          {ws && (
            <span className="truncate text-[10px] text-purple-400/70">
              {ws.name}
            </span>
          )}
        </div>
        <JumpBadge hint={jumpHints.get(sessionId)} />
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
  }

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
        className="absolute right-0 top-0 z-10 flex h-full flex-col border-l border-zinc-800 bg-zinc-900"
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
            {terminals.length + allBrowsers.length + notes.length}
          </span>
        </div>

        {/* Process list */}
        <div className="flex-1 overflow-y-auto p-2">
          {terminals.length === 0 && allBrowsers.length === 0 && notes.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <span className="text-xs text-zinc-600">No active tiles</span>
            </div>
          ) : (
            <>
            <div className="flex flex-col gap-1">
              {/* Terminal entries */}
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
                    <span
                      className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${isFocused ? 'bg-blue-400' : cfg.dot}`}
                    />
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
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
                      {cwd && (
                        <span className="truncate text-[10px] text-zinc-600" title={cwd}>
                          {shortenPath(cwd)}
                        </span>
                      )}
                      {foreground && !['zsh', 'bash', 'fish', 'sh'].includes(foreground) && (
                        <span className="truncate text-[10px] text-zinc-500">
                          {foreground}
                        </span>
                      )}
                    </div>
                    <JumpBadge hint={jumpHints.get(sessionId)} />
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

              {/* Browser entries (current workspace) */}
              {browsers.map((node) => renderBrowserEntry(node, false))}

              {/* Note entries */}
              {notes.map((node) => {
                const data = node.data as Record<string, unknown>
                const sessionId = data.sessionId as string
                const label = data.label as string
                const isFocused = focusedId === sessionId

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
                    <span
                      className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${isFocused ? 'bg-blue-400' : 'bg-amber-400'}`}
                    />
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`truncate text-xs font-medium ${
                            isFocused ? 'text-blue-300' : 'text-zinc-300'
                          }`}
                        >
                          {label}
                        </span>
                        <span className="shrink-0 text-[10px] text-amber-400/70">
                          Note
                        </span>
                      </div>
                    </div>
                    <JumpBadge hint={jumpHints.get(sessionId)} />
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

            {/* Background browsers from other workspaces */}
            {backgroundBrowsers.length > 0 && (
              <div className="mt-3">
                <div className="flex items-center gap-2 px-2.5 pb-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
                    Other Workspaces
                  </span>
                  <span className="rounded-full bg-zinc-800/60 px-1.5 py-0.5 text-[10px] text-zinc-500">
                    {backgroundBrowsers.length}
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  {backgroundBrowsers.map((node) => renderBrowserEntry(node, true))}
                </div>
              </div>
            )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap gap-1.5 border-t border-zinc-800 p-2">
          {/* Terminal split button */}
          <div className="relative flex-1" onMouseDown={(e) => e.stopPropagation()}>
            {terminalPresetsOpen && (
              <div className="absolute bottom-full left-0 right-0 z-50 mb-1 rounded-md border border-zinc-700 bg-zinc-800 py-1 shadow-lg">
                {TERMINAL_PRESETS.map((preset) => (
                  <button
                    key={preset.name}
                    onClick={() => {
                      onAddTerminal(preset.width, preset.height)
                      setTerminalPresetsOpen(false)
                    }}
                    className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-700"
                  >
                    <span>{preset.name}</span>
                    <span className="text-zinc-500">{preset.width}&times;{preset.height}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="flex overflow-hidden rounded-md bg-zinc-800">
              <button
                onClick={() => onAddTerminal()}
                className="flex flex-1 items-center justify-center gap-1.5 py-2 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-700 hover:text-white"
              >
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                Terminal
              </button>
              <button
                onClick={() => setTerminalPresetsOpen(!terminalPresetsOpen)}
                className="border-l border-zinc-700 px-1.5 py-2 text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-white"
              >
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                </svg>
              </button>
            </div>
          </div>

          {/* Browser split button */}
          <div className="relative flex-1" onMouseDown={(e) => e.stopPropagation()}>
            {browserPresetsOpen && (
              <div className="absolute bottom-full left-0 right-0 z-50 mb-1 rounded-md border border-zinc-700 bg-zinc-800 py-1 shadow-lg">
                {BROWSER_SPAWN_PRESETS.map((preset) => (
                  <button
                    key={preset.name}
                    onClick={() => {
                      onAddBrowser(preset)
                      setBrowserPresetsOpen(false)
                    }}
                    className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-700"
                  >
                    <span>{preset.name}</span>
                    <span className="text-zinc-500">{preset.width}&times;{preset.height}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="flex overflow-hidden rounded-md bg-zinc-800">
              <button
                onClick={() => onAddBrowser()}
                className="flex flex-1 items-center justify-center gap-1.5 py-2 text-xs font-medium text-emerald-400 transition-colors hover:bg-zinc-700 hover:text-emerald-300"
              >
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                Browser
              </button>
              <button
                onClick={() => setBrowserPresetsOpen(!browserPresetsOpen)}
                className="border-l border-zinc-700 px-1.5 py-2 text-emerald-400 transition-colors hover:bg-zinc-700 hover:text-emerald-300"
              >
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                </svg>
              </button>
            </div>
          </div>

          {/* Note button */}
          <button
            onClick={() => onAddNote()}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-zinc-800 py-2 text-xs font-medium text-amber-400 transition-colors hover:bg-zinc-700 hover:text-amber-300"
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Note
          </button>

          {/* Template button */}
          {settings.templates.length > 0 && (
            <div className="relative w-full" onMouseDown={(e) => e.stopPropagation()}>
              {templateMenuOpen && (
                <div className="absolute bottom-full left-0 right-0 z-50 mb-1 rounded-md border border-zinc-700 bg-zinc-800 py-1 shadow-lg">
                  {settings.templates.map((tmpl) => (
                    <button
                      key={tmpl.id}
                      onClick={() => {
                        onSpawnTemplate(tmpl)
                        setTemplateMenuOpen(false)
                      }}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-700"
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                      <span className="flex-1">{tmpl.name}</span>
                      <span className="text-zinc-600">{tmpl.tiles.length} tiles</span>
                    </button>
                  ))}
                </div>
              )}
              <button
                onClick={() => setTemplateMenuOpen(!templateMenuOpen)}
                className="flex w-full items-center justify-center gap-1.5 rounded-md bg-zinc-800 py-2 text-xs font-medium text-blue-400 transition-colors hover:bg-zinc-700 hover:text-blue-300"
              >
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm0 8a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zm10 0a1 1 0 011-1h4a1 1 0 011 1v6a1 1 0 01-1 1h-4a1 1 0 01-1-1v-6z" />
                </svg>
                Template
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

export const ProcessPanel = memo(ProcessPanelComponent)
