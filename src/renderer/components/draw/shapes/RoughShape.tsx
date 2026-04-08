/**
 * Konva <Shape> wrapper that renders shapes with RoughJS for hand-drawn aesthetic.
 * Each shape type gets its own rough drawing function while sharing the Konva
 * interactivity layer (drag, select, transform, events).
 */
import { Shape as KonvaShape, Text as KonvaText, Group } from 'react-konva'
import rough from 'roughjs'
import type { Shape, ShapeType } from '@/lib/draw-types'

interface RoughShapeProps {
  shape: Shape
  isSelected: boolean
  onSelect: (id: string) => void
  onDragEnd: (id: string, x: number, y: number) => void
}

/** Stable numeric seed from shape ID so RoughJS draws identically on every frame */
function seedFromId(id: string): number {
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash) + id.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

function drawRoughShape(
  ctx: CanvasRenderingContext2D,
  type: ShapeType,
  w: number,
  h: number,
  shape: Shape
) {
  const rc = rough.canvas({ getContext: () => ctx } as unknown as HTMLCanvasElement)
  const seed = seedFromId(shape.id)
  const opts = {
    seed,
    stroke: shape.stroke,
    fill: shape.fill === 'transparent' ? undefined : shape.fill,
    fillStyle: 'hachure' as const,
    roughness: shape.roughness,
    strokeWidth: shape.strokeWidth
  }

  switch (type) {
    case 'rectangle':
      rc.rectangle(0, 0, w, h, opts)
      break
    case 'roundedRect': {
      // RoughJS doesn't have roundedRect, draw with path
      const r = Math.min(('borderRadius' in shape ? (shape as { borderRadius: number }).borderRadius : 8), w / 2, h / 2)
      rc.path(`M ${r} 0 L ${w - r} 0 Q ${w} 0 ${w} ${r} L ${w} ${h - r} Q ${w} ${h} ${w - r} ${h} L ${r} ${h} Q 0 ${h} 0 ${h - r} L 0 ${r} Q 0 0 ${r} 0 Z`, opts)
      break
    }
    case 'diamond': {
      const cx = w / 2, cy = h / 2
      rc.polygon([[cx, 0], [w, cy], [cx, h], [0, cy]], opts)
      break
    }
    case 'ellipse':
      rc.ellipse(w / 2, h / 2, w, h, opts)
      break
    case 'cylinder': {
      const ry = Math.min(h * 0.15, 20)
      // Body
      rc.line(0, ry, 0, h - ry, opts)
      rc.line(w, ry, w, h - ry, opts)
      // Top ellipse
      rc.ellipse(w / 2, ry, w, ry * 2, opts)
      // Bottom arc (half ellipse)
      rc.arc(w / 2, h - ry, w, ry * 2, 0, Math.PI, false, opts)
      break
    }
    case 'dbTable': {
      // Full table background
      rc.rectangle(0, 0, w, h, opts)
      // Header separator
      const headerH = 32
      rc.line(0, headerH, w, headerH, opts)
      break
    }
    case 'text':
      // Text shapes don't draw a rough border — just the text (handled by KonvaText)
      break
  }
}

export function RoughShapeComponent({ shape, isSelected, onSelect, onDragEnd }: RoughShapeProps) {
  const isText = shape.type === 'text'
  const isDBTable = shape.type === 'dbTable'

  return (
    <Group
      x={shape.x}
      y={shape.y}
      width={shape.width}
      height={shape.height}
      rotation={shape.rotation}
      opacity={shape.opacity}
      draggable
      onClick={() => onSelect(shape.id)}
      onTap={() => onSelect(shape.id)}
      onDragEnd={(e) => onDragEnd(shape.id, e.target.x(), e.target.y())}
    >
      {/* Rough drawn shape */}
      {!isText && (
        <KonvaShape
          width={shape.width}
          height={shape.height}
          sceneFunc={(ctx) => {
            drawRoughShape(ctx._context, shape.type, shape.width, shape.height, shape)
          }}
          hitFunc={(ctx, shapeNode) => {
            ctx.beginPath()
            ctx.rect(0, 0, shape.width, shape.height)
            ctx.closePath()
            ctx.fillStrokeShape(shapeNode)
          }}
        />
      )}

      {/* Label text */}
      {isDBTable ? (
        <DBTableText shape={shape} />
      ) : (
        <KonvaText
          text={isText && 'text' in shape ? shape.text : shape.label}
          width={shape.width}
          height={shape.height}
          align="center"
          verticalAlign="middle"
          fontSize={isText && 'fontSize' in shape ? shape.fontSize : 14}
          fontFamily={isText && 'fontFamily' in shape ? shape.fontFamily : 'ui-monospace, monospace'}
          fill="#e4e4e7"
          padding={8}
          listening={false}
        />
      )}

      {/* Selection ring */}
      {isSelected && (
        <KonvaShape
          width={shape.width}
          height={shape.height}
          sceneFunc={(ctx) => {
            ctx._context.strokeStyle = '#3b82f6'
            ctx._context.lineWidth = 2
            ctx._context.setLineDash([6, 3])
            ctx._context.strokeRect(-3, -3, shape.width + 6, shape.height + 6)
            ctx._context.setLineDash([])
          }}
          listening={false}
        />
      )}
    </Group>
  )
}

function DBTableText({ shape }: { shape: Shape }) {
  if (shape.type !== 'dbTable') return null
  const headerH = 32
  const rowH = 24

  return (
    <>
      {/* Table name header */}
      <KonvaText
        text={shape.tableName}
        width={shape.width}
        height={headerH}
        align="center"
        verticalAlign="middle"
        fontSize={14}
        fontStyle="bold"
        fontFamily="ui-monospace, monospace"
        fill="#e4e4e7"
        listening={false}
      />
      {/* Columns */}
      {shape.columns.map((col, i) => (
        <KonvaText
          key={i}
          y={headerH + i * rowH + 4}
          x={8}
          text={`${col.isPK ? 'PK ' : col.isFK ? 'FK ' : '   '}${col.name}: ${col.type}`}
          width={shape.width - 16}
          height={rowH}
          fontSize={12}
          fontFamily="ui-monospace, monospace"
          fill={col.isPK ? '#f59e0b' : col.isFK ? '#3b82f6' : '#a1a1aa'}
          listening={false}
        />
      ))}
    </>
  )
}
