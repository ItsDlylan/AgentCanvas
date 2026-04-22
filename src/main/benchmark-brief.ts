import type { BenchmarkRuntimeState, ResultsRow } from './benchmark-store'

/**
 * The distillation pass. Runs after each iteration and writes a single brief.md
 * that the *next* iteration's agent sees in place of raw history. Bounds context
 * growth (iter 100 costs the same as iter 10) and mitigates self-conditioning-
 * on-errors degradation.
 *
 * v1: deterministic summarization of the last N accepted + N rejected rows.
 * v2 stub: a Haiku call can drop into `summarizeWithLlm` to produce richer
 *          rationale strings; the core plumbing already passes structured data.
 */

export interface IterationRationale {
  iter: number
  rationale: string
  rejectionReason: string
}

export interface DistillInput {
  state: BenchmarkRuntimeState
  rows: ResultsRow[]
  /** User-supplied hint that will be forwarded to the next iteration (cleared after read). */
  userHint?: string
  /** How many accepted/rejected rows to surface. Plan: N=10. */
  n?: number
  /**
   * When multi-agent mode is on, pass cross-lineage rows here to build a shared
   * leaderboard section. Keep undefined for single-lineage runs.
   */
  crossLineageAccepted?: Array<{ lineage: string; iter: number; score: number; rationale: string }>
  /**
   * Acceptance contract surfaced at the TOP of the brief so the agent knows
   * what it's optimizing toward on every iteration.
   */
  goal?: {
    acceptanceCriteria: string
    baselineScore: number
    target: number | null
    higherIsBetter: boolean
    improvementPct?: number
  }
}

export function distillBrief(input: DistillInput): string {
  const n = input.n ?? 10
  const { rows, state, userHint, crossLineageAccepted } = input

  const accepted = rows.filter((r) => r.accepted).slice(-n).reverse()
  const rejected = rows.filter((r) => !r.accepted).slice(-n).reverse()

  const lines: string[] = []
  lines.push(`# Benchmark Brief v${state.iterationN}`)
  lines.push('')

  if (input.goal) {
    const g = input.goal
    lines.push('## Goal')
    lines.push(sanitizeForBrief(g.acceptanceCriteria) || '(no acceptance criterion recorded)')
    lines.push('')
    lines.push(`- baseline: ${g.baselineScore}`)
    lines.push(
      `- target: ${g.target ?? 'n/a'}${
        g.improvementPct !== undefined
          ? ` (baseline ${g.higherIsBetter ? '+' : '−'}${g.improvementPct}%)`
          : ''
      }`
    )
    lines.push(`- direction: ${g.higherIsBetter ? 'higher is better' : 'lower is better'}`)
    lines.push('')
  }

  lines.push('## Current state')
  lines.push(`- best_score: ${state.bestScore === null ? 'n/a' : formatScore(state.bestScore)}`)
  lines.push(`- stagnation_counter: ${state.stagnationCounter}`)
  lines.push(`- kept: ${state.keptCount}  /  reverted: ${state.revertedCount}`)
  if (state.frozen) {
    lines.push(`- FROZEN: ${state.frozenReason ?? 'reason unavailable'} — awaiting human sign-off`)
  }
  if (state.heldOutDivergence) {
    lines.push(`- held-out REGRESSED while primary improved — investigate for reward hacking`)
  }
  lines.push('')

  if (userHint && userHint.trim().length > 0) {
    lines.push('## user_hint')
    lines.push(sanitizeForBrief(userHint).trim())
    lines.push('')
  }

  lines.push(`## Accepted diffs (last ${Math.min(n, accepted.length)})`)
  if (accepted.length === 0) {
    lines.push('_none yet_')
  } else {
    for (const r of accepted) {
      const delta = r.delta === null ? 'Δ=?' : `Δ=${formatDelta(r.delta)}`
      const sha = r.commitSha ? r.commitSha.slice(0, 8) : '—'
      lines.push(`- iter ${r.iter} · ${delta} · ${sha} · ${oneLine(sanitizeForBrief(r.rationale)) || '(no rationale)'}`)
    }
  }
  lines.push('')

  lines.push(`## Rejected attempts (last ${Math.min(n, rejected.length)})`)
  if (rejected.length === 0) {
    lines.push('_none yet_')
  } else {
    for (const r of rejected) {
      const delta = r.delta === null ? 'Δ=?' : `Δ=${formatDelta(r.delta)}`
      const why = oneLine(sanitizeForBrief(r.rejectionReason)) || '(no reason)'
      lines.push(`- iter ${r.iter} · ${delta} · ${why}`)
    }
  }
  lines.push('')

  if (crossLineageAccepted && crossLineageAccepted.length > 0) {
    lines.push('## Cross-lineage top accepted (shared leaderboard)')
    for (const r of crossLineageAccepted.slice(0, n)) {
      lines.push(
        `- [${sanitizeForBrief(r.lineage)}] iter ${r.iter} · score=${formatScore(r.score)} · ${oneLine(
          sanitizeForBrief(r.rationale)
        )}`
      )
    }
    lines.push('')
  }

  return lines.join('\n')
}

