/**
 * Core drawing canvas using Konva.
 * Handles rendering all shapes, arrows, freehand, grid, and interaction.
 */
import { useCallback, useRef, useEffect, useState } from 'react'
import { Stage, Layer, Rect, Line, Transformer } from 'react-konva'
import type Konva from 'konva'
import type { DrawingState, Shape, Arrow, FreehandStroke, Camera, TextShape } from '@/lib/draw-types'
import { resolveBinding } from '@/lib/draw-types'
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
  editingId: string | null
  setEditingId: (id: string | null) => void
  addShape: (shape: Shape) => void
  updateShape: (id: string, updates: Partial<Shape>) => void
  updateArrow: (id: string, updates: Partial<Arrow>) => void
  addArrow: (arrow: Arrow) => void
  updateFreehand: (id: string, updates: Partial<FreehandStroke>) => void
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
  editingId,
  setEditingId,
  addShape,
  updateShape,
  updateArrow,
  addArrow,
  updateFreehand,
  addFreehand,
  deleteSelected,
  updateCamera,
  undo,
  redo
}: DrawCanvasProps) {
  const stageRef = useRef<Konva.Stage>(null)
  const middleDragRef = useRef<{ startX: number; startY: number; camX: number; camY: number } | null>(null)
  const [gridSnap, setGridSnap] = useState(false)
  const transformerRef = useRef<Konva.Transformer>(null)
  const shapeNodesRef = useRef<Map<string, Konva.Group>>(new Map())
  const editingIdRef = useRef(editingId)
  editingIdRef.current = editingId

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

  // Attach Transformer to selected shape nodes
  useEffect(() => {
    if (!transformerRef.current) return
    const selectedNodes: Konva.Group[] = []
    selectedIds.forEach((id) => {
      const node = shapeNodesRef.current.get(id)
      if (node) selectedNodes.push(node)
    })
    transformerRef.current.nodes(selectedNodes)
    transformerRef.current.getLayer()?.batchDraw()
  }, [selectedIds, state.shapes])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Suppress all shortcuts during inline text editing
      if (editingIdRef.current) return

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

  const handleDoubleClick = useCallback((id: string) => {
    setEditingId(id)
  }, [setEditingId])

  const registerShapeRef = useCallback((id: string, node: Konva.Group | null) => {
    if (node) {
      shapeNodesRef.current.set(id, node)
    } else {
      shapeNodesRef.current.delete(id)
    }
  }, [])

  const handleTransformEnd = useCallback((id: string, node: Konva.Group) => {
    const scaleX = node.scaleX()
    const scaleY = node.scaleY()
    const shape = state.shapes.find((s) => s.id === id)
    if (!shape) return
    updateShape(id, {
      x: node.x(),
      y: node.y(),
      width: Math.max(20, shape.width * scaleX),
      height: Math.max(20, shape.height * scaleY),
      rotation: node.rotation()
    })
    // Reset scale — dimensions are now baked into width/height
    node.scaleX(1)
    node.scaleY(1)
  }, [updateShape, state.shapes])

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
          // Left click → tool action (skip in select mode — shapes handle their
          // own selection via onClick, and deselect on empty space is handled by
          // handleStageClick. Calling onPointerDown here in select mode would
          // deselect and break Transformer resize drags.)
          if (e.evt.button === 0 && tools.activeTool !== 'select') {
            tools.onPointerDown(stageRef.current!, e)
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
              onDoubleClick={handleDoubleClick}
              registerRef={registerShapeRef}
              onTransformEnd={handleTransformEnd}
            />
          ))}
          <Transformer
            ref={transformerRef}
            rotateEnabled={true}
            enabledAnchors={['top-left', 'top-center', 'top-right', 'middle-left', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right']}
            boundBoxFunc={(_oldBox, newBox) => {
              if (Math.abs(newBox.width) < 20 || Math.abs(newBox.height) < 20) {
                return _oldBox
              }
              return newBox
            }}
            borderStroke="#3b82f6"
            borderStrokeWidth={1.5}
            borderDash={[6, 3]}
            anchorFill="#3b82f6"
            anchorStroke="#1d4ed8"
            anchorSize={8}
            anchorCornerRadius={2}
          />
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
              onDoubleClick={handleDoubleClick}
              updateArrow={updateArrow}
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

      {/* Inline text edit overlay */}
      {editingId && (() => {
        const shape = state.shapes.find((s) => s.id === editingId)
        const arrow = state.arrows.find((a) => a.id === editingId)
        if (!shape && !arrow) return null

        const cam = cameraRef.current
        let screenX: number, screenY: number, screenW: number, screenH: number
        let currentText: string
        let fontSize = 14

        if (shape) {
          screenX = shape.x * cam.zoom + cam.x
          screenY = shape.y * cam.zoom + cam.y
          screenW = shape.width * cam.zoom
          screenH = shape.height * cam.zoom
          currentText = shape.type === 'text' ? (shape as TextShape).text : shape.label
          if (shape.type === 'text') fontSize = (shape as TextShape).fontSize
        } else {
          const start = resolveBinding(arrow!.startBinding, arrow!.startPoint, state.shapes)
          const end = resolveBinding(arrow!.endBinding, arrow!.endPoint, state.shapes)
          const midX = (start.x + end.x) / 2
          const midY = (start.y + end.y) / 2
          screenX = midX * cam.zoom + cam.x - 60
          screenY = midY * cam.zoom + cam.y - 15
          screenW = 120
          screenH = 30
          currentText = arrow!.label
          fontSize = 11
        }

        return (
          <textarea
            autoFocus
            defaultValue={currentText}
            style={{
              position: 'absolute',
              left: screenX,
              top: screenY,
              width: screenW,
              height: screenH,
              fontSize: `${fontSize * cam.zoom}px`,
              fontFamily: 'ui-monospace, monospace',
              color: '#e4e4e7',
              background: 'rgba(9, 9, 11, 0.95)',
              border: '1px solid #3b82f6',
              borderRadius: 4,
              padding: '4px 8px',
              resize: 'none',
              outline: 'none',
              textAlign: 'center',
              zIndex: 10,
              lineHeight: 1.4
            }}
            onBlur={(e) => {
              const val = e.target.value
              if (shape) {
                const fieldKey = shape.type === 'text' ? 'text' : 'label'
                updateShape(shape.id, { [fieldKey]: val } as Partial<Shape>)
              } else if (arrow) {
                updateArrow(arrow.id, { label: val })
              }
              setEditingId(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                ;(e.target as HTMLTextAreaElement).blur()
              }
              if (e.key === 'Escape') {
                setEditingId(null)
              }
              e.stopPropagation()
            }}
          />
        )
      })()}

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
