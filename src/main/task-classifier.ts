import { spawn } from 'child_process'
import type { TaskClassification } from './task-store'

export interface ClassifierResult {
  classification: TaskClassification
  confidence: 'high' | 'low'
  source: 'heuristic' | 'llm' | 'default'
  rationale?: string
}

interface HeuristicRule {
  classification: TaskClassification
  keywords: string[]
  requireShort?: boolean
}

const RULES: HeuristicRule[] = [
  {
    classification: 'BENCHMARK',
    keywords: ['benchmark', 'measure', 'compare', 'perf', 'latency', 'throughput', 'profile']
  },
  {
    classification: 'DEEP_FOCUS',
    keywords: ['design', 'architecture', 'refactor', 'rewrite', 'migration', 'overhaul']
  },
  {
    classification: 'NEEDS_RESEARCH',
    keywords: [
      'investigate',
      'research',
      'understand why',
      'figure out',
      'unclear',
      'not sure'
    ]
  }
]

const NON_QUICK_SIGNAL = new Set([
  'design',
  'architecture',
  'refactor',
  'investigate',
  'benchmark',
  'measure',
  'compare',
  'performance'
])

function score(text: string, keywords: string[]): number {
  const lower = text.toLowerCase()
  let hits = 0
  for (const k of keywords) if (lower.includes(k)) hits++
  return hits
}

export function classifyHeuristic(intent: string, acceptance: string): ClassifierResult | null {
  const combined = `${intent}\n${acceptance}`.toLowerCase()
  const scored = RULES.map((r) => ({ rule: r, hits: score(combined, r.keywords) })).filter(
    (s) => s.hits > 0
  )

  if (scored.length === 0) {
    const short = intent.length < 80 && acceptance.length < 40
    const hasHeavyWord = Array.from(NON_QUICK_SIGNAL).some((w) => combined.includes(w))
    if (short && !hasHeavyWord) {
      return {
        classification: 'QUICK',
        confidence: 'high',
        source: 'heuristic',
        rationale: 'Short intent and no heavy signal words'
      }
    }
    return null
  }

  scored.sort((a, b) => b.hits - a.hits)
  const top = scored[0]
  const tied = scored.filter((s) => s.hits === top.hits)
  if (tied.length > 1) {
    return {
      classification: top.rule.classification,
      confidence: 'low',
      source: 'heuristic',
      rationale: `Ambiguous: ${tied.map((t) => t.rule.classification).join(', ')}`
    }
  }
  return {
    classification: top.rule.classification,
    confidence: 'high',
    source: 'heuristic',
    rationale: `Matched ${top.hits} keyword(s) for ${top.rule.classification}`
  }
}

const LLM_PROMPT = (intent: string, acceptance: string) =>
  `Classify this task into exactly one of: QUICK, NEEDS_RESEARCH, DEEP_FOCUS, BENCHMARK.

QUICK: can ship without deep planning (small change, obvious fix)
NEEDS_RESEARCH: must understand something before it can even be planned
DEEP_FOCUS: requires a multistage focus session (architecture, refactor, design)
BENCHMARK: has a computable performance score

Task intent: ${intent.slice(0, 800)}
Acceptance criteria: ${acceptance.slice(0, 800)}

Respond with ONLY a JSON object: {"classification": "...", "rationale": "one sentence"}`

function spawnClaude(prompt: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('claude', ['-p', '--output-format', 'text'], {
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      proc.kill('SIGTERM')
      reject(new Error('LLM classifier timed out'))
    }, timeoutMs)

    proc.stdout.on('data', (d) => (stdout += d.toString()))
    proc.stderr.on('data', (d) => (stderr += d.toString()))
    proc.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(stdout)
      else reject(new Error(`claude exited ${code}: ${stderr}`))
    })
    proc.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })

    proc.stdin.write(prompt)
    proc.stdin.end()
  })
}

function parseLlmResponse(raw: string): ClassifierResult | null {
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    const parsed = JSON.parse(match[0]) as { classification?: string; rationale?: string }
    const cls = parsed.classification as TaskClassification
    if (!['QUICK', 'NEEDS_RESEARCH', 'DEEP_FOCUS', 'BENCHMARK'].includes(cls)) return null
    return {
      classification: cls,
      confidence: 'high',
      source: 'llm',
      rationale: parsed.rationale
    }
  } catch {
    return null
  }
}

export async function classify(
  intent: string,
  acceptance = '',
  options: { llmTimeoutMs?: number; disableLlm?: boolean; spawnFn?: typeof spawnClaude } = {}
): Promise<ClassifierResult> {
  const heuristic = classifyHeuristic(intent, acceptance)
  if (heuristic && heuristic.confidence === 'high') return heuristic

  if (options.disableLlm) {
    return (
      heuristic ?? {
        classification: 'QUICK',
        confidence: 'low',
        source: 'default',
        rationale: 'No heuristic match; defaulting to QUICK'
      }
    )
  }

  try {
    const raw = await (options.spawnFn ?? spawnClaude)(
      LLM_PROMPT(intent, acceptance),
      options.llmTimeoutMs ?? 15000
    )
    const parsed = parseLlmResponse(raw)
    if (parsed) return parsed
  } catch (err) {
    console.warn('[task-classifier] LLM fallback failed:', err)
  }

  return (
    heuristic ?? {
      classification: 'QUICK',
      confidence: 'low',
      source: 'default',
      rationale: 'No heuristic match and LLM unavailable; defaulting to QUICK'
    }
  )
}
