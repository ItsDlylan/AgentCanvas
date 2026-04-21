import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'

export type EdgeKind =
  | 'has-plan'
  | 'executing-in'
  | 'research-output'
  | 'linked-pr'
  | 'depends-on'
  | 'legacy'

export interface PersistedEdge {
  id: string
  source: string
  target: string
  kind: EdgeKind
  sourceHandle?: string | null
  targetHandle?: string | null
  animated?: boolean
  style?: Record<string, unknown>
  data?: Record<string, unknown>
}

interface EdgeStoreDataV1 {
  version: 1
  edges: Array<Omit<PersistedEdge, 'kind'> & { kind?: EdgeKind }>
}

interface EdgeStoreDataV2 {
  version: 2
  edges: PersistedEdge[]
}

type AnyEdgeStoreData = EdgeStoreDataV1 | EdgeStoreDataV2

const DEFAULT_DATA: EdgeStoreDataV2 = {
  version: 2,
  edges: []
}

function getStorePath(): string {
  const dir = join(app.getPath('userData'), 'agentcanvas')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'edges.json')
}

function migrate(data: AnyEdgeStoreData): EdgeStoreDataV2 {
  if (data.version === 2) {
    return {
      version: 2,
      edges: data.edges.map((e) => ({ ...e, kind: e.kind ?? 'legacy' }))
    }
  }
  return {
    version: 2,
    edges: data.edges.map((e) => ({ ...e, kind: e.kind ?? 'legacy' }))
  }
}

export function loadEdges(): EdgeStoreDataV2 {
  const filePath = getStorePath()
  try {
    const raw = readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as AnyEdgeStoreData
    return migrate(parsed)
  } catch {
    return DEFAULT_DATA
  }
}

export function saveEdges(data: EdgeStoreDataV2): void {
  const filePath = getStorePath()
  writeFileSync(filePath, JSON.stringify(data, null, 2))
}
