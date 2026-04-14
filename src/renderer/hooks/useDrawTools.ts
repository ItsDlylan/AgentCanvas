/**
 * Tool state machine for the Draw tile.
 * Manages active tool, pointer event handlers, and ghost previews.
 */
import { useCallback, useRef, useState } from 'react'
import { v4 as uuid } from 'uuid'
import type { DrawTool, Shape, Arrow, FreehandStroke, ArrowBinding, Camera } from '@/lib/draw-types'
import { DEFAULT_SHAPE_STYLE, DEFAULT_ARROW_STYLE, findNearestBinding } from '@/lib/draw-types'
import type Konva from 'konva'

interface UseDrawToolsOptions {
  addShape: (shape: Shape) => void
  addArrow: (arrow: Arrow) => void
  addFreehand: (stroke: FreehandStroke) => void
  updateShape: (id: string, updates: Partial<Shape>) => void
  setSelectedIds: (ids: Set<string>) => void
  shapes: Shape[]
  camera: Camera
  gridSnap: boolean
}

interface GhostShape {
  x: number
  y: number
  width: number
  height: number
}

const GRID_SIZE = 20

function snapToGrid(value: number): number {
  return Math.round(value / GRID_SIZE) * GRID_SIZE
}

function screenToCanvas(screenX: number, screenY: number, camera: Camera): { x: number; y: number } {
  return {
    x: (screenX - camera.x) / camera.zoom,
    y: (screenY - camera.y) / camera.zoom
  }
}

