/**
 * Auto-layout for Mermaid-parsed graphs using dagre.
 * Converts parsed nodes/edges into positioned shapes and arrows.
 */
import dagre from '@dagrejs/dagre'
import type { MermaidGraph, MermaidNode, MermaidNodeShape } from './mermaid-parser'
import type { Shape, Arrow, ShapeType, ArrowBinding } from './draw-types'
import { DEFAULT_SHAPE_STYLE, DEFAULT_ARROW_STYLE } from './draw-types'
import { v4 as uuid } from 'uuid'

const SHAPE_MAP: Record<MermaidNodeShape, ShapeType> = {
  rect: 'rectangle',
  rounded: 'roundedRect',
  diamond: 'diamond',
  cylinder: 'cylinder',
  circle: 'ellipse',
  stadium: 'roundedRect'
}

function estimateNodeSize(label: string): { width: number; height: number } {
  const charWidth = 9
  const padding = 40
  const width = Math.max(120, label.length * charWidth + padding)
  const height = 60
  return { width, height }
}

export interface LayoutResult {
  shapes: Shape[]
  arrows: Arrow[]
}

export function layoutMermaidGraph(
  graph: MermaidGraph,
  offsetX = 0,
  offsetY = 0
): LayoutResult {
  const g = new dagre.graphlib.Graph()
  g.setGraph({
    rankdir: graph.direction === 'LR' || graph.direction === 'RL' ? 'LR' : 'TB',
    nodesep: 60,
    ranksep: 80,
    marginx: 20,
    marginy: 20
  })
  g.setDefaultEdgeLabel(() => ({}))

  // Add nodes
  for (const node of graph.nodes) {
    const size = estimateNodeSize(node.label)
    g.setNode(node.id, { width: size.width, height: size.height, label: node.label })
  }

  // Add edges
  for (const edge of graph.edges) {
    g.setEdge(edge.from, edge.to, { label: edge.label })
  }

  dagre.layout(g)

  // Build shape id map for arrow bindings
  const shapeIdMap = new Map<string, string>()
  const shapes: Shape[] = []
  let index = 0

  for (const node of graph.nodes) {
    const layoutNode = g.node(node.id)
    if (!layoutNode) continue

    const shapeId = uuid()
    shapeIdMap.set(node.id, shapeId)

    const shapeType = SHAPE_MAP[node.shape] || 'rectangle'
    const baseShape = {
      id: shapeId,
      type: shapeType as ShapeType,
      x: layoutNode.x - layoutNode.width / 2 + offsetX,
      y: layoutNode.y - layoutNode.height / 2 + offsetY,
      width: layoutNode.width,
      height: layoutNode.height,
      label: node.label,
      ...DEFAULT_SHAPE_STYLE,
      index: index++
    }

    if (shapeType === 'roundedRect') {
      shapes.push({ ...baseShape, type: 'roundedRect', borderRadius: 8 } as Shape)
    } else {
      shapes.push(baseShape as Shape)
    }
  }

  // Build arrows
  const arrows: Arrow[] = []
  for (const edge of graph.edges) {
    const fromShapeId = shapeIdMap.get(edge.from)
    const toShapeId = shapeIdMap.get(edge.to)
    if (!fromShapeId || !toShapeId) continue

    const fromLayout = g.node(edge.from)
    const toLayout = g.node(edge.to)
    if (!fromLayout || !toLayout) continue

    const startBinding: ArrowBinding = { shapeId: fromShapeId, anchor: { x: 0.5, y: 1 } }
    const endBinding: ArrowBinding = { shapeId: toShapeId, anchor: { x: 0.5, y: 0 } }

    // Adjust anchors based on direction
    if (graph.direction === 'LR' || graph.direction === 'RL') {
      startBinding.anchor = { x: 1, y: 0.5 }
      endBinding.anchor = { x: 0, y: 0.5 }
    }

    arrows.push({
      id: uuid(),
      type: 'arrow',
      startBinding,
      endBinding,
      startPoint: { x: fromLayout.x + offsetX, y: fromLayout.y + offsetY },
      endPoint: { x: toLayout.x + offsetX, y: toLayout.y + offsetY },
      points: [],
      label: edge.label,
      ...DEFAULT_ARROW_STYLE
    })
  }

  return { shapes, arrows }
}
