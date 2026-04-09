/**
 * Core drawing canvas using Konva.
 * Handles rendering all shapes, arrows, freehand, grid, and interaction.
 */
import { useCallback, useRef, useEffect, useState } from 'react'
import { Stage, Layer, Rect, Line } from 'react-konva'
import type Konva from 'konva'
import type { DrawingState, Shape, Arrow, FreehandStroke, Camera } from '@/lib/draw-types'
import { RoughShapeComponent } from './shapes/RoughShape'
import { ArrowShapeComponent } from './shapes/ArrowShape'
import { FreehandShapeComponent } from './shapes/FreehandShape'
import { useDrawTools } from '@/hooks/useDrawTools'

interface DrawCanvasProps {
  state: DrawingState
  width: number
  height: number
  selectedIds: Set<string>
  setSelectedIds: (ids: Set<string>) => void
  addShape: (shape: Shape) => void
  updateShape: (id: string, updates: Partial<Shape>) => void
  addArrow: (arrow: Arrow) => void
  addFreehand: (stroke: FreehandStroke) => void
  deleteSelected: () => void
  updateCamera: (camera: Camera) => void
  undo: () => void
  redo: () => void
}

const MIN_ZOOM = 0.1
const MAX_ZOOM = 5
const GRID_SIZE = 20

