import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { NodeProps, Handle, Position } from '@xyflow/react'
import { useTerminal } from '@/hooks/useTerminal'
import { useTerminalStatus } from '@/hooks/useTerminalStatus'
import { useFocusedTerminal } from '@/hooks/useFocusedTerminal'
import type { TerminalStatus } from '@/hooks/useTerminalStatus'

export interface TerminalNodeData {
  sessionId: string
  label: string
  cwd?: string
}

const STATUS_CONFIG: Record<TerminalStatus, { dot: string; text: string; label: string }> = {
  idle: { dot: 'bg-zinc-500', text: 'text-zinc-500', label: 'Idle' },
  running: { dot: 'bg-green-500', text: 'text-green-400', label: 'Running' },
  waiting: { dot: 'bg-amber-400 animate-pulse', text: 'text-amber-400', label: 'Waiting' }
}

function shortenPath(path: string): string {
  const home = path.replace(/^\/Users\/[^/]+/, '~')
  const parts = home.split('/')
  if (parts.length <= 3) return home
  return parts[0] + '/.../' + parts.slice(-2).join('/')
}

function TerminalTileComponent({ data }: NodeProps) {
  const { sessionId, label } = data as unknown as TerminalNodeData
  const { focusedId, setFocusedId, killTerminal } = useFocusedTerminal()
  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  const [hovered, setHovered] = useState(false)
  const isFocused = focusedId === sessionId
  const statusInfo = useTerminalStatus(sessionId)
  const status = statusInfo?.status ?? 'running'
  const cwd = statusInfo?.cwd
  const cfg = STATUS_CONFIG[status]

  const { containerRef, fit } = useTerminal({ sessionId, label, onExit: killTerminal })

  const handleFocus = useCallback(() => {
    setFocusedId(sessionId)
  }, [setFocusedId, sessionId])

  const bodyRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect()
        resizeObserverRef.current = null
      }
      if (node) {
        resizeObserverRef.current = new ResizeObserver(() => fit())
        resizeObserverRef.current.observe(node)
      }
    },
    [fit]
  )

  useEffect(() => {
    return () => resizeObserverRef.current?.disconnect()
  }, [])

  return (
    <div
      className={`terminal-tile ${
        isFocused
          ? 'ring-1 ring-blue-500/60 shadow-[0_0_20px_rgba(59,130,246,0.15)]'
          : ''
      }`}
      style={{ width: 640, height: 400 }}
      onMouseDown={handleFocus}
    >
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

      {/* Terminal body — only capture scroll when mouse is inside */}
      <div
        ref={bodyRef}
        className="terminal-tile-body titlebar-no-drag"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onWheelCapture={(e) => {
          if (isFocused && hovered && !e.ctrlKey) e.stopPropagation()
        }}
      >
        <div ref={containerRef} className="h-full w-full" />
      </div>

      <Handle type="target" position={Position.Left} className="!bg-zinc-600" />
      <Handle type="source" position={Position.Right} className="!bg-zinc-600" />
    </div>
  )
}

export const TerminalTile = memo(TerminalTileComponent)
