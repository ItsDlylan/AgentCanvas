import { spawn } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

export type BenchmarkTemplateKind =
  | 'web-page-load'
  | 'api-latency'
  | 'bundle-size'
  | 'test-suite-time'
  | 'pure-function'

const BENCHMARK_TEMPLATE_KINDS: BenchmarkTemplateKind[] = [
  'web-page-load',
  'api-latency',
  'bundle-size',
  'test-suite-time',
  'pure-function'
]

export type TaskClassification = 'QUICK' | 'NEEDS_RESEARCH' | 'DEEP_FOCUS' | 'BENCHMARK'
export type TaskTimeline = 'urgent' | 'this-week' | 'this-month' | 'whenever'

export interface BenchmarkProposal {
  kind: 'benchmark'
  label: string
  intent: string
  acceptanceCriteria: string
  templateKind: BenchmarkTemplateKind
  targetFiles?: string[]
  targetUrl?: string
  noiseClass: 'low' | 'medium' | 'high'
  higherIsBetter: boolean
  rationale: string
}

export interface GenericTaskProposal {
  kind: 'generic'
  label: string
  intent: string
  acceptanceCriteria: string
  classification: TaskClassification
  timelinePressure: TaskTimeline
  rationale: string
}

export type TaskProposal = BenchmarkProposal | GenericTaskProposal

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface SuggestInput {
  classification: TaskClassification
  messages: ChatMessage[]
  repoPath?: string
  draftFromTaskId?: string
  existingLabel?: string
  existingIntent?: string
  existingAcceptance?: string
}

export interface SuggestResult {
  ok: boolean
  reply?: { kind: 'message'; content: string } | { kind: 'proposal'; proposal: TaskProposal }
  error?: string
  rawOutput?: string
}

const SUGGEST_TIMEOUT_MS = 90_000
const PROPOSAL_MARKER = '<<<PROPOSAL>>>'

function loadBenchmarkTemplate(kind: BenchmarkTemplateKind): string | null {
  const candidates = [
    join(app.getAppPath(), 'resources', 'benchmark', 'templates', `${kind}.md`),
    join(process.cwd(), 'resources', 'benchmark', 'templates', `${kind}.md`)
  ]
  for (const path of candidates) {
    if (existsSync(path)) {
      try {
        return readFileSync(path, 'utf-8')
      } catch {
        // fall through
      }
    }
  }
  return null
}

function buildBenchmarkCatalog(): string {
  return BENCHMARK_TEMPLATE_KINDS
    .map((kind) => {
      const body = loadBenchmarkTemplate(kind)
      return `### ${kind}\n${(body || '(template missing)').trim()}`
    })
    .join('\n\n---\n\n')
}

