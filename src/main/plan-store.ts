import { homedir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'
import {
  readFileSync,
  unlinkSync,
  readdirSync,
  mkdirSync,
  existsSync,
  promises as fsp
} from 'fs'
import { markdownToTiptap } from './markdown-to-tiptap'

const PLAN_DIR = join(homedir(), 'AgentCanvas', 'tmp')

// Per-planId write queue to serialize concurrent saves on the same plan.
const saveQueues = new Map<string, Promise<void>>()

// ── Types ──

export type PlanState =
  | 'draft'
  | 'under_critique'
  | 'verified'
  | 'needs_revision'
  | 'approved'
  | 'executing'
  | 'paused_needs_replan'
  | 'done'
  | 'archived'
  | 'execution_failed'

export interface PlanMeta {
  planId: string
  workspaceId: string
  label: string
  state: PlanState
  position: { x: number; y: number }
  width: number
  height: number
  linkedTerminalId?: string
  linkedExecutorTerminalId?: string
  linkedVerifierTerminalId?: string
  linkedPR?: string
  approvedVersion?: number
  createdAt: number
  updatedAt: number
  isSoftDeleted: boolean
}

export interface Step {
  id: string
  text: string
  status: 'pending' | 'in-progress' | 'done' | 'skipped'
  notes?: string
}

export interface OpenQuestion {
  id: string
  text: string
  resolution?: string
}

export interface Verdict {
  severity: 'none' | 'minor' | 'major'
  summary: string
  findings: Array<{ severity: 'minor' | 'major'; text: string }>
}

export interface PlanBody {
  problem_statement: Record<string, unknown>
  approach: Record<string, unknown>
  steps: Step[]
  risks: string[]
  open_questions: OpenQuestion[]
  acceptance_criteria: string
}

export interface PlanVersion {
  version: number
  timestamp: number
  author: 'human' | 'capture-hook' | 'revision'
  plan: PlanBody
}

export interface Deviation {
  stepId: string
  reason: string
  proposed_change: string
  timestamp: number
  resolved: boolean
}

export interface CritiqueRef {
  version: number
  noteId: string
  verdict: Verdict
  timestamp: number
}

export interface PlanDoc {
  meta: PlanMeta
  versions: PlanVersion[]
  critiqueNoteIds: CritiqueRef[]
  deviations: Deviation[]
}

// ── State machine ──

const TRANSITIONS: Record<PlanState, PlanState[]> = {
  draft: ['under_critique', 'archived'],
  under_critique: ['verified', 'needs_revision', 'draft'],
  verified: ['approved', 'draft', 'archived'],
  needs_revision: ['approved', 'draft', 'archived'],
  approved: ['executing', 'draft', 'archived'],
  executing: ['done', 'paused_needs_replan', 'execution_failed'],
  paused_needs_replan: ['draft', 'executing', 'archived'],
  done: ['executing', 'archived'],
  archived: ['draft'],
  execution_failed: ['executing', 'draft', 'archived']
}

export function canTransition(from: PlanState, to: PlanState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false
}

// ── IO helpers ──

export function ensurePlanDir(): void {
  if (!existsSync(PLAN_DIR)) mkdirSync(PLAN_DIR, { recursive: true })
}

function planPath(planId: string): string {
  return join(PLAN_DIR, `plan-${planId}.json`)
}

export function loadPlan(planId: string): PlanDoc | null {
  try {
    const raw = readFileSync(planPath(planId), 'utf-8')
    return JSON.parse(raw) as PlanDoc
  } catch {
    return null
  }
}

async function writePlan(doc: PlanDoc): Promise<void> {
  ensurePlanDir()
  const planId = doc.meta.planId
  const filePath = planPath(planId)

  const prev = saveQueues.get(planId) ?? Promise.resolve()
  const next = prev.then(async () => {
    doc.meta.updatedAt = Date.now()
    await fsp.writeFile(filePath, JSON.stringify(doc, null, 2))
  })

  const chained = next.catch((err) => {
    console.error(`[plan-store] writePlan failed for ${planId}:`, err)
  })
  saveQueues.set(planId, chained)
  chained.finally(() => {
    if (saveQueues.get(planId) === chained) saveQueues.delete(planId)
  })

  return next
}

// Read-modify-write helper. Loads the latest on-disk doc, runs mutator, writes.
async function mutate(
  planId: string,
  mutator: (doc: PlanDoc) => void | Promise<void>
): Promise<PlanDoc> {
  const prev = saveQueues.get(planId) ?? Promise.resolve()

  let result: PlanDoc | null = null
  const next = prev.then(async () => {
    const doc = loadPlan(planId)
    if (!doc) throw new Error(`Plan not found: ${planId}`)
    await mutator(doc)
    doc.meta.updatedAt = Date.now()
    await fsp.writeFile(planPath(planId), JSON.stringify(doc, null, 2))
    result = doc
  })

  const chained = next.catch((err) => {
    console.error(`[plan-store] mutate failed for ${planId}:`, err)
    throw err
  })
  saveQueues.set(planId, chained)
  chained.finally(() => {
    if (saveQueues.get(planId) === chained) saveQueues.delete(planId)
  })

  await next
  if (!result) throw new Error(`Plan mutation produced no result: ${planId}`)
  return result
}

// ── Parsing markdown into a PlanBody ──

const SECTION_HEADINGS: Record<keyof Pick<PlanBody, 'problem_statement' | 'approach' | 'steps' | 'risks' | 'open_questions' | 'acceptance_criteria'>, RegExp[]> = {
  problem_statement: [/^##+\s*problem(\s+statement)?\b/i],
  approach: [/^##+\s*approach\b/i, /^##+\s*strategy\b/i, /^##+\s*plan\b/i],
  steps: [/^##+\s*steps?\b/i, /^##+\s*implementation\b/i, /^##+\s*todo\b/i],
  risks: [/^##+\s*risks?\b/i, /^##+\s*concerns?\b/i],
  open_questions: [/^##+\s*open\s*questions?\b/i, /^##+\s*questions?\b/i, /^##+\s*unknowns?\b/i],
  acceptance_criteria: [/^##+\s*acceptance(\s+criteria)?\b/i, /^##+\s*definition\s+of\s+done\b/i]
}

type SectionKey = keyof typeof SECTION_HEADINGS

function matchSection(line: string): SectionKey | null {
  for (const key of Object.keys(SECTION_HEADINGS) as SectionKey[]) {
    for (const re of SECTION_HEADINGS[key]) {
      if (re.test(line)) return key
    }
  }
  return null
}

function emptyBody(): PlanBody {
  return {
    problem_statement: markdownToTiptap(''),
    approach: markdownToTiptap(''),
    steps: [],
    risks: [],
    open_questions: [],
    acceptance_criteria: ''
  }
}

function makeStepId(): string {
  return `s_${randomUUID().slice(0, 8)}`
}

function makeQuestionId(): string {
  return `q_${randomUUID().slice(0, 8)}`
}

function extractListItems(text: string): string[] {
  const items: string[] = []
  const lines = text.split('\n')
  let current: string | null = null
  for (const line of lines) {
    const listMatch = /^\s*(?:[-*+]|\d+\.)\s+(?:\[[ xX]\]\s+)?(.+)$/.exec(line)
    if (listMatch) {
      if (current !== null) items.push(current.trim())
      current = listMatch[1]
      continue
    }
    if (current !== null && /^\s{2,}\S/.test(line)) {
      // continuation of previous item
      current += ' ' + line.trim()
      continue
    }
    if (current !== null && line.trim() === '') {
      items.push(current.trim())
      current = null
    }
  }
  if (current !== null) items.push(current.trim())
  return items.filter((s) => s.length > 0)
}

export function parseMarkdownToPlan(md: string): PlanBody {
  const trimmed = (md ?? '').trim()
  if (!trimmed) return emptyBody()

  // Split the document into section buckets keyed by heading.
  const sections: Partial<Record<SectionKey, string[]>> = {}
  const preamble: string[] = []
  let current: SectionKey | null = null

  for (const line of trimmed.split('\n')) {
    if (/^##+\s+/.test(line)) {
      const matched = matchSection(line)
      if (matched) {
        current = matched
        if (!sections[current]) sections[current] = []
        continue
      }
      // Unrecognized heading → demote to preamble/approach if we haven't hit a known section yet.
      if (current) sections[current]!.push(line)
      else preamble.push(line)
      continue
    }
    if (current) sections[current]!.push(line)
    else preamble.push(line)
  }

  const body = emptyBody()
  const preambleText = preamble.join('\n').trim()

  if (sections.problem_statement) {
    body.problem_statement = markdownToTiptap(sections.problem_statement.join('\n').trim())
  } else if (preambleText) {
    body.problem_statement = markdownToTiptap(preambleText)
  }

  if (sections.approach) {
    body.approach = markdownToTiptap(sections.approach.join('\n').trim())
  } else if (!sections.problem_statement && preambleText && Object.keys(sections).length === 0) {
    // No headings at all — the whole blob becomes `approach` so nothing is lost.
    body.approach = markdownToTiptap(trimmed)
  }

  if (sections.steps) {
    const items = extractListItems(sections.steps.join('\n'))
    body.steps = items.map((text) => ({ id: makeStepId(), text, status: 'pending' as const }))
  }

  if (sections.risks) {
    body.risks = extractListItems(sections.risks.join('\n'))
  }

  if (sections.open_questions) {
    body.open_questions = extractListItems(sections.open_questions.join('\n')).map((text) => ({
      id: makeQuestionId(),
      text
    }))
  }

  if (sections.acceptance_criteria) {
    body.acceptance_criteria = sections.acceptance_criteria.join('\n').trim()
  }

  return body
}

// ── Public API ──

export interface CreatePlanInput {
  label?: string
  workspaceId?: string
  content?: string | Partial<PlanBody>
  linkedTerminalId?: string
  position?: { x: number; y: number }
  width?: number
  height?: number
  author?: PlanVersion['author']
}

export async function createPlan(input: CreatePlanInput): Promise<PlanDoc> {
  ensurePlanDir()
  const planId = randomUUID()
  const now = Date.now()

  let body: PlanBody
  if (!input.content) {
    body = emptyBody()
  } else if (typeof input.content === 'string') {
    body = parseMarkdownToPlan(input.content)
  } else {
    body = { ...emptyBody(), ...input.content }
  }

  const doc: PlanDoc = {
    meta: {
      planId,
      workspaceId: input.workspaceId ?? 'default',
      label: input.label ?? 'Plan',
      state: 'draft',
      position: input.position ?? { x: 120, y: 120 },
      width: input.width ?? 480,
      height: input.height ?? 560,
      linkedTerminalId: input.linkedTerminalId,
      createdAt: now,
      updatedAt: now,
      isSoftDeleted: false
    },
    versions: [
      {
        version: 1,
        timestamp: now,
        author: input.author ?? 'human',
        plan: body
      }
    ],
    critiqueNoteIds: [],
    deviations: []
  }

  await writePlan(doc)
  return doc
}

export function latestVersion(doc: PlanDoc): PlanVersion {
  return doc.versions[doc.versions.length - 1]
}

export function getApprovedVersion(doc: PlanDoc): PlanVersion | null {
  if (!doc.meta.approvedVersion) return null
  return doc.versions.find((v) => v.version === doc.meta.approvedVersion) ?? null
}

/**
 * Update plan fields. Always appends a new version (never mutates existing versions).
 * If the plan was `approved`, state reverts to `draft` — the approved snapshot remains
 * referenced by `approvedVersion` and continues to drive any running execution.
 */
export async function updatePlan(
  planId: string,
  patch: Partial<PlanBody>,
  author: PlanVersion['author'] = 'human'
): Promise<PlanDoc> {
  return mutate(planId, (doc) => {
    const current = latestVersion(doc).plan
    const next: PlanBody = {
      problem_statement: patch.problem_statement ?? current.problem_statement,
      approach: patch.approach ?? current.approach,
      steps: patch.steps ?? current.steps,
      risks: patch.risks ?? current.risks,
      open_questions: patch.open_questions ?? current.open_questions,
      acceptance_criteria: patch.acceptance_criteria ?? current.acceptance_criteria
    }
    doc.versions.push({
      version: doc.versions.length + 1,
      timestamp: Date.now(),
      author,
      plan: next
    })
    if (doc.meta.state === 'approved' || doc.meta.state === 'verified' || doc.meta.state === 'needs_revision') {
      doc.meta.state = 'draft'
    }
  })
}

export async function renamePlan(planId: string, label: string): Promise<PlanDoc> {
  return mutate(planId, (doc) => {
    doc.meta.label = label
  })
}

export async function movePlan(
  planId: string,
  position: { x: number; y: number }
): Promise<PlanDoc> {
  return mutate(planId, (doc) => {
    doc.meta.position = position
  })
}

export async function resizePlan(
  planId: string,
  width: number,
  height: number
): Promise<PlanDoc> {
  return mutate(planId, (doc) => {
    doc.meta.width = width
    doc.meta.height = height
  })
}

/**
 * Enforced state transition. Throws on illegal transitions.
 */
export async function transition(planId: string, to: PlanState): Promise<PlanDoc> {
  return mutate(planId, (doc) => {
    const from = doc.meta.state
    if (from === to) return // idempotent
    if (!canTransition(from, to)) {
      throw new Error(`Illegal plan state transition: ${from} → ${to}`)
    }
    doc.meta.state = to
  })
}

/**
 * Approve the current latest version. Gates on all open_questions having a `resolution`.
 */
export async function approvePlan(planId: string): Promise<PlanDoc> {
  return mutate(planId, (doc) => {
    const from = doc.meta.state
    if (from !== 'verified' && from !== 'needs_revision') {
      throw new Error(`Cannot approve plan in state: ${from}`)
    }
    const version = latestVersion(doc)
    const unresolved = version.plan.open_questions.filter(
      (q) => !q.resolution || !q.resolution.trim()
    )
    if (unresolved.length > 0) {
      throw new Error(
        `Cannot approve: ${unresolved.length} open question(s) unresolved`
      )
    }
    doc.meta.state = 'approved'
    doc.meta.approvedVersion = version.version
  })
}

export async function unapprovePlan(planId: string): Promise<PlanDoc> {
  return mutate(planId, (doc) => {
    if (doc.meta.state !== 'approved') {
      throw new Error(`Cannot unapprove plan in state: ${doc.meta.state}`)
    }
    doc.meta.state = 'draft'
    // approvedVersion retained so we can tell what was previously approved.
  })
}

export async function setApprovedVersion(
  planId: string,
  version: number
): Promise<PlanDoc> {
  return mutate(planId, (doc) => {
    const exists = doc.versions.some((v) => v.version === version)
    if (!exists) throw new Error(`Version ${version} not found`)
    doc.meta.approvedVersion = version
  })
}

export async function attachVerifierTerminal(
  planId: string,
  terminalId: string
): Promise<PlanDoc> {
  return mutate(planId, (doc) => {
    doc.meta.linkedVerifierTerminalId = terminalId
  })
}

export async function attachExecutorTerminal(
  planId: string,
  terminalId: string
): Promise<PlanDoc> {
  return mutate(planId, (doc) => {
    doc.meta.linkedExecutorTerminalId = terminalId
  })
}

export async function attachPR(planId: string, prRef: string): Promise<PlanDoc> {
  return mutate(planId, (doc) => {
    doc.meta.linkedPR = prRef
  })
}

export async function recordCritique(
  planId: string,
  critique: CritiqueRef
): Promise<PlanDoc> {
  return mutate(planId, (doc) => {
    doc.critiqueNoteIds.push(critique)
    const nextState: PlanState =
      critique.verdict.severity === 'major' ? 'needs_revision' : 'verified'
    if (!canTransition(doc.meta.state, nextState)) {
      throw new Error(
        `Cannot record critique from state ${doc.meta.state} → ${nextState}`
      )
    }
    doc.meta.state = nextState
  })
}

export async function completeStep(
  planId: string,
  stepId: string,
  notes?: string
): Promise<PlanDoc> {
  return mutate(planId, (doc) => {
    if (doc.meta.state !== 'executing') {
      throw new Error(`Cannot complete step in state: ${doc.meta.state}`)
    }
    const approved = getApprovedVersion(doc)
    if (!approved) throw new Error('No approved version to complete step against')
    const step = approved.plan.steps.find((s) => s.id === stepId)
    if (!step) throw new Error(`Step not found: ${stepId}`)
    step.status = 'done'
    if (notes && notes.trim()) step.notes = notes.trim()
  })
}

export async function markStepInProgress(
  planId: string,
  stepId: string
): Promise<PlanDoc> {
  return mutate(planId, (doc) => {
    const approved = getApprovedVersion(doc)
    if (!approved) throw new Error('No approved version')
    const step = approved.plan.steps.find((s) => s.id === stepId)
    if (!step) throw new Error(`Step not found: ${stepId}`)
    step.status = 'in-progress'
  })
}

export async function addDeviation(
  planId: string,
  stepId: string,
  reason: string,
  proposed_change: string
): Promise<PlanDoc> {
  return mutate(planId, (doc) => {
    if (doc.meta.state !== 'executing') {
      throw new Error(`Cannot record deviation in state: ${doc.meta.state}`)
    }
    doc.deviations.push({
      stepId,
      reason,
      proposed_change,
      timestamp: Date.now(),
      resolved: false
    })
    doc.meta.state = 'paused_needs_replan'
  })
}

export async function markPlanDone(planId: string): Promise<PlanDoc> {
  return mutate(planId, (doc) => {
    if (!canTransition(doc.meta.state, 'done')) {
      throw new Error(`Cannot mark done from state: ${doc.meta.state}`)
    }
    doc.meta.state = 'done'
  })
}

export async function markExecutionFailed(planId: string): Promise<PlanDoc> {
  return mutate(planId, (doc) => {
    if (doc.meta.state !== 'executing') return // already not executing
    doc.meta.state = 'execution_failed'
  })
}

export async function archivePlan(planId: string): Promise<PlanDoc> {
  return mutate(planId, (doc) => {
    if (doc.meta.state === 'executing') {
      throw new Error('Cannot archive an executing plan; pause or fail it first')
    }
    doc.meta.state = 'archived'
  })
}

export function deletePlan(planId: string): void {
  try {
    unlinkSync(planPath(planId))
  } catch {
    // already gone
  }
}

export function listPlans(): PlanDoc[] {
  ensurePlanDir()
  try {
    const files = readdirSync(PLAN_DIR).filter(
      (f) => f.startsWith('plan-') && f.endsWith('.json')
    )
    const results: PlanDoc[] = []
    for (const f of files) {
      const planId = f.replace(/^plan-/, '').replace(/\.json$/, '')
      const loaded = loadPlan(planId)
      if (loaded && !loaded.meta.isSoftDeleted) results.push(loaded)
    }
    return results
  } catch {
    return []
  }
}

/**
 * Build a progress summary suitable for embedding in a resume prompt.
 * Format: "Step s_1 (done): Refactor auth store. Notes: …\nStep s_2 (done): …\nStep s_3 (pending): …"
 */
export function renderProgressSummary(doc: PlanDoc): string {
  const approved = getApprovedVersion(doc)
  if (!approved) return ''
  return approved.plan.steps
    .map((s) => {
      const notes = s.notes ? ` Notes: ${s.notes}` : ''
      return `Step ${s.id} (${s.status}): ${s.text}.${notes}`
    })
    .join('\n')
}
