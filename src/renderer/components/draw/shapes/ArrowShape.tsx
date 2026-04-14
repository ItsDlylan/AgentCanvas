/**
 * Arrow rendering with binding recalculation.
 * Arrows connect shapes via normalized anchor points.
 */
import { Shape as KonvaShape, Text as KonvaText, Group, Circle } from 'react-konva'
import rough from 'roughjs'
import type { Arrow, Shape } from '@/lib/draw-types'
import { resolveBinding, findNearestBinding } from '@/lib/draw-types'

interface ArrowShapeProps {
  arrow: Arrow
  shapes: Shape[]
  isSelected: boolean
  onSelect: (id: string) => void
  onDoubleClick: (id: string) => void
  updateArrow: (id: string, updates: Partial<Arrow>) => void
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

export function ArrowShapeComponent({ arrow, shapes, isSelected, onSelect, onDoubleClick, updateArrow }: ArrowShapeProps) {
  const start = resolveBinding(arrow.startBinding, arrow.startPoint, shapes)
  const end = resolveBinding(arrow.endBinding, arrow.endPoint, shapes)

  // Compute midpoint for label
  const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }

  return (
    <Group>
      <KonvaShape
        sceneFunc={(ctx) => {
          const rc = rough.canvas({ getContext: () => ctx._context } as unknown as HTMLCanvasElement)
          let seed = 0
          for (let i = 0; i < arrow.id.length; i++) {
            seed = ((seed << 5) - seed) + arrow.id.charCodeAt(i)
            seed |= 0
          }
          rc.line(start.x, start.y, end.x, end.y, {
            seed: Math.abs(seed),
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
        onDblClick={() => onDoubleClick(arrow.id)}
        onDblTap={() => onDoubleClick(arrow.id)}
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

      {/* Endpoint drag handles when selected */}
      {isSelected && (
        <>
          <Circle
            x={start.x}
            y={start.y}
            radius={6}
            fill="#3b82f6"
            stroke="#1d4ed8"
            strokeWidth={2}
            draggable
            onDragEnd={(e) => {
              const newX = e.target.x()
              const newY = e.target.y()
              const newBinding = findNearestBinding(newX, newY, shapes)
              updateArrow(arrow.id, {
                startPoint: { x: newX, y: newY },
                startBinding: newBinding
              })
            }}
          />
          <Circle
            x={end.x}
            y={end.y}
            radius={6}
            fill="#3b82f6"
            stroke="#1d4ed8"
            strokeWidth={2}
            draggable
            onDragEnd={(e) => {
              const newX = e.target.x()
              const newY = e.target.y()
              const newBinding = findNearestBinding(newX, newY, shapes)
              updateArrow(arrow.id, {
                endPoint: { x: newX, y: newY },
                endBinding: newBinding
              })
            }}
          />
        </>
      )}
    </Group>
  )
}
