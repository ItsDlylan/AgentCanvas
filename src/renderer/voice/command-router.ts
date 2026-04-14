// ── Command router ────────────────────────────────────────
// Routes normalized transcripts through pattern tiers to produce VoiceActions.
// Tier 1: Regex pattern matching (<50ms)
// Tier 2: Levenshtein fuzzy matching (future)
// Tier 3: Local LLM via Ollama/LM Studio (future)

import type { VoiceAction, VoiceMode } from './types'
import { normalize } from './normalize'
import { patterns } from './patterns'

export interface MatchResult {
  action: VoiceAction
  raw: string
  normalized: string
  tier: 1 | 2 | 3
}

// Confirmation-mode patterns — only these are checked when mode === 'confirming'
const CONFIRM_PATTERNS: Array<{ pattern: RegExp; response: 'yes' | 'no' }> = [
  { pattern: /^(?:yes|approve|accept|confirm|do it|go ahead)$/, response: 'yes' },
  { pattern: /^(?:no|reject|deny|cancel|nevermind|stop)$/, response: 'no' }
]

export function matchCommand(
  transcript: string,
  mode: VoiceMode
): MatchResult | null {
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
        return {
          action: {
            type: pattern.action,
            params,
            destructive: pattern.destructive ?? false
          },
          raw,
          normalized,
          tier: 1
        }
      }
    }
  }

  // Tier 2: Levenshtein fuzzy matching (future — M3)
  // Tier 3: Local LLM (future — M9)

  return null
}