export function DrawCanvas({
  state,
  width,
  height,
  selectedIds,
  setSelectedIds,
  addShape,
  updateShape,
  addArrow,
  addFreehand,
  deleteSelected,
  updateCamera,
  undo,
  redo
}: DrawCanvasProps) {
  const stageRef = useRef<Konva.Stage>(null)
  const middleDragRef = useRef<{ startX: number; startY: number; camX: number; camY: number } | null>(null)
  const [gridSnap, setGridSnap] = useState(false)

  // Camera lives in a ref to avoid re-rendering all shapes on pan/zoom.
  // Only the Stage transform + CSS grid background need updating.
  const cameraRef = useRef<Camera>(state.camera)
  const gridElRef = useRef<HTMLDivElement>(null)
  const zoomElRef = useRef<HTMLDivElement>(null)

  /** Imperatively update Stage transform + CSS grid — no React re-render */
  const applyCamera = useCallback((cam: Camera) => {
    const stage = stageRef.current
    if (stage) {
      stage.position({ x: cam.x, y: cam.y })
      stage.scale({ x: cam.zoom, y: cam.zoom })
      stage.batchDraw()
    }
    const gridEl = gridElRef.current
    if (gridEl) {
      const sz = GRID_SIZE * cam.zoom
      if (cam.zoom >= 0.3) {
        const color = cam.zoom > 0.6 ? '#27272a' : '#1c1c20'
        gridEl.style.backgroundImage = `radial-gradient(circle, ${color} 1px, transparent 1px)`
        gridEl.style.backgroundSize = `${sz}px ${sz}px`
        gridEl.style.backgroundPosition = `${cam.x % sz}px ${cam.y % sz}px`
      } else {
        gridEl.style.backgroundImage = 'none'
      }
    }
    const zoomEl = zoomElRef.current
    if (zoomEl) {
      zoomEl.textContent = `${Math.round(cam.zoom * 100)}%`
    }
  }, [])

  // Apply camera on initial mount only
  useEffect(() => {
    applyCamera(cameraRef.current)
  }, [applyCamera])

  const tools = useDrawTools({
    addShape,
    addArrow,
    addFreehand,
    updateShape,
    setSelectedIds,
    shapes: state.shapes,
    camera: cameraRef.current,
    gridSnap
  })

  // Wheel handler — pinch/ctrl+scroll to zoom, plain scroll to pan
  const onWheel = useCallback((e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault()
    const stage = stageRef.current
    if (!stage) return

    const pointer = stage.getPointerPosition()
    if (!pointer) return

    const cam = cameraRef.current

    // Pinch zoom (ctrl/meta + scroll) or trackpad pinch
    if (e.evt.ctrlKey || e.evt.metaKey) {
      const oldZoom = cam.zoom
      const direction = e.evt.deltaY > 0 ? -1 : 1
      const factor = 1.08
      const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, direction > 0 ? oldZoom * factor : oldZoom / factor))

      const mousePointTo = {
        x: (pointer.x - cam.x) / oldZoom,
        y: (pointer.y - cam.y) / oldZoom
      }

      const newCamera: Camera = {
        x: pointer.x - mousePointTo.x * newZoom,
        y: pointer.y - mousePointTo.y * newZoom,
        zoom: newZoom
      }
      cameraRef.current = newCamera
      applyCamera(newCamera)
      updateCamera(newCamera)
    } else {
      // Plain scroll → pan
      const newCamera: Camera = {
        x: cam.x - e.evt.deltaX,
        y: cam.y - e.evt.deltaY,
        zoom: cam.zoom
      }
      cameraRef.current = newCamera
      applyCamera(newCamera)
      updateCamera(newCamera)
    }
  }, [applyCamera, updateCamera])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        deleteSelected()
        e.preventDefault()
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        undo()
        e.preventDefault()
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && e.shiftKey) {
        redo()
        e.preventDefault()
      }
      // Tool shortcuts
      if (e.key === 'v' || e.key === 'Escape') tools.setActiveTool('select')
      if (e.key === 'r') tools.setActiveTool('rectangle')
      if (e.key === 'd') tools.setActiveTool('diamond')
      if (e.key === 'o') tools.setActiveTool('ellipse')
      if (e.key === 'a') tools.setActiveTool('arrow')
      if (e.key === 'f') tools.setActiveTool('freehand')
      if (e.key === 't') tools.setActiveTool('text')
      if (e.key === 'g') setGridSnap((prev) => !prev)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [deleteSelected, undo, redo, tools])

  const handleShapeSelect = useCallback((id: string) => {
    setSelectedIds(new Set([id]))
  }, [setSelectedIds])

  const handleShapeDragEnd = useCallback((id: string, x: number, y: number) => {
    updateShape(id, { x, y })
  }, [updateShape])

  const handleStageClick = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    // Only deselect if clicking empty stage area
    if (e.target === e.target.getStage()) {
      if (tools.activeTool === 'select') {
        setSelectedIds(new Set())
      }
    }
  }, [setSelectedIds, tools.activeTool])

  return (
    <div ref={gridElRef} className="relative w-full h-full bg-[#09090b]">
      <Stage
        ref={stageRef}
        width={width}
        height={height}
        draggable={false}
        onWheel={onWheel}
        onClick={handleStageClick}
        onMouseDown={(e) => {
          // Middle mouse button (1) → start drag-to-pan
          if (e.evt.button === 1) {
            e.evt.preventDefault()
            const cam = cameraRef.current
            middleDragRef.current = { startX: e.evt.clientX, startY: e.evt.clientY, camX: cam.x, camY: cam.y }
            return
          }
          // Left click → tool action (or deselect on empty stage in select mode)
          if (e.evt.button === 0) {
            if (tools.activeTool !== 'select' || e.target !== e.target.getStage()) {
              tools.onPointerDown(stageRef.current!, e)
            }
          }
        }}
        onMouseMove={(e) => {
          // Middle-drag panning
          if (middleDragRef.current) {
            const dx = e.evt.clientX - middleDragRef.current.startX
            const dy = e.evt.clientY - middleDragRef.current.startY
            const newCamera: Camera = {
              x: middleDragRef.current.camX + dx,
              y: middleDragRef.current.camY + dy,
              zoom: cameraRef.current.zoom
            }
            cameraRef.current = newCamera
            applyCamera(newCamera)
            return
          }
          tools.onPointerMove(stageRef.current!, e)
        }}
        onMouseUp={(e) => {
          if (middleDragRef.current) {
            updateCamera(cameraRef.current)
            middleDragRef.current = null
            return
          }
          tools.onPointerUp(stageRef.current!, e)
        }}
        style={{ cursor: tools.activeTool === 'select' ? 'default' : 'crosshair' }}
      >
        {/* Shapes layer */}
        <Layer>
          {state.shapes.map((shape) => (
            <RoughShapeComponent
              key={shape.id}
              shape={shape}
              isSelected={selectedIds.has(shape.id)}
              onSelect={handleShapeSelect}
              onDragEnd={handleShapeDragEnd}
            />
          ))}
        </Layer>

        {/* Arrows layer */}
        <Layer>
          {state.arrows.map((arrow) => (
            <ArrowShapeComponent
              key={arrow.id}
              arrow={arrow}
              shapes={state.shapes}
              isSelected={selectedIds.has(arrow.id)}
              onSelect={handleShapeSelect}
            />
          ))}
        </Layer>

        {/* Freehand layer */}
        <Layer>
          {state.freehand.map((stroke) => (
            <FreehandShapeComponent
              key={stroke.id}
              stroke={stroke}
              isSelected={selectedIds.has(stroke.id)}
              onSelect={handleShapeSelect}
            />
          ))}
        </Layer>

        {/* Preview layer — ghost shape, arrow preview, freehand preview */}
        <Layer listening={false}>
          {/* Shape ghost */}
          {tools.ghost && (
            <Rect
              x={tools.ghost.x}
              y={tools.ghost.y}
              width={tools.ghost.width}
              height={tools.ghost.height}
              stroke="#3b82f6"
              strokeWidth={1}
              dash={[6, 3]}
              fill="rgba(59, 130, 246, 0.05)"
            />
          )}

          {/* Arrow preview */}
          {tools.arrowPreview && (
            <Line
              points={[
                tools.arrowPreview.x1, tools.arrowPreview.y1,
                tools.arrowPreview.x2, tools.arrowPreview.y2
              ]}
              stroke="#3b82f6"
              strokeWidth={2}
              dash={[6, 3]}
            />
          )}

          {/* Freehand preview */}
          {tools.freehandPreview.length > 1 && (
            <Line
              points={tools.freehandPreview.flatMap(([x, y]) => [x, y])}
              stroke={tools.strokeColor}
              strokeWidth={2}
              tension={0.5}
              lineCap="round"
              lineJoin="round"
            />
          )}
        </Layer>
      </Stage>

      {/* Toolbar overlay */}
      <DrawToolbarOverlay
        activeTool={tools.activeTool}
        setActiveTool={tools.setActiveTool}
        strokeColor={tools.strokeColor}
        setStrokeColor={tools.setStrokeColor}
        fillColor={tools.fillColor}
        setFillColor={tools.setFillColor}
        gridSnap={gridSnap}
        setGridSnap={setGridSnap}
      />

      {/* Zoom display */}
      <div ref={zoomElRef} className="absolute bottom-3 left-3 rounded bg-zinc-800/80 px-2 py-1 text-[10px] text-zinc-500 pointer-events-none">
        {Math.round(cameraRef.current.zoom * 100)}%
      </div>
    </div>
  )
}


