import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { NodeProps, Handle, Position, NodeResizer } from '@xyflow/react'
import { useTerminal } from '@/hooks/useTerminal'
import { useTerminalStatus } from '@/hooks/useTerminalStatus'
import { useFocusedTerminal } from '@/hooks/useFocusedTerminal'
import { useIsPanning, isPanningNow } from '@/hooks/usePanState'
import { registerRender } from '@/hooks/usePerformanceDebug'
import { useSettings } from '@/hooks/useSettings'
import { WorktreePicker } from './WorktreePicker'
import { EditableLabel } from './EditableLabel'
import type { TerminalStatus } from '@/hooks/useTerminalStatus'

export interface TerminalNodeData {
  sessionId: string
  label: string
  cwd?: string
  metadata?: Record<string, unknown>
  command?: string
}

const STATUS_CONFIG: Record<TerminalStatus, { dot: string; text: string; label: string }> = {
  idle: { dot: 'bg-zinc-500', text: 'text-zinc-500', label: 'Idle' },
  running: { dot: 'bg-green-500', text: 'text-green-400', label: 'Running' },
  waiting: { dot: 'bg-amber-400', text: 'text-amber-400', label: 'Waiting' }
}

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.tiff', '.ico'])

function isImageFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true
  const ext = file.name.toLowerCase().match(/\.[^.]+$/)?.[0]
  return ext ? IMAGE_EXTS.has(ext) : false
}

function shortenPath(path: string): string {
  const home = path.replace(/^\/Users\/[^/]+/, '~')
  const parts = home.split('/')
  if (parts.length <= 3) return home
  return parts[0] + '/.../' + parts.slice(-2).join('/')
}