// ── Log sanitization against indirect prompt injection ──────
//
// Threat: the distilled brief, evaluator stdout/stderr, and anything the agent
// reads back from the loop are all strings under the influence of prior agent
// output. An earlier iteration's diff (malicious, buggy, or accidentally
// quoting untrusted data) can embed instruction-like content that hijacks the
// next iteration's agent. This function strips:
//
//   - markdown-style directive headers (### SYSTEM:, #### INSTRUCTION:, etc.)
//   - shell-prompt mimicry ($ sudo ... , > /etc/passwd, `root#` prompts)
//   - tool-call-shaped tokens (<tool_use>, <function_calls>, <|im_start|>)
//   - fenced role blocks (```system, ```user)
//   - HTML/XML role tags and system-reminder tags
//   - excessive length (truncated past MAX_FIELD_CHARS to keep briefs bounded)
//
// NOTE: We do NOT strip regular markdown — the brief itself is markdown. We
// only neutralize patterns whose only plausible use inside a result rationale
// is hijacking the next iteration.

const MAX_FIELD_CHARS = 600

export function sanitizeForBrief(input: string | undefined | null): string {
  if (!input) return ''
  let s = String(input)

  // 1. Strip role/tool-use XML-ish tags (case-insensitive, any attributes).
  //    Covers: <tool_use ...>, <function_calls>, <system-reminder>, <|im_start|>, </|im_end|>
  s = s.replace(/<\|?[a-z_][a-z0-9_-]*\|?>/gi, '[tag-stripped]')
  s = s.replace(/<\/\|?[a-z_][a-z0-9_-]*\|?>/gi, '[tag-stripped]')

  // 2. Fenced role blocks: ```system ... ``` → remove the role token.
  s = s.replace(/```\s*(system|user|assistant|instruction|tool)[^\n]*/gi, '```')

  // 3. Markdown directive headers that impersonate a role.
  s = s.replace(
    /^#{1,6}\s*(SYSTEM|USER|ASSISTANT|INSTRUCTION|TOOL|IGNORE PREVIOUS|OVERRIDE)[:\s].*$/gim,
    '[directive-stripped]'
  )

  // 4. "Ignore previous instructions"-style phrases.
  s = s.replace(
    /\b(ignore|disregard)\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|rules?)/gi,
    '[injection-stripped]'
  )

  // 5. Shell-prompt mimicry at line start (common in logs). Neutralize the
  //    prompt but keep the command text so reviewers can still read the log.
  s = s.replace(/^\s*(sudo|rm\s+-rf|curl\s+[^|\n]*\|\s*(sh|bash))/gim, '[shell-call-stripped]')

  // 6. Bound length.
  if (s.length > MAX_FIELD_CHARS) s = s.slice(0, MAX_FIELD_CHARS) + '…'

  return s
}

/**
 * Truncate evaluator stdout/stderr before summarization. Evaluator output is
 * agent-influenced (test harness can print whatever), so it must be sanitized
 * and length-bounded.
 */
export function sanitizeEvaluatorOutput(raw: string, maxLines = 40, maxCharsPerLine = 200): string {
  const lines = raw.split('\n').slice(-maxLines)
  return lines
    .map((l) => sanitizeForBrief(l.length > maxCharsPerLine ? l.slice(0, maxCharsPerLine) + '…' : l))
    .join('\n')
}

// ── Small helpers ────────────────────────────────────────────

function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

function formatScore(n: number): string {
  if (Math.abs(n) >= 1000) return n.toFixed(0)
  if (Math.abs(n) >= 1) return n.toFixed(3)
  return n.toFixed(4)
}

function formatDelta(n: number): string {
  const sign = n > 0 ? '+' : ''
  return sign + formatScore(n)
}
