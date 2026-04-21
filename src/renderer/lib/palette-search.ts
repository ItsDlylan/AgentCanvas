import { Fzf, type FzfResultItem } from 'fzf'
import type { PaletteTile, PaletteTaskClassification, PaletteTaskState, PaletteTaskTimeline } from './palette-corpus'

export type PalettePrefix = '>' | '?' | '#' | '@' | ':'

export interface TaskFilters {
  classification?: PaletteTaskClassification
  state?: PaletteTaskState
  timeline?: PaletteTaskTimeline
}

export interface ParsedQuery {
  prefix: PalettePrefix | null
  prefixArg?: string
  terms: string
  taskFilters?: TaskFilters
}

export interface PaletteRankContext {
  recencyList: string[]
  activeWorkspaceId: string
}

export interface PaletteMatch {
  tile: PaletteTile
  score: number
  matchPositions: Set<number>
}

const PREFIX_CHARS: ReadonlySet<string> = new Set(['>', '?', '#', '@', ':'])
const LABEL_WEIGHT = 1.0
const SECONDARY_WEIGHT = 0.6 // cwd/url
const METADATA_WEIGHT = 0.8

/**
 * Parse a palette input string. Supports primary prefix + optional prefix argument
 * (for `@`/`#`/`:` which scope by a single token).
 *
 * Examples:
 *   '>toggle minimap'      → { prefix: '>', terms: 'toggle minimap' }
 *   '@acme term build'     → { prefix: '@', prefixArg: 'acme', terms: 'term build' }
 *   ':running foo'         → { prefix: ':', prefixArg: 'running', terms: 'foo' }
 *   '@acme >build'         → { prefix: '@', prefixArg: 'acme', terms: '>build' }
 *   'plain search'         → { prefix: null, terms: 'plain search' }
 */
const TASK_CLASSIFICATIONS = new Set<PaletteTaskClassification>([
  'QUICK',
  'NEEDS_RESEARCH',
  'DEEP_FOCUS',
  'BENCHMARK'
])
const TASK_STATES = new Set<PaletteTaskState>([
  'raw',
  'researched',
  'planned',
  'executing',
  'review',
  'done'
])
const TASK_TIMELINES = new Set<PaletteTaskTimeline>([
  'urgent',
  'this-week',
  'this-month',
  'whenever'
])

function extractTaskFilters(input: string): { terms: string; taskFilters?: TaskFilters } {
  const filters: TaskFilters = {}
  const stripped = input.replace(/!(class|state|when):([A-Za-z_-]+)/g, (_full, key: string, val: string) => {
    const v = val as PaletteTaskClassification | PaletteTaskState | PaletteTaskTimeline
    if (key === 'class' && TASK_CLASSIFICATIONS.has(v as PaletteTaskClassification)) {
      filters.classification = v as PaletteTaskClassification
      return ''
    }
    if (key === 'state' && TASK_STATES.has(v as PaletteTaskState)) {
      filters.state = v as PaletteTaskState
      return ''
    }
    if (key === 'when' && TASK_TIMELINES.has(v as PaletteTaskTimeline)) {
      filters.timeline = v as PaletteTaskTimeline
      return ''
    }
    return _full
  })
  const hasAny = Object.keys(filters).length > 0
  return { terms: stripped.trim().replace(/\s+/g, ' '), taskFilters: hasAny ? filters : undefined }
}

export function parseQuery(input: string): ParsedQuery {
  const trimmed = input.trimStart()
  if (trimmed.length === 0) return { prefix: null, terms: '' }

  const first = trimmed[0]
  if (!PREFIX_CHARS.has(first)) {
    const { terms, taskFilters } = extractTaskFilters(input.trim())
    return { prefix: null, terms, taskFilters }
  }

  const prefix = first as PalettePrefix
  const rest = trimmed.slice(1)

  // `>` = commands: everything after is the terms string, no arg
  // `?` = scrollback: everything after is the query, no arg
  if (prefix === '>' || prefix === '?') {
    return { prefix, terms: rest.trim() }
  }

  // `@`, `#`, `:` parse a single argument token, remainder = terms
  const match = rest.match(/^(\S+)(.*)$/)
  if (!match) return { prefix, terms: '' }
  const prefixArg = match[1]
  const { terms, taskFilters } = extractTaskFilters(match[2].trim())
  return { prefix, prefixArg, terms, taskFilters }
}

/**
 * Narrow the corpus by prefix filters (`@workspace`, `#team|role|agent`, `:state`).
 * Returns the (possibly unchanged) corpus. Terms and ranking happen separately.
 */
export function filterCorpus(
  corpus: PaletteTile[],
  parsed: ParsedQuery
): PaletteTile[] {
  let filtered = corpus
  if (parsed.taskFilters) {
    const { classification, state, timeline } = parsed.taskFilters
    filtered = filtered.filter((t) => {
      if (t.type !== 'task') return false
      if (classification && t.taskClassification !== classification) return false
      if (state && t.taskState !== state) return false
      if (timeline && t.taskTimeline !== timeline) return false
      return true
    })
  }
  if (!parsed.prefix || !parsed.prefixArg) return filtered
  const arg = parsed.prefixArg.toLowerCase()

  if (parsed.prefix === '@') {
    return filtered.filter((t) => t.workspaceId.toLowerCase() === arg)
  }

  if (parsed.prefix === '#') {
    // Match against any metadata field (team | role | agent).
    return filtered.filter((t) => {
      const md = t.metadata
      return (
        (md.team && md.team.toLowerCase() === arg) ||
        (md.role && md.role.toLowerCase() === arg) ||
        (md.agent && md.agent.toLowerCase() === arg)
      )
    })
  }

  if (parsed.prefix === ':') {
    if (arg !== 'running' && arg !== 'waiting' && arg !== 'idle') return []
    return filtered.filter((t) => t.type === 'terminal' && t.status === arg)
  }

  return filtered
}

