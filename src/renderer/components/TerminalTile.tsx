import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { NodeProps, Handle, Position, NodeResizer } from '@xyflow/react'
import { useTerminal } from '@/hooks/useTerminal'
import { useTerminalStatus } from '@/hooks/useTerminalStatus'
import { useFocusedTerminal } from '@/hooks/useFocusedTerminal'
import { useIsPanning, isPanningNow } from '@/hooks/usePanState'
import { registerRender } from '@/hooks/usePerformanceDebug'
import { useSettings } from '@/hooks/useSettings'
import type { TerminalStatus } from '@/hooks/useTerminalStatus'

export interface TerminalNodeData {
  sessionId: string
  label: string
  cwd?: string
}

const STATUS_CONFIG: Record<TerminalStatus, { dot: string; text: string; label: string }> = {
  idle: { dot: 'bg-zinc-500', text: 'text-zinc-500', label: 'Idle' },
  running: { dot: 'bg-green-500', text: 'text-green-400', label: 'Running' },
  waiting: { dot: 'bg-amber-400', text: 'text-amber-400', label: 'Waiting' }
}

function shortenPath(path: string): string {
  const home = path.replace(/^\/Users\/[^/]+/, '~')
  const parts = home.split('/')
  if (parts.length <= 3) return home
  return parts[0] + '/.../' + parts.slice(-2).join('/')
}

function TerminalTileComponent({ data, width, height }: NodeProps) {
  registerRender('TerminalTile')
  const { sessionId, label, cwd: initialCwd } = data as unknown as TerminalNodeData
  const { focusedId, setFocusedId, killTerminal } = useFocusedTerminal()
  const { settings } = useSettings()
  const isPanning = useIsPanning()
  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const bodyElRef = useRef<HTMLDivElement | null>(null)
  const resizingRef = useRef(false)
  const [isResizing, setIsResizing] = useState(false)
  const isFocused = focusedId === sessionId
  const statusInfo = useTerminalStatus(sessionId)
  const status = statusInfo?.status ?? 'running'
  const cwd = statusInfo?.cwd
  const cfg = STATUS_CONFIG[status]

  const appearance = {
    terminalFontFamily: settings.appearance.terminalFontFamily,
    terminalFontSize: settings.appearance.terminalFontSize,
    terminalLineHeight: settings.appearance.terminalLineHeight,
    cursorStyle: settings.appearance.cursorStyle,
    cursorBlink: settings.appearance.cursorBlink,
    scrollback: settings.terminal.scrollback
  }

  const { containerRef, fit } = useTerminal({ sessionId, label, cwd: initialCwd, appearance, hotkeys: settings.hotkeys, onExit: killTerminal })

  const handleFocus = useCallback(() => {
    setFocusedId(sessionId)
  }, [setFocusedId, sessionId])

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
        isFocused
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
        color="#3b82f6"
        onResizeStart={onResizeStart}
        onResizeEnd={onResizeEnd}
      />

      {/* Dimension overlay during resize */}
      {isResizing && width != null && height != null && (
        <div className="absolute inset-0 z-50 flex items-center justify-center pointer-events-none">
          <span className="rounded bg-black/80 px-2 py-1 text-xs font-mono text-zinc-300">
            {Math.round(width)} x {Math.round(height)}
          </span>
        </div>
      )}

      {/* Header */}
      <div className={`terminal-tile-header ${isFocused ? 'border-b-blue-500/30' : ''}`}>
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 shrink-0 rounded-full ${isFocused ? 'bg-blue-400' : cfg.dot}`} />
            <span className={`text-xs font-medium ${isFocused ? 'text-zinc-200' : 'text-zinc-400'}`}>
              {label}
            </span>
            <span className={`text-[10px] ${cfg.text}`}>{cfg.label}</span>
          </div>
          {cwd && (
            <span className="pl-4 text-[10px] text-zinc-600" title={cwd}>
              {shortenPath(cwd)}
            </span>
          )}
        </div>
        <button
          className="titlebar-no-drag rounded px-1.5 py-0.5 text-xs text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300"
          onClick={() => killTerminal(sessionId)}
        >
          Kill
        </button>
      </div>

      {/* Terminal body */}
      <div
        ref={bodyRef}
        className="terminal-tile-body titlebar-no-drag"
        style={{ position: 'relative' }}
      >
        {/* Live xterm instance — GPU-composited via WebGL, no snapshot needed.
            will-change:transform + contain on .react-flow__node ensures the compositor
            handles pan transforms without re-rasterizing the WebGL canvas. */}
        <div ref={containerRef} className="h-full w-full" style={{ pointerEvents: isFocused ? 'auto' : 'none' }} />
      </div>

      <Handle type="target" position={Position.Left} className="!bg-zinc-600" />
      <Handle type="source" position={Position.Right} className="!bg-zinc-600" />
    </div>
  )
}

export const TerminalTile = memo(TerminalTileComponent)