function buildSystemPrompt(input: SuggestInput): string {
  const isBench = input.classification === 'BENCHMARK'
  const repoLine = input.repoPath
    ? `You are running with \`${input.repoPath}\` as your working directory. Use Read/Grep/Bash to investigate the repo when helpful.`
    : `You are running without a specific repo. Ask the user for one if you need to investigate files.`

  const existing = [
    input.existingLabel && `Existing label: ${input.existingLabel}`,
    input.existingIntent && `Existing intent:\n${input.existingIntent}`,
    input.existingAcceptance && `Existing acceptance criteria:\n${input.existingAcceptance}`
  ]
    .filter(Boolean)
    .join('\n\n')

  const schemaBench = [
    '```ts',
    'interface BenchmarkProposal {',
    `  kind: "benchmark"`,
    '  label: string                 // under 60 chars',
    '  intent: string                // 1–3 paragraphs markdown',
    '  acceptanceCriteria: string    // markdown checklist, MUST contain a numeric target',
    `  templateKind: "web-page-load" | "api-latency" | "bundle-size" | "test-suite-time" | "pure-function"`,
    '  targetFiles?: string[]        // omit for web-page-load. Max 3, verified to exist.',
    '  targetUrl?: string            // only for web-page-load',
    `  noiseClass: "low" | "medium" | "high"`,
    '  higherIsBetter: boolean       // false for latency/size/time',
    '  rationale: string             // 1–2 sentences',
    '}',
    '```'
  ].join('\n')

  const schemaGeneric = [
    '```ts',
    'interface GenericTaskProposal {',
    `  kind: "generic"`,
    '  label: string                          // under 60 chars',
    '  intent: string                         // 1–3 paragraphs markdown explaining what + why',
    '  acceptanceCriteria: string             // markdown checklist of measurable done conditions',
    `  classification: "QUICK" | "NEEDS_RESEARCH" | "DEEP_FOCUS" | "BENCHMARK"`,
    `  timelinePressure: "urgent" | "this-week" | "this-month" | "whenever"`,
    '  rationale: string                      // 1–2 sentences',
    '}',
    '```'
  ].join('\n')

  const benchSection = isBench
    ? [
        '',
        '## Benchmark template catalog',
        '',
        'You MUST pick exactly one `templateKind` for your final proposal:',
        '',
        buildBenchmarkCatalog()
      ].join('\n')
    : ''

  const schema = isBench ? schemaBench : schemaGeneric
  const kindLabel = isBench
    ? 'a BENCHMARK task — something with a measurable numeric score'
    : `a ${input.classification} task`

  return [
    `# You are a task-drafting assistant inside AgentCanvas`,
    ``,
    `The user wants to create ${kindLabel}. Your job is to have a short conversation with them to clarify intent, then emit a final proposal.`,
    ``,
    repoLine,
    ``,
    existing ? `## Existing task draft (what the user has so far)\n${existing}\n` : '',
    benchSection,
    ``,
    `## Conversation protocol`,
    ``,
    `On each of your turns you do ONE of two things:`,
    ``,
    `1. **Ask a clarifying question or share a brief thought.** Just respond in plain prose. Keep it short — 1–3 sentences. Use this when you need more info, or when you want to surface something you found in the repo.`,
    ``,
    `2. **Emit a final proposal.** When you have enough information (or the user has asked you to just go ahead), emit a single JSON object preceded by the literal marker \`${PROPOSAL_MARKER}\` on its own line, inside a \`\`\`json fenced block. Example:`,
    ``,
    `   ${PROPOSAL_MARKER}`,
    '   ```json',
    `   ${isBench ? '{ "kind": "benchmark", "label": "…", ... }' : '{ "kind": "generic", "label": "…", ... }'}`,
    '   ```',
    ``,
    `Do NOT emit the marker until you're confident you have a good proposal. Emit prose replies for as many turns as needed first.`,
    ``,
    `## Proposal schema`,
    schema,
    ``,
    `## Rules`,
    isBench
      ? `- \`acceptanceCriteria\` MUST contain a numeric target (e.g. "Reduce LCP by 30%").`
      : `- \`acceptanceCriteria\` should be a short markdown checklist of measurable done conditions.`,
    isBench
      ? `- For \`web-page-load\`, set \`targetUrl\` and omit \`targetFiles\`.`
      : `- Pick the \`classification\` that best fits the task. Respect the user's stated classification unless they explicitly ask you to reconsider.`,
    `- Be concise. Don't re-ask things the user already answered.`,
    `- If investigating the repo would help, do it silently via your tools, then respond.`,
    '',
    'Begin the conversation. Your first turn should acknowledge what the user said and either ask one clarifying question, or (if you already have enough) emit a proposal.'
  ]
    .filter(Boolean)
    .join('\n')
}

function serializeTurn(msg: ChatMessage): string {
  const tag = msg.role === 'user' ? 'User' : 'Assistant'
  return `[${tag}]\n${msg.content.trim()}\n`
}

function buildFullPrompt(input: SuggestInput): string {
  const system = buildSystemPrompt(input)
  const transcript = input.messages.map(serializeTurn).join('\n')
  return `${system}\n\n---\n\n## Conversation so far\n\n${transcript}\n\n[Assistant]\n`
}

function extractProposalJson(raw: string): unknown | null {
  const markerIdx = raw.indexOf(PROPOSAL_MARKER)
  if (markerIdx === -1) return null
  const afterMarker = raw.slice(markerIdx + PROPOSAL_MARKER.length)
  const fenced = afterMarker.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) {
    try {
      return JSON.parse(fenced[1])
    } catch {
      // fall through
    }
  }
  const start = afterMarker.indexOf('{')
  const end = afterMarker.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  try {
    return JSON.parse(afterMarker.slice(start, end + 1))
  } catch {
    return null
  }
}

function validateBenchmarkProposal(obj: Record<string, unknown>): BenchmarkProposal | null {
  const label = typeof obj.label === 'string' ? obj.label.trim() : ''
  const intent = typeof obj.intent === 'string' ? obj.intent.trim() : ''
  const acceptanceCriteria =
    typeof obj.acceptanceCriteria === 'string' ? obj.acceptanceCriteria.trim() : ''
  const templateKind = obj.templateKind as BenchmarkTemplateKind
  const rationale = typeof obj.rationale === 'string' ? obj.rationale.trim() : ''
  if (!label || !intent || !acceptanceCriteria || !rationale) return null
  if (!BENCHMARK_TEMPLATE_KINDS.includes(templateKind)) return null
  const noiseClass = obj.noiseClass as 'low' | 'medium' | 'high'
  if (!['low', 'medium', 'high'].includes(noiseClass)) return null
  const targetFiles = Array.isArray(obj.targetFiles)
    ? (obj.targetFiles.filter((f) => typeof f === 'string') as string[])
    : undefined
  const targetUrl = typeof obj.targetUrl === 'string' ? obj.targetUrl.trim() : undefined
  if (templateKind === 'web-page-load' && !targetUrl) return null
  return {
    kind: 'benchmark',
    label,
    intent,
    acceptanceCriteria,
    templateKind,
    targetFiles,
    targetUrl,
    noiseClass,
    higherIsBetter: Boolean(obj.higherIsBetter),
    rationale
  }
}

