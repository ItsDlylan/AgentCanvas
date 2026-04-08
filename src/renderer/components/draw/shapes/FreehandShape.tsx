/**
 * Freehand stroke rendering using perfect-freehand.
 */
import { Shape as KonvaShape } from 'react-konva'
import getStroke from 'perfect-freehand'
import type { FreehandStroke } from '@/lib/draw-types'

interface FreehandShapeProps {
  stroke: FreehandStroke
  isSelected: boolean
  onSelect: (id: string) => void
}

/** Convert stroke outline points to an SVG-style path for canvas rendering */
function getSvgPathFromStroke(strokePoints: number[][]): string {
  if (strokePoints.length === 0) return ''

  const d: string[] = []
  d.push(`M ${strokePoints[0][0]} ${strokePoints[0][1]}`)

  for (let i = 1; i < strokePoints.length; i++) {
    const [x0, y0] = strokePoints[i - 1]
    const [x1, y1] = strokePoints[i]
    d.push(`Q ${x0} ${y0} ${(x0 + x1) / 2} ${(y0 + y1) / 2}`)
  }

  d.push('Z')
  return d.join(' ')
}

export function FreehandShapeComponent({ stroke, isSelected, onSelect }: FreehandShapeProps) {
  const outlinePoints = getStroke(stroke.points, {
    size: stroke.strokeWidth * 2,
    thinning: 0.5,
    smoothing: 0.5,
    streamline: 0.5,
    simulatePressure: true
  })

  const path = getSvgPathFromStroke(outlinePoints)

  return (
    <KonvaShape
      opacity={stroke.opacity}
      sceneFunc={(ctx) => {
        const p = new Path2D(path)
        ctx._context.fillStyle = isSelected ? '#3b82f6' : stroke.stroke
        ctx._context.fill(p)
      }}
      hitFunc={(ctx) => {
        const p = new Path2D(path)
        ctx._context.fillStyle = '#000'
        ctx._context.fill(p)
      }}
      onClick={() => onSelect(stroke.id)}
      onTap={() => onSelect(stroke.id)}
    />
  )
}
