/**
 * Core drawing canvas using Konva.
 * Handles rendering all shapes, arrows, freehand, grid, and interaction.
 */
import { useCallback, useRef, useEffect, useState } from 'react'
import { Stage, Layer, Rect, Line, Shape as KonvaShape } from 'react-konva'
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
  const [gridSnap, setGridSnap] = useState(false)
  const [camera, setCamera] = useState<Camera>(state.camera)

  // Sync camera from loaded state
  useEffect(() => {
    setCamera(state.camera)
  }, [state.camera])

  const tools = useDrawTools({
    addShape,
    addArrow,
    addFreehand,
    updateShape,
    setSelectedIds,
    shapes: state.shapes,
    camera,
    gridSnap
  })

  // Zoom handler
  const onWheel = useCallback((e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault()
    const stage = stageRef.current
    if (!stage) return

    const oldZoom = camera.zoom
    const pointer = stage.getPointerPosition()
    if (!pointer) return

    const direction = e.evt.deltaY > 0 ? -1 : 1
    const factor = 1.08
    const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, direction > 0 ? oldZoom * factor : oldZoom / factor))

    const mousePointTo = {
      x: (pointer.x - camera.x) / oldZoom,
      y: (pointer.y - camera.y) / oldZoom
    }

    const newCamera: Camera = {
      x: pointer.x - mousePointTo.x * newZoom,
      y: pointer.y - mousePointTo.y * newZoom,
      zoom: newZoom
    }

    setCamera(newCamera)
    updateCamera(newCamera)
  }, [camera, updateCamera])

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
    <div className="relative w-full h-full">
      <Stage
        ref={stageRef}
        width={width}
        height={height}
        x={camera.x}
        y={camera.y}
        scaleX={camera.zoom}
        scaleY={camera.zoom}
        draggable={tools.activeTool === 'select'}
        onWheel={onWheel}
        onClick={handleStageClick}
        onMouseDown={(e) => {
          if (tools.activeTool !== 'select' || e.target !== e.target.getStage()) {
            tools.onPointerDown(stageRef.current!, e)
          }
        }}
        onMouseMove={(e) => tools.onPointerMove(stageRef.current!, e)}
        onMouseUp={(e) => tools.onPointerUp(stageRef.current!, e)}
        onDragEnd={(e) => {
          if (e.target === stageRef.current) {
            const newCamera: Camera = {
              x: e.target.x(),
              y: e.target.y(),
              zoom: camera.zoom
            }
            setCamera(newCamera)
            updateCamera(newCamera)
          }
        }}
        style={{ cursor: tools.activeTool === 'select' ? 'default' : 'crosshair' }}
      >
        {/* Grid layer */}
        <Layer listening={false}>
          <GridPattern width={width} height={height} camera={camera} />
        </Layer>

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
      <div className="absolute bottom-2 right-2 rounded bg-zinc-800/80 px-2 py-1 text-[10px] text-zinc-500 pointer-events-none">
        {Math.round(camera.zoom * 100)}%
      </div>
    </div>
  )
}

/** Grid pattern for the canvas background */
function GridPattern({ width, height, camera }: { width: number; height: number; camera: Camera }) {
  return (
    <KonvaShape
      sceneFunc={(ctx) => {
        const c = ctx._context
        const zoom = camera.zoom
        const gridSize = GRID_SIZE

        // Only show grid when zoomed in enough
        if (zoom < 0.3) return

        const startX = Math.floor(-camera.x / zoom / gridSize) * gridSize
        const startY = Math.floor(-camera.y / zoom / gridSize) * gridSize
        const endX = startX + width / zoom + gridSize * 2
        const endY = startY + height / zoom + gridSize * 2

        c.beginPath()
        c.strokeStyle = zoom > 0.6 ? '#1a1a1f' : '#141418'
        c.lineWidth = 0.5

        for (let x = startX; x <= endX; x += gridSize) {
          c.moveTo(x, startY)
          c.lineTo(x, endY)
        }
        for (let y = startY; y <= endY; y += gridSize) {
          c.moveTo(startX, y)
          c.lineTo(endX, y)
        }
        c.stroke()
      }}
    />
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