const VALID_CLASSIFICATIONS: TaskClassification[] = [
  'QUICK',
  'NEEDS_RESEARCH',
  'DEEP_FOCUS',
  'BENCHMARK'
]
const VALID_TIMELINES: TaskTimeline[] = ['urgent', 'this-week', 'this-month', 'whenever']

function validateGenericProposal(obj: Record<string, unknown>): GenericTaskProposal | null {
  const label = typeof obj.label === 'string' ? obj.label.trim() : ''
  const intent = typeof obj.intent === 'string' ? obj.intent.trim() : ''
  const acceptanceCriteria =
    typeof obj.acceptanceCriteria === 'string' ? obj.acceptanceCriteria.trim() : ''
  const rationale = typeof obj.rationale === 'string' ? obj.rationale.trim() : ''
  if (!label || !intent || !acceptanceCriteria) return null
  const classification = obj.classification as TaskClassification
  if (!VALID_CLASSIFICATIONS.includes(classification)) return null
  const timelinePressure = obj.timelinePressure as TaskTimeline
  if (!VALID_TIMELINES.includes(timelinePressure)) return null
  return {
    kind: 'generic',
    label,
    intent,
    acceptanceCriteria,
    classification,
    timelinePressure,
    rationale: rationale || ''
  }
}

function validateProposal(obj: unknown, expect: TaskClassification): TaskProposal | null {
  if (!obj || typeof obj !== 'object') return null
  const o = obj as Record<string, unknown>
  if (expect === 'BENCHMARK') return validateBenchmarkProposal(o)
  return validateGenericProposal(o)
}

function validateRepoPath(path: string): string | null {
  if (!path.startsWith('/')) return 'repoPath must be absolute'
  if (!existsSync(path)) return `repoPath does not exist: ${path}`
  if (!existsSync(join(path, '.git'))) return `repoPath is not a git repository: ${path}`
  return null
}

export async function suggestTask(input: SuggestInput): Promise<SuggestResult> {
  if (!input.messages || input.messages.length === 0) {
    return { ok: false, error: 'At least one user message is required.' }
  }
  if (input.repoPath) {
    const err = validateRepoPath(input.repoPath)
    if (err) return { ok: false, error: err }
  }

  const prompt = buildFullPrompt(input)
  const cwd = input.repoPath && existsSync(input.repoPath) ? input.repoPath : process.cwd()

  return new Promise<SuggestResult>((resolve) => {
    const proc = spawn('claude', ['-p', '--output-format', 'text'], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      try {
        proc.kill('SIGTERM')
      } catch {
        // ignore
      }
      resolve({
        ok: false,
        error: `claude timed out after ${SUGGEST_TIMEOUT_MS / 1000}s`,
        rawOutput: stdout
      })
    }, SUGGEST_TIMEOUT_MS)

    proc.stdout.on('data', (d) => (stdout += d.toString()))
    proc.stderr.on('data', (d) => (stderr += d.toString()))
    proc.on('error', (err) => {
      clearTimeout(timer)
      resolve({ ok: false, error: `claude CLI not found: ${err.message}` })
    })
    proc.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        resolve({
          ok: false,
          error: `claude exited ${code}${stderr ? ': ' + stderr.slice(0, 400) : ''}`,
          rawOutput: stdout
        })
        return
      }

      const raw = stdout.trim()
      const proposalJson = extractProposalJson(raw)
      if (proposalJson) {
        const proposal = validateProposal(proposalJson, input.classification)
        if (proposal) {
          resolve({ ok: true, reply: { kind: 'proposal', proposal }, rawOutput: stdout })
          return
        }
        resolve({
          ok: false,
          error: 'Proposal JSON did not match expected shape.',
          rawOutput: stdout
        })
        return
      }

      // No proposal marker → treat as a plain chat message.
      resolve({
        ok: true,
        reply: { kind: 'message', content: raw },
        rawOutput: stdout
      })
    })

    proc.stdin.write(prompt)
    proc.stdin.end()
  })
}
