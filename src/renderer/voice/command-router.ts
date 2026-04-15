// ── Command router ────────────────────────────────────────
// Routes normalized transcripts through pattern tiers to produce VoiceActions.
// Tier 1: Regex pattern matching (<50ms)
// Tier 2: Levenshtein fuzzy matching (<5ms)
// Tier 3: Local LLM via Ollama/LM Studio (1-5s)

import type { VoiceAction, VoiceMode, VoiceContext } from './types'
import { normalize } from './normalize'
import { patterns } from './patterns'
import { resolveTarget, type ResolveResult } from './context-builder'
import { resolveAgent } from './agent-resolver'
import { fuzzyMatch } from './levenshtein'
import { routeViaLLM, type LLMActionPlan } from './llm-router'

export interface MatchResult {
  action: VoiceAction
  raw: string
  normalized: string
  tier: 1 | 2 | 3
  /** Multi-step plan from Tier 3 LLM */
  plan?: LLMActionPlan
}

// Confirmation-mode patterns — only these are checked when mode === 'confirming'
const CONFIRM_PATTERNS: Array<{ pattern: RegExp; response: 'yes' | 'no' }> = [
  { pattern: /^(?:yes|approve|accept|confirm|do it|go ahead)$/, response: 'yes' },
  { pattern: /^(?:no|reject|deny|cancel|nevermind|stop)$/, response: 'no' }
]

// Canonical command strings for Tier 2 fuzzy matching
// Built from the first pattern of each entry (with regex anchors/groups stripped)
const COMMAND_CORPUS = buildCommandCorpus()

function buildCommandCorpus(): Array<{ text: string; patternIndex: number }> {
  return patterns.map((p, i) => {
    // Convert the first regex to a plain string by stripping regex syntax
    const raw = p.patterns[0].source
      .replace(/^\^/, '')
      .replace(/\$$/, '')
      .replace(/\(\?:([^)]+)\)/g, (_m, group) => group.split('|')[0])
      .replace(/\(\.?\+\)/g, '...')
      .replace(/\\/g, '')
    return { text: raw, patternIndex: i }
  })
}

export async function matchCommand(
  transcript: string,
  mode: VoiceMode,
  context?: VoiceContext
): Promise<MatchResult | null> {
  const raw = transcript
  const normalized = normalize(transcript)

  if (!normalized) return null

  // In CONFIRMING mode, only match yes/no
  if (mode === 'confirming') {
    for (const { pattern, response } of CONFIRM_PATTERNS) {
      if (pattern.test(normalized)) {
        return {
          action: {
            type: `confirm.${response}`,
            params: {},
            destructive: false
          },
          raw,
          normalized,
          tier: 1
        }
      }
    }
    return null
  }

  // In DICTATING mode, don't match commands
  if (mode === 'dictating') {
    return null
  }

  // Tier 1: Regex pattern matching
  for (const pattern of patterns) {
    for (const regex of pattern.patterns) {
      const match = normalized.match(regex)
      if (match) {
        const params = pattern.extract ? pattern.extract(match) : {}
        const action: VoiceAction = {
          type: pattern.action,
          params,
          destructive: pattern.destructive ?? false
        }

        // Resolve context references in params if context is available
        if (context) {
          resolveActionParams(action, context)
        }

        return { action, raw, normalized, tier: 1 }
      }
    }
  }

  // Tier 2: Levenshtein fuzzy matching against command corpus
  const fuzzyResult = fuzzyMatch(
    normalized,
    COMMAND_CORPUS,
    (c) => c.text,
    0.3
  )

  if (fuzzyResult) {
    const pattern = patterns[fuzzyResult.item.patternIndex]
    const action: VoiceAction = {
      type: pattern.action,
      params: {},
      destructive: pattern.destructive ?? false
    }

    if (context) {
      resolveActionParams(action, context)
    }

    return { action, raw, normalized, tier: 2 }
  }

  // Tier 3: Local LLM via Ollama/LM Studio
  if (context) {
    try {
      const plan = await routeViaLLM(raw, context)
      if (plan && plan.steps.length > 0) {
        return {
          action: plan.steps[0],
          raw,
          normalized,
          tier: 3,
          plan
        }
      }
    } catch {
      // LLM unavailable or errored — fall through to null
    }
  }

  return null
}

// ── Context resolution ───────────────────────────────────
// Enriches action params with resolved tile IDs from context.

function resolveActionParams(action: VoiceAction, context: VoiceContext): void {
  const { type, params } = action

  // Resolve label-based targets to sessionIds
  if (params.label && typeof params.label === 'string') {
    const result = resolveTarget(params.label, context)
    applyResolution(action, result)
  }

  // Resolve agent targets for "tell X to Y"
  if (type === 'agent.tellTo' && params.target && typeof params.target === 'string') {
    const result = resolveAgent(params.target, context)
    applyResolution(action, result)
  }

  // Resolve "send X to Y" — resolve the "to Y" target
  if (type === 'agent.sendTo' && params.target && typeof params.target === 'string') {
    const result = resolveTarget(params.target, context)
    applyResolution(action, result)
  }

  // Resolve "tell all X to Y" — resolve to multiple agents
  if (type === 'agent.broadcastTo' && params.target && typeof params.target === 'string') {
    const result = resolveAgent(params.target, context)
    // For broadcast, we want ALL matches, not just the first
    if (result.resolved && result.tiles?.length) {
      action.targets = result.tiles.map((t) => t.sessionId)
      action.params.resolvedLabel = result.tiles.map((t) => t.label).join(', ')
    } else if (result.reason === 'ambiguous' && result.candidates) {
      // For broadcast, ambiguous IS the intent — use all candidates
      action.targets = result.candidates.map((t) => t.sessionId)
      action.params.resolvedLabel = result.candidates.map((t) => t.label).join(', ')
    }
  }

  // "close this" / "close focused" — resolve focused tile
  if ((type === 'tile.closeFocused' || type === 'tile.rename') && !params.sessionId) {
    if (context.focusedTileId) {
      params.sessionId = context.focusedTileId
    }
  }
}

function applyResolution(action: VoiceAction, result: ResolveResult): void {
  if (result.resolved && result.tiles?.length) {
    action.params.sessionId = result.tiles[0].sessionId
    action.params.resolvedLabel = result.tiles[0].label
    action.targets = result.tiles.map((t) => t.sessionId)
  } else if (result.reason === 'ambiguous' && result.candidates) {
    action.params.ambiguous = true
    action.params.candidates = result.candidates.map((t) => ({
      sessionId: t.sessionId,
      label: t.label,
      type: t.type
    }))
  }
}
