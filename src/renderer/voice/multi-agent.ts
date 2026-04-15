// ── Multi-agent voice routing ────────────────────────────
// Routes voice commands to specific agents or broadcasts to groups.
// All agent-directed commands require confirmation (enforced by patterns).

import type { TileInfo } from './types'

/**
 * Write a message to a single terminal.
 */
export function routeToAgent(sessionId: string, text: string): void {
  window.terminal.write(sessionId, text + '\n')
}

/**
 * Write a message to multiple terminals.
 * Returns the count of terminals written to.
 */
export function broadcastToAgents(sessionIds: string[], text: string): number {
  for (const id of sessionIds) {
    window.terminal.write(id, text + '\n')
  }
  return sessionIds.length
}

/**
 * Build a human-readable warning for broadcast confirmation.
 * e.g. "This will send to 3 terminals across 2 workspaces"
 */
export function buildBroadcastWarning(tiles: TileInfo[]): string {
  const workspaces = new Set(tiles.map((t) => t.workspaceId))
  const count = tiles.length
  const wsCount = workspaces.size

  const labels = tiles.map((t) => t.label || t.sessionId.slice(0, 8)).join(', ')

  if (wsCount <= 1) {
    return `Send to ${count} terminal${count !== 1 ? 's' : ''}: ${labels}`
  }
  return `Send to ${count} terminals across ${wsCount} workspaces: ${labels}`
}
