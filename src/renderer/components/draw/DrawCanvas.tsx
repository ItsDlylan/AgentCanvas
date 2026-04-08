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
      <div ref={zoomElRef} className="absolute bottom-2 right-2 rounded bg-zinc-800/80 px-2 py-1 text-[10px] text-zinc-500 pointer-events-none">
        {Math.round(cameraRef.current.zoom * 100)}%
      </div>
    </div>
  )
}


/** Toolbar overlay positioned inside the canvas */
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
  const tools: { key: import('@/lib/draw-types').DrawTool; label: string; shortcut: string }[] = [
    { key: 'select', label: 'Select', shortcut: 'V' },
    { key: 'rectangle', label: 'Rect', shortcut: 'R' },
    { key: 'diamond', label: 'Diamond', shortcut: 'D' },
    { key: 'ellipse', label: 'Ellipse', shortcut: 'O' },
    { key: 'cylinder', label: 'Cylinder', shortcut: '' },
    { key: 'roundedRect', label: 'Rounded', shortcut: '' },
    { key: 'dbTable', label: 'DB Table', shortcut: '' },
    { key: 'text', label: 'Text', shortcut: 'T' },
    { key: 'arrow', label: 'Arrow', shortcut: 'A' },
    { key: 'freehand', label: 'Draw', shortcut: 'F' }
  ]

  const colors = ['transparent', '#e4e4e7', '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#ec4899']

  return (
    <div className="absolute left-2 top-2 flex flex-col gap-1 rounded-md border border-zinc-700 bg-zinc-800/95 p-1.5 shadow-lg">
      {tools.map((t) => (
        <button
          key={t.key}
          onClick={() => setActiveTool(t.key)}
          title={`${t.label}${t.shortcut ? ` (${t.shortcut})` : ''}`}
          className={`rounded px-2 py-1 text-[10px] font-medium transition-colors ${
            activeTool === t.key
              ? 'bg-blue-500/20 text-blue-400'
              : 'text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
          }`}
        >
          {t.label}
        </button>
      ))}

      <div className="my-1 h-px bg-zinc-700" />

      {/* Stroke color */}
      <div className="flex flex-wrap gap-0.5 px-0.5">
        {colors.slice(1).map((c) => (
          <button
            key={`s-${c}`}
            onClick={() => setStrokeColor(c)}
            className={`h-3.5 w-3.5 rounded-sm border ${strokeColor === c ? 'border-blue-400' : 'border-zinc-600'}`}
            style={{ backgroundColor: c }}
            title={`Stroke: ${c}`}
          />
        ))}
      </div>

      {/* Fill color */}
      <div className="flex flex-wrap gap-0.5 px-0.5">
        {colors.map((c) => (
          <button
            key={`f-${c}`}
            onClick={() => setFillColor(c)}
            className={`h-3.5 w-3.5 rounded-sm border ${fillColor === c ? 'border-blue-400' : 'border-zinc-600'}`}
            style={{ backgroundColor: c === 'transparent' ? '#09090b' : c }}
            title={`Fill: ${c === 'transparent' ? 'none' : c}`}
          >
            {c === 'transparent' && <span className="text-[8px] text-zinc-500 leading-none block text-center">/</span>}
          </button>
        ))}
      </div>

      <div className="my-1 h-px bg-zinc-700" />

      {/* Grid snap toggle */}
      <button
        onClick={() => setGridSnap(!gridSnap)}
        className={`rounded px-2 py-1 text-[10px] font-medium ${
          gridSnap ? 'bg-blue-500/20 text-blue-400' : 'text-zinc-400 hover:bg-zinc-700'
        }`}
        title="Grid snap (G)"
      >
        Grid
      </button>
    </div>
  )
}
