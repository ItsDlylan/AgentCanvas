import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'

export interface PersistedEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
  animated?: boolean
  style?: Record<string, unknown>
}

interface EdgeStoreData {
  version: 1
  edges: PersistedEdge[]
}

const DEFAULT_DATA: EdgeStoreData = {
  version: 1,
  edges: []
}

function getStorePath(): string {
  const dir = join(app.getPath('userData'), 'agentcanvas')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'edges.json')
}

export function loadEdges(): EdgeStoreData {
  const filePath = getStorePath()
  try {
    const raw = readFileSync(filePath, 'utf-8')
    return JSON.parse(raw) as EdgeStoreData
  } catch {
    return DEFAULT_DATA
  }
}

export function saveEdges(data: EdgeStoreData): void {
  const filePath = getStorePath()
  writeFileSync(filePath, JSON.stringify(data, null, 2))
}
