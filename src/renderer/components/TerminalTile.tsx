import { memo, useCallback, useEffect, useRef } from 'react'
import { NodeProps, Handle, Position } from '@xyflow/react'
import { useTerminal } from '@/hooks/useTerminal'

export interface TerminalNodeData {
  sessionId: string
  label: string
  cwd?: string
  onKill?: (sessionId: string) => void
}

/**
 * A React Flow custom node that renders a live terminal session.
 *
 * The terminal is an xterm.js instance connected to a PTY in the
 * main process. The node is draggable by its header bar.
 */
function TerminalTileComponent({ data, selected }: NodeProps) {
  const { sessionId, label, onKill } = data as unknown as TerminalNodeData
  const resizeObserverRef = useRef<ResizeObserver | null>(null)

  const { containerRef, fit } = useTerminal({ sessionId })

  // Re-fit on container resize
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
      className={`terminal-tile ${selected ? 'ring-1 ring-blue-500/50' : ''}`}
      style={{ width: 640, height: 400 }}
    >
      {/* Header — this is the drag handle */}
      <div className="terminal-tile-header">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-green-500" />
          <span className="text-xs font-medium text-zinc-400">{label}</span>
        </div>
        <button
          className="titlebar-no-drag rounded px-1.5 py-0.5 text-xs text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300"
          onClick={() => onKill?.(sessionId)}
        >
          Kill
        </button>
      </div>

      {/* Terminal body — pointer events enabled so xterm gets focus */}
      <div ref={bodyRef} className="terminal-tile-body titlebar-no-drag">
        <div ref={containerRef} className="h-full w-full" />
      </div>

      {/* React Flow connection handles (optional, for future agent wiring) */}
      <Handle type="target" position={Position.Left} className="!bg-zinc-600" />
      <Handle type="source" position={Position.Right} className="!bg-zinc-600" />
    </div>
  )
}

export const TerminalTile = memo(TerminalTileComponent)
