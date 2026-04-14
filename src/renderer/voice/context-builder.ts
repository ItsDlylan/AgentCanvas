// ── Context builder ──────────────────────────────────────
// Builds VoiceContext from the Zustand store and resolves
// ambiguous voice references ("this", "the browser", etc.)

import type { Node } from '@xyflow/react'
import type { VoiceContext, TileInfo, WorkspaceInfo } from './types'
import { useCanvasStore } from '@/store/canvas-store'
import { fuzzyMatch, fuzzyMatchAll } from './levenshtein'

// ── Types ────────────────────────────────────────────────

export interface ResolveResult {
  resolved: boolean
  tiles?: TileInfo[]
  reason?: 'nothing-focused' | 'no-match' | 'ambiguous'
  candidates?: TileInfo[]
}

// ── Context snapshot ─────────────────────────────────────

function nodeToTileInfo(n: Node, workspaceId: string): TileInfo {
  const data = n.data as Record<string, unknown>
  return {
    sessionId: data.sessionId as string,
    type: n.type ?? 'unknown',
    label: (data.label as string) ?? '',
    status: data.status as string | undefined,
    workspaceId,
    position: n.position,
    metadata: data.metadata as Record<string, unknown> | undefined
  }
}

export function buildContext(): VoiceContext {
  const store = useCanvasStore.getState()
  const { allNodes, focusedId, workspaces, activeWorkspaceId, tileWorkspaceMap } = store

  const visibleNodes = store.getVisibleNodes()
  const focused = focusedId
    ? allNodes.find((n) => (n.data as Record<string, unknown>).sessionId === focusedId)
    : null

  return {
    focusedTileId: focusedId,
    focusedTileType: focused?.type ?? null,
    focusedTileLabel: focused ? ((focused.data as Record<string, unknown>).label as string) ?? null : null,
    visibleTiles: visibleNodes.map((n) =>
      nodeToTileInfo(n, tileWorkspaceMap.get((n.data as Record<string, unknown>).sessionId as string) ?? activeWorkspaceId)
    ),
    allTiles: allNodes.map((n) =>
      nodeToTileInfo(n, tileWorkspaceMap.get((n.data as Record<string, unknown>).sessionId as string) ?? activeWorkspaceId)
    ),
    workspaces: workspaces.map((w): WorkspaceInfo => ({ id: w.id, name: w.name })),
    activeWorkspace: activeWorkspaceId,
    unreadCount: 0
  }
}

// ── Target resolution ────────────────────────────────────

const SELF_REFS = new Set(['this', 'focused', 'current', 'selected'])
const TYPE_MAP: Record<string, string> = {
  terminal: 'terminal',
  browser: 'browser',
  note: 'notes',
  notes: 'notes',
  draw: 'draw',
  drawing: 'draw',
  devtools: 'devTools',
  'dev tools': 'devTools',
  diff: 'diffViewer'
}
const STATUS_KEYWORDS = new Set(['waiting', 'idle', 'running', 'error', 'done'])

export function resolveTarget(ref: string, context: VoiceContext): ResolveResult {
  const normalized = ref.toLowerCase().trim()

  // 1. Self-reference: "this", "focused", "current"
  if (SELF_REFS.has(normalized)) {
    if (!context.focusedTileId) return { resolved: false, reason: 'nothing-focused' }
    const tile = context.visibleTiles.find((t) => t.sessionId === context.focusedTileId)
      ?? context.allTiles.find((t) => t.sessionId === context.focusedTileId)
    if (!tile) return { resolved: false, reason: 'no-match' }
    return { resolved: true, tiles: [tile] }
  }

  // 2. Type reference: "the browser", "the terminal"
  //    Strip leading "the " for matching
  const stripped = normalized.replace(/^the\s+/, '')

  // Check for type + status: "the waiting terminal"
  const statusTypeMatch = stripped.match(/^(\w+)\s+(\w+)$/)
  if (statusTypeMatch) {
    const [, word1, word2] = statusTypeMatch
    // Could be "waiting terminal" or "terminal waiting"
    const status = STATUS_KEYWORDS.has(word1) ? word1 : STATUS_KEYWORDS.has(word2) ? word2 : null
    const typeName = status === word1 ? word2 : word1
    const nodeType = TYPE_MAP[typeName]

    if (status && nodeType) {
      const matches = context.visibleTiles.filter(
        (t) => t.type === nodeType && t.status === status
      )
      if (matches.length === 1) return { resolved: true, tiles: matches }
      if (matches.length > 1) return { resolved: false, reason: 'ambiguous', candidates: matches }
    }
  }

  // Check for "the waiting one" / "the idle one"
  const statusOnlyMatch = stripped.match(/^(\w+)\s+one$/)
  if (statusOnlyMatch && STATUS_KEYWORDS.has(statusOnlyMatch[1])) {
    const matches = context.visibleTiles.filter((t) => t.status === statusOnlyMatch[1])
    if (matches.length === 1) return { resolved: true, tiles: matches }
    if (matches.length > 1) return { resolved: false, reason: 'ambiguous', candidates: matches }
    return { resolved: false, reason: 'no-match' }
  }

  // Pure type reference: "the browser"
  const nodeType = TYPE_MAP[stripped]
  if (nodeType) {
    const matches = context.visibleTiles.filter((t) => t.type === nodeType)
    if (matches.length === 1) return { resolved: true, tiles: matches }
    if (matches.length > 1) return { resolved: false, reason: 'ambiguous', candidates: matches }
    return { resolved: false, reason: 'no-match' }
  }

  // 3. Label matching — exact substring first, then fuzzy
  const exactMatches = context.visibleTiles.filter((t) =>
    t.label.toLowerCase().includes(normalized)
  )
  if (exactMatches.length === 1) return { resolved: true, tiles: exactMatches }
  if (exactMatches.length > 1) return { resolved: false, reason: 'ambiguous', candidates: exactMatches }

  // Fuzzy label match
  const fuzzyResults = fuzzyMatchAll(
    normalized,
    context.visibleTiles,
    (t) => t.label,
    0.3
  )
  if (fuzzyResults.length === 1) return { resolved: true, tiles: [fuzzyResults[0].item] }
  if (fuzzyResults.length > 1) {
    // If the best match is significantly better than second, use it
    if (fuzzyResults[0].score < fuzzyResults[1].score * 0.6) {
      return { resolved: true, tiles: [fuzzyResults[0].item] }
    }
    return { resolved: false, reason: 'ambiguous', candidates: fuzzyResults.map((r) => r.item) }
  }

  // 4. Search all tiles (cross-workspace) as fallback
  const allFuzzy = fuzzyMatch(normalized, context.allTiles, (t) => t.label, 0.3)
  if (allFuzzy) return { resolved: true, tiles: [allFuzzy.item] }

  return { resolved: false, reason: 'no-match' }
}