function bestFzfResult<U>(
  list: ReadonlyArray<U>,
  query: string,
  selector: (v: U) => string
): FzfResultItem<U>[] {
  if (query.length === 0) return []
  const fzf = new Fzf(list, { selector, limit: Math.max(50, list.length) })
  return fzf.find(query) as FzfResultItem<U>[]
}

interface ScoredEntry {
  tile: PaletteTile
  rawScore: number
  positions: Set<number>
  labelMatched: boolean
}

/**
 * Rank tiles for a parsed query. Returns matches sorted descending by score.
 *
 * Ranking formula:
 *   base = best(fzf_label*1.0, fzf_cwd|url*0.6, fzf_metadata*0.8)
 *   +0.3  if tile.workspaceId === activeWorkspaceId
 *   +0.5 * (1 - pos/50) if tile.id in recencyList at position pos
 *   +0.2  if tile.status === 'running'
 *   +Infinity if terms.toLowerCase() === tile.label.toLowerCase() (exact label)
 *
 * If terms is empty, returns the filtered corpus sorted by recency+workspace boosts.
 */
export function rank(
  corpus: PaletteTile[],
  parsed: ParsedQuery,
  context: PaletteRankContext
): PaletteMatch[] {
  const filtered = filterCorpus(corpus, parsed)
  const terms = parsed.terms

  // Empty terms → rank by context boosts alone (recency + workspace + running)
  if (terms.length === 0) {
    return filtered
      .map((tile): PaletteMatch => ({
        tile,
        score: contextBoost(tile, context),
        matchPositions: new Set<number>()
      }))
      .sort((a, b) => b.score - a.score)
  }

  // Build per-field fzf result maps keyed by tile id.
  // Using Map<string, ...> with tile.id — each tile appears once in filtered corpus.
  const labelResults = new Map<string, FzfResultItem<PaletteTile>>()
  const secondaryResults = new Map<string, FzfResultItem<PaletteTile>>()
  const metadataResults = new Map<string, FzfResultItem<PaletteTile>>()

  for (const r of bestFzfResult(filtered, terms, (t) => t.label)) {
    labelResults.set(r.item.id, r)
  }
  for (const r of bestFzfResult(filtered, terms, (t) => t.cwd ?? t.url ?? '')) {
    secondaryResults.set(r.item.id, r)
  }
  for (const r of bestFzfResult(filtered, terms, (t) => metadataString(t))) {
    metadataResults.set(r.item.id, r)
  }

  const matches: PaletteMatch[] = []
  const termsLower = terms.toLowerCase()

  for (const tile of filtered) {
    const labelR = labelResults.get(tile.id)
    const secondaryR = secondaryResults.get(tile.id)
    const metadataR = metadataResults.get(tile.id)

    if (!labelR && !secondaryR && !metadataR) continue

    const candidates: ScoredEntry[] = []
    if (labelR) {
      candidates.push({
        tile,
        rawScore: labelR.score * LABEL_WEIGHT,
        positions: labelR.positions,
        labelMatched: true
      })
    }
    if (secondaryR) {
      candidates.push({
        tile,
        rawScore: secondaryR.score * SECONDARY_WEIGHT,
        positions: labelR ? labelR.positions : new Set<number>(),
        labelMatched: false
      })
    }
    if (metadataR) {
      candidates.push({
        tile,
        rawScore: metadataR.score * METADATA_WEIGHT,
        positions: labelR ? labelR.positions : new Set<number>(),
        labelMatched: false
      })
    }

    // Pick highest-raw-score field; retain label match positions when available.
    candidates.sort((a, b) => b.rawScore - a.rawScore)
    const best = candidates[0]

    let score = best.rawScore + contextBoost(tile, context)
    if (tile.label.toLowerCase() === termsLower) {
      score = Number.POSITIVE_INFINITY
    }

    matches.push({
      tile,
      score,
      matchPositions: labelR ? labelR.positions : new Set<number>()
    })
  }

  matches.sort((a, b) => b.score - a.score)
  return matches
}

function contextBoost(tile: PaletteTile, context: PaletteRankContext): number {
  let boost = 0
  if (tile.workspaceId === context.activeWorkspaceId) boost += 0.3
  const recencyIdx = context.recencyList.indexOf(tile.id)
  if (recencyIdx >= 0 && recencyIdx < 50) {
    boost += 0.5 * (1 - recencyIdx / 50)
  }
  if (tile.status === 'running') boost += 0.2
  return boost
}

function metadataString(tile: PaletteTile): string {
  const md = tile.metadata
  return [md.team, md.role, md.agent].filter(Boolean).join(' ')
}
