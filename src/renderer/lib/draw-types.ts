/** Shape & drawing data model for the Draw tile */

export type ShapeType = 'rectangle' | 'diamond' | 'ellipse' | 'cylinder' | 'text' | 'dbTable' | 'roundedRect'

export interface BaseShape {
  id: string
  type: ShapeType
  x: number
  y: number
  width: number
  height: number
  rotation: number
  fill: string
  stroke: string
  strokeWidth: number
  opacity: number
  roughness: number
  index: number
  label: string
}

export interface RectangleShape extends BaseShape { type: 'rectangle' }
export interface DiamondShape extends BaseShape { type: 'diamond' }
export interface EllipseShape extends BaseShape { type: 'ellipse' }
export interface CylinderShape extends BaseShape { type: 'cylinder' }
export interface RoundedRectShape extends BaseShape { type: 'roundedRect'; borderRadius: number }

export interface TextShape extends BaseShape {
  type: 'text'
  text: string
  fontSize: number
  fontFamily: string
}

export interface DBTableColumn {
  name: string
  type: string
  isPK: boolean
  isFK: boolean
}

export interface DBTableShape extends BaseShape {
  type: 'dbTable'
  tableName: string
  columns: DBTableColumn[]
}

export type Shape = RectangleShape | DiamondShape | EllipseShape | CylinderShape
  | RoundedRectShape | TextShape | DBTableShape

export interface ArrowBinding {
  shapeId: string
  anchor: { x: number; y: number } // normalized 0-1
}

export interface Arrow {
  id: string
  type: 'arrow'
  startBinding: ArrowBinding | null
  endBinding: ArrowBinding | null
  startPoint: { x: number; y: number }
  endPoint: { x: number; y: number }
  points: { x: number; y: number }[]
  label: string
  stroke: string
  strokeWidth: number
  roughness: number
  arrowHead: 'arrow' | 'triangle' | 'circle' | 'none'
}

export interface FreehandStroke {
  id: string
  type: 'freehand'
  points: [number, number, number][] // [x, y, pressure]
  stroke: string
  strokeWidth: number
  opacity: number
}

export interface Camera {
  x: number
  y: number
  zoom: number
}

export interface DrawingState {
  shapes: Shape[]
  arrows: Arrow[]
  freehand: FreehandStroke[]
  camera: Camera
}

export type DrawTool =
  | 'select'
  | 'rectangle'
  | 'diamond'
  | 'ellipse'
  | 'cylinder'
  | 'roundedRect'
  | 'dbTable'
  | 'text'
  | 'arrow'
  | 'freehand'
  | 'eraser'

export const DEFAULT_SHAPE_STYLE = {
  fill: 'transparent',
  stroke: '#e4e4e7',
  strokeWidth: 2,
  opacity: 1,
  roughness: 1.5,
  rotation: 0
}

export const DEFAULT_ARROW_STYLE = {
  stroke: '#e4e4e7',
  strokeWidth: 2,
  roughness: 1.5,
  arrowHead: 'arrow' as const
}

export function createDefaultCamera(): Camera {
  return { x: 0, y: 0, zoom: 1 }
}

export function createEmptyDrawingState(): DrawingState {
  return {
    shapes: [],
    arrows: [],
    freehand: [],
    camera: createDefaultCamera()
  }
}

/** Resolve an arrow binding to absolute coordinates */
export function resolveBinding(
  binding: ArrowBinding | null,
  fallback: { x: number; y: number },
  shapes: Shape[]
): { x: number; y: number } {
  if (!binding) return fallback
  const shape = shapes.find((s) => s.id === binding.shapeId)
  if (!shape) return fallback
  return {
    x: shape.x + shape.width * binding.anchor.x,
    y: shape.y + shape.height * binding.anchor.y
  }
}

/** Find the nearest shape edge anchor point for arrow binding */
export function findNearestBinding(
  x: number,
  y: number,
  shapes: Shape[],
  threshold = 30
): ArrowBinding | null {
  let best: ArrowBinding | null = null
  let bestDist = threshold

  for (const shape of shapes) {
    const anchors = [
      { ax: 0.5, ay: 0 },   // top
      { ax: 0.5, ay: 1 },   // bottom
      { ax: 0, ay: 0.5 },   // left
      { ax: 1, ay: 0.5 }    // right
    ]

    for (const { ax, ay } of anchors) {
      const px = shape.x + shape.width * ax
      const py = shape.y + shape.height * ay
      const d = Math.hypot(x - px, y - py)
      if (d < bestDist) {
        bestDist = d
        best = { shapeId: shape.id, anchor: { x: ax, y: ay } }
      }
    }
  }

  return best
}