function CacheCountdown({
  expiresAt,
  state,
  sessionId,
  warningThreshold
}: {
  expiresAt: number
  state: string
  sessionId: string
  warningThreshold: number
}) {
  const [remaining, setRemaining] = useState(() => Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)))

  useEffect(() => {
    const tick = () => {
      setRemaining(Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)))
    }
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [expiresAt])

  const handleKeepAlive = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    window.terminal.keepAlive(sessionId)
  }, [sessionId])

  const isExpired = state === 'expired' || remaining <= 0
  const isWarning = !isExpired && remaining <= warningThreshold
  const minutes = Math.floor(remaining / 60)
  const seconds = remaining % 60
  const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`

  const colorClass = isExpired
    ? 'text-red-400 cache-warning-pulse'
    : isWarning
      ? 'text-amber-400 cache-warning-pulse'
      : 'text-cyan-400'

  return (
    <div className={`flex items-center gap-1 pl-4 text-[10px] ${colorClass}`}>
      <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <circle cx="12" cy="12" r="10" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2" />
      </svg>
      <span className="font-mono">
        {isExpired ? 'Cache expired' : `Cache: ${timeStr}`}
      </span>
      {(isWarning || isExpired) && (
        <button
          onClick={handleKeepAlive}
          className="titlebar-no-drag ml-1 rounded bg-zinc-700/60 px-1 py-0.5 text-[9px] font-medium text-zinc-200 hover:bg-zinc-600"
          title="Send keep-alive message to refresh prompt cache"
        >
          Refresh
        </button>
      )}
    </div>
  )
}

function TerminalTileComponent({ data, width, height }: NodeProps) {
  registerRender('TerminalTile')
  const { sessionId, label, cwd: initialCwd, metadata: initialMetadata, command } = data as unknown as TerminalNodeData
  const { focusedId, setFocusedId, killTerminal, killHighlight, toggleDiffViewer, hasDiffViewer, renameTile } = useFocusedTerminal()
  const showingDiff = hasDiffViewer(sessionId)
  const { settings } = useSettings()
  const isPanning = useIsPanning()
  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const bodyElRef = useRef<HTMLDivElement | null>(null)
  const resizingRef = useRef(false)
  const [isResizing, setIsResizing] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const isFocused = focusedId === sessionId
  const statusInfo = useTerminalStatus(sessionId)
  const status = statusInfo?.status ?? 'running'
  const cwd = statusInfo?.cwd
  const cfg = STATUS_CONFIG[status]
  const teamMeta = statusInfo?.metadata?.team as { isLead?: boolean; role?: string; teamName?: string; linkedTerminalId?: string } | undefined

  const appearance = {
    terminalFontFamily: settings.appearance.terminalFontFamily,
    terminalFontSize: settings.appearance.terminalFontSize,
    terminalLineHeight: settings.appearance.terminalLineHeight,
    cursorStyle: settings.appearance.cursorStyle,
    cursorBlink: settings.appearance.cursorBlink,
    scrollback: settings.terminal.scrollback
  }

  const { containerRef, fit } = useTerminal({ sessionId, label, cwd: initialCwd, metadata: initialMetadata, command, appearance, hotkeys: settings.hotkeys, onExit: killTerminal })

  const handleFocus = useCallback(() => {
    setFocusedId(sessionId)
  }, [setFocusedId, sessionId])

  const openInIde = useCallback(async () => {
    const worktree = statusInfo?.metadata?.worktree as { path?: string } | undefined
    const targetPath = worktree?.path || cwd
    if (!targetPath) return
    await window.ide.open(targetPath)
  }, [statusInfo, cwd])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer.types.includes('Files')) {
      e.dataTransfer.dropEffect = 'copy'
      setIsDragOver(true)
    }
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.currentTarget.contains(e.relatedTarget as Node)) return
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)

    const files = Array.from(e.dataTransfer.files).filter(isImageFile)
    if (files.length === 0) return

    const paths = files
      .map((f) => window.fileUtils.getPathForFile(f))
      .filter((p) => p.length > 0)

    if (paths.length === 0) return

    const quoted = paths.map((p) => (p.includes(' ') ? `'${p}'` : p))
    window.terminal.write(sessionId, quoted.join(' '))
  }, [sessionId])

  const onResizeStart = useCallback(() => {
    resizingRef.current = true
    setIsResizing(true)
  }, [])

  const onResizeEnd = useCallback(() => {
    resizingRef.current = false
    setIsResizing(false)
    fit()
  }, [fit])

  const bodyRef = useCallback(
    (node: HTMLDivElement | null) => {
      bodyElRef.current = node
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect()
        resizeObserverRef.current = null
      }
      if (node) {
        resizeObserverRef.current = new ResizeObserver(() => {
          // Skip resizes during pan/zoom or active drag-resize
          if (isPanningNow() || resizingRef.current) return

          if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current)
          resizeTimerRef.current = setTimeout(() => {
            resizeTimerRef.current = null
            fit()
          }, 150)
        })
        resizeObserverRef.current.observe(node)
      }
    },
    [fit]
  )

  // Native bubble-phase wheel listener: xterm receives the event first (scrolls),
  // then we stop it from reaching d3-zoom (prevents canvas pan).
  // Can't use React's onWheelCapture because it kills the native event at the root
  // before xterm ever sees it.
  useEffect(() => {
    const el = bodyElRef.current
    if (!el || !isFocused) return
    const handler = (e: WheelEvent) => {
      if (!e.ctrlKey) e.stopPropagation()
    }
    el.addEventListener('wheel', handler)
    return () => el.removeEventListener('wheel', handler)
  }, [isFocused])

  useEffect(() => {
    return () => {
      resizeObserverRef.current?.disconnect()
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current)
    }
  }, [])

  return (
    <div
      className={`terminal-tile ${
        isFocused && killHighlight
          ? 'ring-1 ring-red-500/80 shadow-[0_0_25px_rgba(239,68,68,0.3)] animate-pulse'
          : isFocused && teamMeta
            ? 'ring-1 ring-purple-500/60 shadow-[0_0_20px_rgba(139,92,246,0.15)]'
            : isFocused
              ? 'ring-1 ring-blue-500/60 shadow-[0_0_20px_rgba(59,130,246,0.15)]'
              : ''
      }`}
      style={{ width: '100%', height: '100%', pointerEvents: isPanning ? 'none' : 'auto' }}
      onMouseDown={handleFocus}
    >
      <NodeResizer
        minWidth={300}
        minHeight={200}
        isVisible={isFocused}
        color={teamMeta ? '#8b5cf6' : '#3b82f6'}
        onResizeStart={onResizeStart}
        onResizeEnd={onResizeEnd}
      />

      {/* Crown badge for orchestrator/lead */}
      {teamMeta?.isLead && (
        <div className="absolute -top-3 -left-3 z-50 pointer-events-none">
          <span className="text-xl drop-shadow-[0_0_6px_rgba(234,179,8,0.5)]">👑</span>
        </div>
      )}

      {/* Dimension overlay during resize */}
      {isResizing && width != null && height != null && (
        <div className="absolute inset-0 z-50 flex items-center justify-center pointer-events-none">
          <span className="rounded bg-black/80 px-2 py-1 text-xs font-mono text-zinc-300">
            {Math.round(width)} x {Math.round(height)}
          </span>
        </div>
      )}

      {/* Header */}
      <div className={`terminal-tile-header ${isFocused ? (teamMeta ? 'border-b-purple-500/30' : 'border-b-blue-500/30') : ''}`}>
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 shrink-0 rounded-full ${isFocused ? (teamMeta ? 'bg-purple-400' : 'bg-blue-400') : cfg.dot}`} />
            <EditableLabel
              label={label}
              onRename={(newLabel) => renameTile(sessionId, newLabel)}
              className={`text-xs font-medium ${isFocused ? 'text-zinc-200' : 'text-zinc-400'}`}
            />
            <span className={`text-[10px] ${cfg.text}`}>{cfg.label}</span>
          </div>
          {cwd && (
            <span className="pl-4 text-[10px] text-zinc-600" title={cwd}>
              {shortenPath(cwd)}
            </span>
          )}
          {statusInfo?.metadata?.worktree && (
            <span
              className="pl-4 text-[10px] text-emerald-500"
              title={(statusInfo.metadata.worktree as { url?: string }).url}
            >
              {(statusInfo.metadata.worktree as { branch?: string }).branch}
            </span>
          )}
          {teamMeta && (
            <div className="pl-4 flex items-center gap-1.5">
              <span className={`text-[10px] font-medium ${teamMeta.isLead ? 'text-purple-400' : 'text-violet-400'}`}>
                {teamMeta.isLead ? 'Lead' : teamMeta.role || 'Worker'}
              </span>
              {teamMeta.teamName && (
                <span className="text-[10px] text-zinc-600">{teamMeta.teamName}</span>
              )}
            </div>
          )}
          {settings.promptCache?.showTimer !== false &&
           statusInfo?.metadata?.cacheState && (
            <CacheCountdown
              expiresAt={(statusInfo.metadata.cacheExpiresAt as number | undefined) ?? Date.now()}
              state={statusInfo.metadata.cacheState as string}
              sessionId={sessionId}
              warningThreshold={settings.promptCache?.warningThresholdSeconds ?? 60}
            />
          )}
        </div>
        <div className="flex items-center gap-1">
          <WorktreePicker
            sessionId={sessionId}
            cwd={cwd}
            currentWorktree={statusInfo?.metadata?.worktree as { branch?: string; path?: string } | undefined}
          />
          <button
            className="titlebar-no-drag rounded px-1.5 py-0.5 text-xs text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300"
            onClick={openInIde}
            title={settings.general.ideCommand ? `Open in ${settings.general.ideCommand}` : 'No IDE configured — set in Settings > General'}
          >
            IDE
          </button>
          <button
            className={`titlebar-no-drag rounded px-1.5 py-0.5 text-xs ${
              showingDiff ? 'bg-purple-500/20 text-purple-400' : 'text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300'
            }`}
            onClick={() => toggleDiffViewer(sessionId)}
            title="Toggle diff viewer"
          >
            Diff
          </button>
          <button
            className="titlebar-no-drag rounded px-1.5 py-0.5 text-xs text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300"
            onClick={() => killTerminal(sessionId)}
          >
            Kill
          </button>
        </div>
      </div>

      {/* Terminal body */}
      <div
        ref={bodyRef}
        className="terminal-tile-body titlebar-no-drag"
        style={{ position: 'relative' }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Live xterm instance — GPU-composited via WebGL, no snapshot needed.
            will-change:transform + contain on .react-flow__node ensures the compositor
            handles pan transforms without re-rasterizing the WebGL canvas. */}
        <div ref={containerRef} className="h-full w-full" style={{ pointerEvents: isFocused ? 'auto' : 'none' }} />

        {/* Drop overlay */}
        {isDragOver && (
          <div className="absolute inset-0 z-40 flex flex-col items-center justify-center rounded-b-lg bg-zinc-900/90 border-2 border-dashed border-blue-500/60 pointer-events-none">
            <svg className="w-8 h-8 text-blue-400 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z" />
            </svg>
            <span className="text-xs text-blue-300 font-medium">Drop image to paste path</span>
          </div>
        )}
      </div>

      <Handle type="target" position={Position.Left} className="!bg-zinc-600" />
      <Handle type="source" position={Position.Right} className="!bg-zinc-600" />
      {/* Hidden handle for diff viewer connection — never user-connectable */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="diff-source"
        isConnectableStart={false}
        isConnectableEnd={false}
        className="!opacity-0 !w-0 !h-0 !min-w-0 !min-h-0 !border-0"
      />
    </div>
  )
}

export const TerminalTile = memo(TerminalTileComponent)
