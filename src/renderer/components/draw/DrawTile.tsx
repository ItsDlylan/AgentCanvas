import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { NodeProps, Handle, Position, NodeResizer } from '@xyflow/react'
import { useDraw } from '@/hooks/useDraw'
import { useFocusedTerminal } from '@/hooks/useFocusedTerminal'
import { useIsPanning } from '@/hooks/usePanState'
import { registerRender } from '@/hooks/usePerformanceDebug'
import { EditableLabel } from '../EditableLabel'
import { DrawCanvas } from './DrawCanvas'
import { MermaidDialog } from './MermaidDialog'
export interface DrawNodeData {
  sessionId: string
  label: string
  linkedTerminalId?: string
  onClose?: (sessionId: string) => void
  onDelete?: (sessionId: string) => void
}

function DrawTileComponent({ data, width, height }: NodeProps) {
  registerRender('DrawTile')
  const { sessionId, label, onClose, onDelete } = data as unknown as DrawNodeData
  const { focusedId, setFocusedId, killHighlight, renameTile } = useFocusedTerminal()
  const isPanning = useIsPanning()
  const isFocused = focusedId === sessionId
  const bodyElRef = useRef<HTMLDivElement | null>(null)
  const [isResizing, setIsResizing] = useState(false)
  const [mermaidOpen, setMermaidOpen] = useState(false)

  const {
    state,
    loaded,
    selectedIds,
    setSelectedIds,
    addShape,
    updateShape,
    addArrow,
    addFreehand,
    deleteSelected,
    updateCamera,
    clearCanvas,
    addElements,
    undo,
    redo
  } = useDraw({ drawId: sessionId })

  const handleFocus = useCallback(() => {
    setFocusedId(sessionId)
  }, [setFocusedId, sessionId])

  const onResizeStart = useCallback(() => setIsResizing(true), [])
  const onResizeEnd = useCallback(() => setIsResizing(false), [])

  // Prevent canvas pan when scrolling inside draw body (for Konva zoom)
  useEffect(() => {
    const el = bodyElRef.current
    if (!el || !isFocused) return
    const handler = (e: WheelEvent) => {
      e.stopPropagation()
    }
    el.addEventListener('wheel', handler)
    return () => el.removeEventListener('wheel', handler)
  }, [isFocused])

  const handleExport = useCallback(async () => {
    const format = 'json'
    window.draw.save(sessionId, {}, [...state.shapes, ...state.arrows, ...state.freehand] as unknown[], { camera: state.camera } as Record<string, unknown>)
  }, [sessionId, state])

  const canvasWidth = (width ?? 800) - 2 // Account for border
  const canvasHeight = (height ?? 600) - 38 // Account for header

  return (
    <div
      className={`draw-tile ${
        isFocused && killHighlight
          ? 'ring-1 ring-red-500/80 shadow-[0_0_25px_rgba(239,68,68,0.3)] animate-pulse'
          : isFocused
            ? 'ring-1 ring-blue-500/60 shadow-[0_0_20px_rgba(59,130,246,0.15)]'
            : ''
      }`}
      style={{ width: '100%', height: '100%', pointerEvents: isPanning ? 'none' : 'auto' }}
      onMouseDown={handleFocus}
    >
      <NodeResizer
        minWidth={400}
        minHeight={300}
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
      <div className={`draw-tile-header ${isFocused ? 'border-b-blue-500/30' : ''}`}>
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 shrink-0 rounded-full ${isFocused ? 'bg-pink-400' : 'bg-zinc-500'}`} />
          <EditableLabel
            label={label}
            onRename={(newLabel) => renameTile(sessionId, newLabel)}
            className={`text-xs font-medium ${isFocused ? 'text-zinc-200' : 'text-zinc-400'}`}
          />
          <span className="text-[10px] text-zinc-500">Draw</span>
        </div>
        <div className="flex items-center gap-1">
          {/* Mermaid import */}
          <button
            className="titlebar-no-drag rounded px-1.5 py-0.5 text-[10px] text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300"
            onClick={() => setMermaidOpen(true)}
            title="Import Mermaid diagram"
          >
            Mermaid
          </button>
          {/* Clear canvas */}
          <button
            className="titlebar-no-drag rounded px-1.5 py-0.5 text-xs text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300"
            onClick={clearCanvas}
            title="Clear canvas"
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
          {/* Soft close */}
          <button
            className="titlebar-no-drag rounded px-1.5 py-0.5 text-xs text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300"
            onClick={() => onClose?.(sessionId)}
            title="Close (keep file)"
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          {/* Hard delete */}
          <button
            className="titlebar-no-drag rounded px-1.5 py-0.5 text-xs text-zinc-500 hover:bg-zinc-700 hover:text-red-400"
            onClick={() => onDelete?.(sessionId)}
            title="Delete permanently"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>

      {/* Canvas body */}
      <div
        ref={bodyElRef}
        className="draw-tile-body titlebar-no-drag"
        style={{ pointerEvents: isFocused ? 'auto' : 'none' }}
      >
        {loaded && canvasWidth > 0 && canvasHeight > 0 && (
          <DrawCanvas
            state={state}
            width={canvasWidth}
            height={canvasHeight}
            selectedIds={selectedIds}
            setSelectedIds={setSelectedIds}
            addShape={addShape}
            updateShape={updateShape}
            addArrow={addArrow}
            addFreehand={addFreehand}
            deleteSelected={deleteSelected}
            updateCamera={updateCamera}
            undo={undo}
            redo={redo}
          />
        )}

        {/* Mermaid dialog overlay */}
        <MermaidDialog
          open={mermaidOpen}
          onClose={() => setMermaidOpen(false)}
          onImport={addElements}
        />
      </div>

      <Handle type="target" position={Position.Left} className="!bg-zinc-600" />
      <Handle type="source" position={Position.Right} className="!bg-zinc-600" />
    </div>
  )
}

export const DrawTile = memo(DrawTileComponent)
