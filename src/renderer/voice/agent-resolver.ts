// ── Agent resolver ───────────────────────────────────────
// Resolves voice references to specific agent terminals.
// Used by "tell X to Y" and multi-agent routing patterns.

import type { VoiceContext, TileInfo } from './types'
import type { ResolveResult } from './context-builder'
import { fuzzyMatch, fuzzyMatchAll } from './levenshtein'

// ── Resolution cascade ───────────────────────────────────

export function resolveAgent(ref: string, context: VoiceContext): ResolveResult {
  const normalized = ref.toLowerCase().trim()

  // Only consider terminal tiles (agents run in terminals)
  const terminals = context.visibleTiles.filter((t) => t.type === 'terminal')

  // 1. By role: metadata.team.role — "security reviewer", "test runner"
  const byRole = resolveByRole(normalized, terminals)
  if (byRole.resolved || byRole.reason === 'ambiguous') return byRole

  // 2. By team: metadata.team.teamName — "code review team"
  const byTeam = resolveByTeam(normalized, terminals)
  if (byTeam.resolved || byTeam.reason === 'ambiguous') return byTeam

  // 3. By label: fuzzy match on tile header text
  const byLabel = resolveByLabel(normalized, terminals)
  if (byLabel.resolved || byLabel.reason === 'ambiguous') return byLabel

  // 4. By state: "the idle one", "the waiting agent"
  const byState = resolveByState(normalized, terminals)
  if (byState.resolved || byState.reason === 'ambiguous') return byState

  // 5. Fall back to all tiles (not just terminals)
  const allLabel = resolveByLabel(normalized, context.visibleTiles)
  if (allLabel.resolved) return allLabel

  return { resolved: false, reason: 'no-match' }
}

// ── By role ──────────────────────────────────────────────

function resolveByRole(ref: string, terminals: TileInfo[]): ResolveResult {
  const matches = terminals.filter((t) => {
    const team = getTeamMeta(t)
    if (!team?.role) return false
    return (team.role as string).toLowerCase().includes(ref)
      || ref.includes((team.role as string).toLowerCase())
  })

  if (matches.length === 1) return { resolved: true, tiles: matches }
  if (matches.length > 1) return { resolved: false, reason: 'ambiguous', candidates: matches }

  // Fuzzy role match
  const withRoles = terminals.filter((t) => getTeamMeta(t)?.role)
  const fuzzy = fuzzyMatch(ref, withRoles, (t) => (getTeamMeta(t)!.role as string), 0.3)
  if (fuzzy) return { resolved: true, tiles: [fuzzy.item] }

  return { resolved: false, reason: 'no-match' }
}

// ── By team ──────────────────────────────────────────────

function resolveByTeam(ref: string, terminals: TileInfo[]): ResolveResult {
  // Strip trailing "team" for matching: "code review team" → "code review"
  const stripped = ref.replace(/\s+team$/, '')

  const matches = terminals.filter((t) => {
    const team = getTeamMeta(t)
    if (!team?.teamName) return false
    const name = (team.teamName as string).toLowerCase()
    return name.includes(stripped) || stripped.includes(name)
  })

  if (matches.length === 1) return { resolved: true, tiles: matches }
  if (matches.length > 1) return { resolved: false, reason: 'ambiguous', candidates: matches }

  // Fuzzy team name match
  const withTeams = terminals.filter((t) => getTeamMeta(t)?.teamName)
  const fuzzy = fuzzyMatch(stripped, withTeams, (t) => (getTeamMeta(t)!.teamName as string), 0.3)
  if (fuzzy) return { resolved: true, tiles: [fuzzy.item] }

  return { resolved: false, reason: 'no-match' }
}

// ── By label ─────────────────────────────────────────────

function resolveByLabel(ref: string, tiles: TileInfo[]): ResolveResult {
  // Exact substring match first
  const exact = tiles.filter((t) => t.label.toLowerCase().includes(ref))
  if (exact.length === 1) return { resolved: true, tiles: exact }
  if (exact.length > 1) return { resolved: false, reason: 'ambiguous', candidates: exact }

  // Fuzzy match
  const fuzzyResults = fuzzyMatchAll(ref, tiles, (t) => t.label, 0.3)
  if (fuzzyResults.length === 1) return { resolved: true, tiles: [fuzzyResults[0].item] }
  if (fuzzyResults.length > 1) {
    if (fuzzyResults[0].score < fuzzyResults[1].score * 0.6) {
      return { resolved: true, tiles: [fuzzyResults[0].item] }
    }
    return { resolved: false, reason: 'ambiguous', candidates: fuzzyResults.map((r) => r.item) }
  }

  return { resolved: false, reason: 'no-match' }
}

// ── By state ─────────────────────────────────────────────

function resolveByState(ref: string, terminals: TileInfo[]): ResolveResult {
  const stateMatch = ref.match(/(?:the\s+)?(\w+)\s+(?:one|agent|terminal)/)
  const state = stateMatch?.[1]
  if (!state) return { resolved: false, reason: 'no-match' }

  const matches = terminals.filter((t) => t.status === state)
  if (matches.length === 1) return { resolved: true, tiles: matches }
  if (matches.length > 1) return { resolved: false, reason: 'ambiguous', candidates: matches }

  return { resolved: false, reason: 'no-match' }
}

// ── Helpers ──────────────────────────────────────────────

function getTeamMeta(tile: TileInfo): Record<string, unknown> | null {
  return (tile.metadata?.team as Record<string, unknown>) ?? null
}