export function useDrawTools({
  addShape,
  addArrow,
  addFreehand,
  setSelectedIds,
  shapes,
  camera,
  gridSnap
}: UseDrawToolsOptions) {
  const [activeTool, setActiveTool] = useState<DrawTool>('select')
  const [ghost, setGhost] = useState<GhostShape | null>(null)
  const [arrowPreview, setArrowPreview] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
  const [freehandPreview, setFreehandPreview] = useState<[number, number, number][]>([])
  const [strokeColor, setStrokeColor] = useState('#e4e4e7')
  const [fillColor, setFillColor] = useState('transparent')

  const drawStartRef = useRef<{ x: number; y: number } | null>(null)
  const freehandPointsRef = useRef<[number, number, number][]>([])
  const arrowStartRef = useRef<{ x: number; y: number; binding: ArrowBinding | null } | null>(null)

  const getCanvasPos = useCallback(
    (stage: Konva.Stage, evt: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      const pointer = stage.getPointerPosition()
      if (!pointer) return null
      return screenToCanvas(pointer.x, pointer.y, camera)
    },
    [camera]
  )

  const snap = useCallback(
    (v: number) => (gridSnap ? snapToGrid(v) : v),
    [gridSnap]
  )

  const onPointerDown = useCallback(
    (stage: Konva.Stage, evt: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      const pos = getCanvasPos(stage, evt)
      if (!pos) return

      if (activeTool === 'select') {
        // Deselect when clicking empty space (handled by stage click)
        setSelectedIds(new Set())
        return
      }

      if (activeTool === 'freehand') {
        freehandPointsRef.current = [[pos.x, pos.y, 0.5]]
        return
      }

      if (activeTool === 'arrow') {
        const binding = findNearestBinding(pos.x, pos.y, shapes)
        arrowStartRef.current = { x: pos.x, y: pos.y, binding }
        return
      }

      if (activeTool === 'eraser') return

      // Shape creation — start drag
      drawStartRef.current = { x: snap(pos.x), y: snap(pos.y) }
      setGhost({ x: snap(pos.x), y: snap(pos.y), width: 0, height: 0 })
    },
    [activeTool, getCanvasPos, setSelectedIds, shapes, snap]
  )

  const onPointerMove = useCallback(
    (stage: Konva.Stage, evt: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      const pos = getCanvasPos(stage, evt)
      if (!pos) return

      if (activeTool === 'freehand' && freehandPointsRef.current.length > 0) {
        freehandPointsRef.current.push([pos.x, pos.y, 0.5])
        setFreehandPreview([...freehandPointsRef.current])
        return
      }

      if (activeTool === 'arrow' && arrowStartRef.current) {
        setArrowPreview({
          x1: arrowStartRef.current.x,
          y1: arrowStartRef.current.y,
          x2: pos.x,
          y2: pos.y
        })
        return
      }

      if (drawStartRef.current) {
        const start = drawStartRef.current
        const x = Math.min(start.x, snap(pos.x))
        const y = Math.min(start.y, snap(pos.y))
        const w = Math.abs(snap(pos.x) - start.x)
        const h = Math.abs(snap(pos.y) - start.y)
        setGhost({ x, y, width: w, height: h })
      }
    },
    [activeTool, getCanvasPos, snap]
  )

  const onPointerUp = useCallback(
    (stage: Konva.Stage, evt: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      const pos = getCanvasPos(stage, evt)
      if (!pos) return

      // Freehand stroke complete
      if (activeTool === 'freehand' && freehandPointsRef.current.length > 2) {
        addFreehand({
          id: uuid(),
          type: 'freehand',
          points: [...freehandPointsRef.current],
          stroke: strokeColor,
          strokeWidth: 2,
          opacity: 1
        })
        freehandPointsRef.current = []
        setFreehandPreview([])
        return
      }

      // Arrow complete
      if (activeTool === 'arrow' && arrowStartRef.current) {
        const start = arrowStartRef.current
        const endBinding = findNearestBinding(pos.x, pos.y, shapes)

        // Only create arrow if it has some length
        const dist = Math.hypot(pos.x - start.x, pos.y - start.y)
        if (dist > 10) {
          addArrow({
            id: uuid(),
            type: 'arrow',
            startBinding: start.binding,
            endBinding: endBinding,
            startPoint: { x: start.x, y: start.y },
            endPoint: { x: pos.x, y: pos.y },
            points: [],
            label: '',
            ...DEFAULT_ARROW_STYLE,
            stroke: strokeColor
          })
        }
        arrowStartRef.current = null
        setArrowPreview(null)
        return
      }

      // Shape creation complete
      if (drawStartRef.current && ghost && ghost.width > 5 && ghost.height > 5) {
        const shapeType = activeTool as Shape['type']
        const baseProps = {
          id: uuid(),
          x: ghost.x,
          y: ghost.y,
          width: ghost.width,
          height: ghost.height,
          label: '',
          ...DEFAULT_SHAPE_STYLE,
          stroke: strokeColor,
          fill: fillColor,
          index: Date.now()
        }

        let newShape: Shape
        switch (shapeType) {
          case 'rectangle':
            newShape = { ...baseProps, type: 'rectangle' }
            break
          case 'diamond':
            newShape = { ...baseProps, type: 'diamond' }
            break
          case 'ellipse':
            newShape = { ...baseProps, type: 'ellipse' }
            break
          case 'cylinder':
            newShape = { ...baseProps, type: 'cylinder' }
            break
          case 'roundedRect':
            newShape = { ...baseProps, type: 'roundedRect', borderRadius: 8 }
            break
          case 'text':
            newShape = { ...baseProps, type: 'text', text: 'Text', fontSize: 16, fontFamily: 'ui-monospace, monospace' }
            break
          case 'dbTable':
            newShape = {
              ...baseProps,
              type: 'dbTable',
              tableName: 'table',
              columns: [
                { name: 'id', type: 'int', isPK: true, isFK: false },
                { name: 'name', type: 'varchar', isPK: false, isFK: false }
              ],
              height: Math.max(ghost.height, 80)
            }
            break
          default:
            newShape = { ...baseProps, type: 'rectangle' }
        }

        addShape(newShape)
      }

      drawStartRef.current = null
      setGhost(null)
    },
    [activeTool, ghost, getCanvasPos, addShape, addArrow, addFreehand, shapes, strokeColor, fillColor]
  )

  return {
    activeTool,
    setActiveTool,
    ghost,
    arrowPreview,
    freehandPreview,
    strokeColor,
    setStrokeColor,
    fillColor,
    setFillColor,
    onPointerDown,
    onPointerMove,
    onPointerUp
  }
}
