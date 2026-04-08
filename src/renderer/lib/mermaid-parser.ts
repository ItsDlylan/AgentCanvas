/**
 * Lightweight Mermaid flowchart parser.
 * Parses the `graph TD/LR` subset into nodes and edges.
 * Zero dependencies — avoids pulling in the full Mermaid package (~2MB).
 */

export type MermaidNodeShape = 'rect' | 'rounded' | 'diamond' | 'cylinder' | 'circle' | 'stadium'

export interface MermaidNode {
  id: string
  label: string
  shape: MermaidNodeShape
}

export interface MermaidEdge {
  from: string
  to: string
  label: string
}

export type MermaidDirection = 'TB' | 'TD' | 'BT' | 'LR' | 'RL'

export interface MermaidGraph {
  direction: MermaidDirection
  nodes: MermaidNode[]
  edges: MermaidEdge[]
}

/**
 * Extract node shape + label from bracket syntax:
 *  [label]    → rect
 *  (label)    → rounded
 *  {label}    → diamond
 *  [(label)]  → cylinder
 *  ((label))  → circle
 *  ([label])  → stadium
 *  >label]    → rect (flag, treat as rect)
 */
function parseNodeDef(raw: string): { label: string; shape: MermaidNodeShape } | null {
  const s = raw.trim()
  if (!s) return null

  // [(label)] — cylinder
  if (s.startsWith('[(') && s.endsWith(')]')) {
    return { label: s.slice(2, -2), shape: 'cylinder' }
  }
  // ((label)) — circle
  if (s.startsWith('((') && s.endsWith('))')) {
    return { label: s.slice(2, -2), shape: 'circle' }
  }
  // ([label]) — stadium
  if (s.startsWith('([') && s.endsWith('])')) {
    return { label: s.slice(2, -2), shape: 'stadium' }
  }
  // {label} — diamond
  if (s.startsWith('{') && s.endsWith('}')) {
    return { label: s.slice(1, -1), shape: 'diamond' }
  }
  // [label] — rect
  if (s.startsWith('[') && s.endsWith(']')) {
    return { label: s.slice(1, -1), shape: 'rect' }
  }
  // (label) — rounded
  if (s.startsWith('(') && s.endsWith(')')) {
    return { label: s.slice(1, -1), shape: 'rounded' }
  }
  // >label] — flag shape, treat as rect
  if (s.startsWith('>') && s.endsWith(']')) {
    return { label: s.slice(1, -1), shape: 'rect' }
  }

  return null
}

/** Find where the bracket expression starts for a node definition */
function findBracketStart(s: string): number {
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '[' || ch === '(' || ch === '{' || ch === '>') return i
  }
  return -1
}

/**
 * Register a node definition. If the node already exists, skip it (first definition wins).
 */
function ensureNode(nodes: Map<string, MermaidNode>, id: string, defStr?: string): void {
  if (nodes.has(id)) return

  if (defStr) {
    const parsed = parseNodeDef(defStr)
    if (parsed) {
      nodes.set(id, { id, label: parsed.label, shape: parsed.shape })
      return
    }
  }
  // No bracket definition — plain ID becomes the label, rect shape
  nodes.set(id, { id, label: id, shape: 'rect' })
}

/**
 * Split a "node reference" (e.g., `A[Label]` or just `A`) into id + optional bracket definition.
 */
function splitNodeRef(s: string): { id: string; def?: string } {
  const bracketStart = findBracketStart(s)
  if (bracketStart > 0) {
    return { id: s.slice(0, bracketStart).trim(), def: s.slice(bracketStart).trim() }
  }
  return { id: s.trim() }
}

// Arrow patterns: -->, --->, -.->  with optional label |label|
const ARROW_RE = /^(\S+(?:\[.*?\]|\(.*?\)|\{.*?\}|>\S*\])?)\s+(-->|---->|-.->|==>|--)\|?([^|]*)\|?\s+(\S+(?:\[.*?\]|\(.*?\)|\{.*?\}|>\S*\])?)$/

// More flexible: capture anything before arrow, arrow, optional label, and after arrow
const EDGE_RE = /(.+?)\s+(-->|---->|-.->|==>|--)\s*(?:\|([^|]*)\|)?\s*(.+)/

/**
 * Parse a Mermaid flowchart string into a graph structure.
 */
export function parseMermaid(source: string): MermaidGraph {
  const lines = source.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('%%'))
  const nodes = new Map<string, MermaidNode>()
  const edges: MermaidEdge[] = []
  let direction: MermaidDirection = 'TD'

  for (const line of lines) {
    // Graph declaration: graph TD, graph LR, flowchart TD, etc.
    const graphMatch = line.match(/^(?:graph|flowchart)\s+(TD|TB|BT|LR|RL)\s*$/i)
    if (graphMatch) {
      direction = graphMatch[1].toUpperCase() as MermaidDirection
      continue
    }

    // Skip subgraph/end/style/class lines
    if (/^(subgraph|end|style|classDef|class)\b/i.test(line)) continue
    // Skip graph/flowchart lines without direction (e.g. "graph")
    if (/^(graph|flowchart)\s*$/i.test(line)) continue

    // Try to parse as edge
    const edgeMatch = line.match(EDGE_RE)
    if (edgeMatch) {
      const leftRaw = edgeMatch[1].trim()
      const edgeLabel = (edgeMatch[3] || '').trim()
      const rightRaw = edgeMatch[4].trim()

      const left = splitNodeRef(leftRaw)
      const right = splitNodeRef(rightRaw)

      ensureNode(nodes, left.id, left.def)
      ensureNode(nodes, right.id, right.def)
      edges.push({ from: left.id, to: right.id, label: edgeLabel })
      continue
    }

    // Standalone node definition: A[Label]
    const ref = splitNodeRef(line)
    if (ref.id && ref.def) {
      ensureNode(nodes, ref.id, ref.def)
      continue
    }

    // Plain ID node
    if (/^[a-zA-Z_]\w*$/.test(line)) {
      ensureNode(nodes, line)
    }
  }

  return {
    direction,
    nodes: Array.from(nodes.values()),
    edges
  }
}
