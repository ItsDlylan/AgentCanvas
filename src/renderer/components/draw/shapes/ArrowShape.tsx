/**
 * Arrow rendering with binding recalculation.
 * Arrows connect shapes via normalized anchor points.
 */
import { Shape as KonvaShape, Text as KonvaText, Group } from 'react-konva'
import rough from 'roughjs'
import type { Arrow, Shape } from '@/lib/draw-types'

interface ArrowShapeProps {
  arrow: Arrow
  shapes: Shape[]
  isSelected: boolean
  onSelect: (id: string) => void
}

/** Resolve a binding to absolute coordinates */
function resolveBinding(
  binding: { shapeId: string; anchor: { x: number; y: number } } | null,
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

/** Draw an arrowhead at the end point */
function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  from: { x: number; y: number },
  to: { x: number; y: number },
  size: number,
  stroke: string
) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x)
  ctx.beginPath()
  ctx.moveTo(to.x, to.y)
  ctx.lineTo(
    to.x - size * Math.cos(angle - Math.PI / 6),
    to.y - size * Math.sin(angle - Math.PI / 6)
  )
  ctx.moveTo(to.x, to.y)
  ctx.lineTo(
    to.x - size * Math.cos(angle + Math.PI / 6),
    to.y - size * Math.sin(angle + Math.PI / 6)
  )
  ctx.strokeStyle = stroke
  ctx.lineWidth = 2
  ctx.stroke()
}

export function ArrowShapeComponent({ arrow, shapes, isSelected, onSelect }: ArrowShapeProps) {
  const start = resolveBinding(arrow.startBinding, arrow.startPoint, shapes)
  const end = resolveBinding(arrow.endBinding, arrow.endPoint, shapes)

  // Compute midpoint for label
  const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }

  return (
    <Group>
      <KonvaShape
        sceneFunc={(ctx) => {
          const rc = rough.canvas({ getContext: () => ctx._context } as unknown as HTMLCanvasElement)
          rc.line(start.x, start.y, end.x, end.y, {
            stroke: isSelected ? '#3b82f6' : arrow.stroke,
            strokeWidth: arrow.strokeWidth,
            roughness: arrow.roughness
          })

          // Arrowhead
          if (arrow.arrowHead !== 'none') {
            drawArrowHead(ctx._context, start, end, 12, isSelected ? '#3b82f6' : arrow.stroke)
          }
        }}
        hitFunc={(ctx, shape) => {
          // Thicker hit area for easier clicking
          ctx.beginPath()
          ctx.moveTo(start.x, start.y)
          ctx.lineTo(end.x, end.y)
          ctx.lineWidth = 12
          ctx.fillStrokeShape(shape)
        }}
        onClick={() => onSelect(arrow.id)}
        onTap={() => onSelect(arrow.id)}
      />

      {/* Arrow label */}
      {arrow.label && (
        <KonvaText
          x={mid.x - 40}
          y={mid.y - 10}
          width={80}
          height={20}
          text={arrow.label}
          align="center"
          verticalAlign="middle"
          fontSize={11}
          fontFamily="ui-monospace, monospace"
          fill="#a1a1aa"
          listening={false}
        />
      )}
    </Group>
  )
}