/** Horizontal bottom toolbar with icons */
function DrawToolbarOverlay({
  activeTool,
  setActiveTool,
  strokeColor,
  setStrokeColor,
  fillColor,
  setFillColor,
  gridSnap,
  setGridSnap
}: {
  activeTool: string
  setActiveTool: (tool: import('@/lib/draw-types').DrawTool) => void
  strokeColor: string
  setStrokeColor: (c: string) => void
  fillColor: string
  setFillColor: (c: string) => void
  gridSnap: boolean
  setGridSnap: (v: boolean) => void
}) {
  const colors = ['transparent', '#e4e4e7', '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#ec4899']

  return (
    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-0.5 rounded-lg border border-zinc-700 bg-zinc-800/95 px-1.5 py-1 shadow-lg backdrop-blur-sm">
      {/* Tools */}
      <ToolBtn active={activeTool === 'select'} onClick={() => setActiveTool('select')} title="Select (V)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
        </svg>
      </ToolBtn>

      <Separator />

      <ToolBtn active={activeTool === 'rectangle'} onClick={() => setActiveTool('rectangle')} title="Rectangle (R)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
          <rect x="3" y="3" width="18" height="18" rx="1" />
        </svg>
      </ToolBtn>
      <ToolBtn active={activeTool === 'roundedRect'} onClick={() => setActiveTool('roundedRect')} title="Rounded Rect">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
          <rect x="3" y="3" width="18" height="18" rx="5" />
        </svg>
      </ToolBtn>
      <ToolBtn active={activeTool === 'diamond'} onClick={() => setActiveTool('diamond')} title="Diamond (D)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
          <path d="M12 2l10 10-10 10L2 12z" />
        </svg>
      </ToolBtn>
      <ToolBtn active={activeTool === 'ellipse'} onClick={() => setActiveTool('ellipse')} title="Ellipse (O)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
          <ellipse cx="12" cy="12" rx="10" ry="8" />
        </svg>
      </ToolBtn>
      <ToolBtn active={activeTool === 'cylinder'} onClick={() => setActiveTool('cylinder')} title="Cylinder">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
          <ellipse cx="12" cy="5" rx="8" ry="3" />
          <path d="M4 5v14c0 1.66 3.58 3 8 3s8-1.34 8-3V5" />
        </svg>
      </ToolBtn>
      <ToolBtn active={activeTool === 'dbTable'} onClick={() => setActiveTool('dbTable')} title="DB Table">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M3 9h18M3 15h18" />
        </svg>
      </ToolBtn>

      <Separator />

      <ToolBtn active={activeTool === 'arrow'} onClick={() => setActiveTool('arrow')} title="Arrow (A)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 19L19 5m0 0h-8m8 0v8" />
        </svg>
      </ToolBtn>
      <ToolBtn active={activeTool === 'text'} onClick={() => setActiveTool('text')} title="Text (T)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 7V4h16v3M9 20h6M12 4v16" />
        </svg>
      </ToolBtn>
      <ToolBtn active={activeTool === 'freehand'} onClick={() => setActiveTool('freehand')} title="Draw (F)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
        </svg>
      </ToolBtn>

      <Separator />

      {/* Stroke color */}
      <div className="flex items-center gap-0.5 px-0.5">
        {colors.slice(1).map((c) => (
          <button
            key={`s-${c}`}
            onClick={() => setStrokeColor(c)}
            className={`h-4 w-4 rounded-full border-2 ${strokeColor === c ? 'border-blue-400 scale-110' : 'border-zinc-600 hover:border-zinc-400'}`}
            style={{ backgroundColor: c }}
            title={`Stroke: ${c}`}
          />
        ))}
      </div>

      <Separator />

      {/* Fill color */}
      <div className="flex items-center gap-0.5 px-0.5">
        {colors.map((c) => (
          <button
            key={`f-${c}`}
            onClick={() => setFillColor(c)}
            className={`h-4 w-4 rounded-full border-2 ${fillColor === c ? 'border-blue-400 scale-110' : 'border-zinc-600 hover:border-zinc-400'}`}
            style={{ backgroundColor: c === 'transparent' ? '#09090b' : c }}
            title={`Fill: ${c === 'transparent' ? 'none' : c}`}
          >
            {c === 'transparent' && (
              <svg viewBox="0 0 16 16" className="h-full w-full text-zinc-500">
                <line x1="3" y1="13" x2="13" y2="3" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            )}
          </button>
        ))}
      </div>

      <Separator />

      {/* Grid snap */}
      <ToolBtn active={gridSnap} onClick={() => setGridSnap(!gridSnap)} title="Grid snap (G)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
          <path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" />
        </svg>
      </ToolBtn>
    </div>
  )
}

function ToolBtn({ active, onClick, title, children }: { active: boolean; onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
        active
          ? 'bg-blue-500/20 text-blue-400'
          : 'text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
      }`}
    >
      {children}
    </button>
  )
}

function Separator() {
  return <div className="mx-0.5 h-5 w-px bg-zinc-700" />
}
