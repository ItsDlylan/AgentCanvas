import { useMemo } from 'react'
import type { Node } from '@xyflow/react'
import { useCanvasStore } from '@/store/canvas-store'
import { useAllTerminalStatuses, type TerminalStatus, type TerminalStatusInfo } from '@/hooks/useTerminalStatus'

export type PaletteTileType = 'terminal' | 'browser' | 'notes' | 'draw' | 'image' | 'task'

export interface PaletteTileMetadata {
  team?: string
  role?: string
  agent?: string
}

export type PaletteTaskClassification = 'QUICK' | 'NEEDS_RESEARCH' | 'DEEP_FOCUS' | 'BENCHMARK'
export type PaletteTaskState = 'raw' | 'researched' | 'planned' | 'executing' | 'review' | 'done'
export type PaletteTaskTimeline = 'urgent' | 'this-week' | 'this-month' | 'whenever'

export interface PaletteTile {
  id: string
  type: PaletteTileType
  label: string
  cwd?: string
  url?: string
  metadata: PaletteTileMetadata
  workspaceId: string
  status?: TerminalStatus
  foregroundProcess?: string
  taskClassification?: PaletteTaskClassification
  taskState?: PaletteTaskState
  taskTimeline?: PaletteTaskTimeline
}

const INDEXED_TYPES: ReadonlySet<string> = new Set<PaletteTileType>([
  'terminal',
  'browser',
  'notes',
  'draw',
  'image',
  'task'
])

function flattenMetadata(raw: unknown): PaletteTileMetadata {
  if (!raw || typeof raw !== 'object') return {}
  const md = raw as Record<string, unknown>
  const out: PaletteTileMetadata = {}

  const pickString = (value: unknown): string | undefined => {
    if (typeof value === 'string' && value.length > 0) return value
    return undefined
  }

  // Direct top-level strings
  const topTeam = pickString(md.team)
  const topRole = pickString(md.role)
  const topAgent = pickString(md.agent)

  // Canvas-store nests metadata.team as an object (see addTerminalForTerminal)
  const teamObj = md.team && typeof md.team === 'object' ? (md.team as Record<string, unknown>) : undefined
  const nestedTeamName = teamObj ? pickString(teamObj.teamName) ?? pickString(teamObj.name) : undefined
  const nestedRole = teamObj ? pickString(teamObj.role) : undefined
  const nestedAgent = teamObj ? pickString(teamObj.agent) : undefined

  const team = topTeam ?? nestedTeamName
  const role = topRole ?? nestedRole
  const agent = topAgent ?? nestedAgent

  if (team) out.team = team
  if (role) out.role = role
  if (agent) out.agent = agent

  return out
}

function nodeData(node: Node): Record<string, unknown> {
  return (node.data as Record<string, unknown>) ?? {}
}

function tileForNode(
  node: Node,
  workspaceId: string,
  statusMap: Map<string, TerminalStatusInfo>
): PaletteTile | null {
  const type = node.type
  if (!type || !INDEXED_TYPES.has(type)) return null

  const data = nodeData(node)
  const sessionId = (data.sessionId as string) ?? node.id
  const label = (data.label as string) ?? ''

  const base: PaletteTile = {
    id: sessionId,
    type: type as PaletteTileType,
    label,
    metadata: {},
    workspaceId
  }

  if (type === 'terminal') {
    const staticMeta = flattenMetadata(data.metadata)
    const liveStatus = statusMap.get(sessionId)
    const liveMeta = liveStatus ? flattenMetadata(liveStatus.metadata) : {}
    base.metadata = { ...staticMeta, ...liveMeta }
    base.cwd = (liveStatus?.cwd as string | undefined) ?? (data.cwd as string | undefined)
    if (liveStatus) {
      base.status = liveStatus.status
      base.foregroundProcess = liveStatus.foregroundProcess || undefined
    }
    return base
  }

  if (type === 'browser') {
    const url = (data.initialUrl as string) ?? undefined
    base.url = url
    return base
  }

  if (type === 'notes' || type === 'draw' || type === 'image') {
    return base
  }

  if (type === 'task') {
    base.taskClassification = data.classification as PaletteTaskClassification | undefined
    base.taskState = data.derivedState as PaletteTaskState | undefined
    base.taskTimeline = data.timelinePressure as PaletteTaskTimeline | undefined
    return base
  }

  return null
}

export interface PaletteCorpusContext {
  activeWorkspaceId: string
}

export function buildCorpus(
  nodes: Node[],
  tileWorkspaceMap: Map<string, string>,
  activeWorkspaceId: string,
  statusMap: Map<string, TerminalStatusInfo>
): PaletteTile[] {
  const out: PaletteTile[] = []
  for (const node of nodes) {
    const sessionId = (nodeData(node).sessionId as string) ?? node.id
    const workspaceId = tileWorkspaceMap.get(sessionId) ?? activeWorkspaceId
    const tile = tileForNode(node, workspaceId, statusMap)
    if (tile) out.push(tile)
  }
  return out
}

/**
 * React hook that returns the palette corpus for the current canvas state.
 * Recomputes only when contributing stores change.
 */
export function usePaletteCorpus(): PaletteTile[] {
  const allNodes = useCanvasStore((s) => s.allNodes)
  const tileWorkspaceMap = useCanvasStore((s) => s.tileWorkspaceMap)
  const activeWorkspaceId = useCanvasStore((s) => s.activeWorkspaceId)
  const statusMap = useAllTerminalStatuses()

  return useMemo(
    () => buildCorpus(allNodes, tileWorkspaceMap, activeWorkspaceId, statusMap),
    [allNodes, tileWorkspaceMap, activeWorkspaceId, statusMap]
  )
}
