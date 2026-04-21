import type { DerivedTaskState, TaskClassification } from './task-store'
import type { EdgeKind, PersistedEdge } from './edge-store'
import type { PlanState } from './plan-store'

export interface StateDeriveInputs {
  taskId: string
  classification: TaskClassification
  manualReviewDone: boolean
  edges: PersistedEdge[]
  getPlanState: (planId: string) => PlanState | undefined
  getTerminalStatus: (terminalId: string) => { running: boolean } | undefined
}

export interface StateDeriveResult {
  state: DerivedTaskState
  reason: string
}

function outgoingEdgesOfKind(
  edges: PersistedEdge[],
  sourceId: string,
  kind: EdgeKind
): PersistedEdge[] {
  return edges.filter((e) => e.source === sourceId && e.kind === kind)
}

function mapPlanStateToTaskState(planState: PlanState): DerivedTaskState {
  switch (planState) {
    case 'draft':
    case 'under_critique':
    case 'verified':
    case 'needs_revision':
    case 'approved':
      return 'planned'
    case 'executing':
    case 'paused_needs_replan':
      return 'executing'
    case 'done':
      return 'review'
    case 'execution_failed':
      return 'review'
    case 'archived':
      return 'planned'
    default:
      return 'planned'
  }
}

export function deriveTaskState(inputs: StateDeriveInputs): StateDeriveResult {
  if (inputs.manualReviewDone) {
    return { state: 'done', reason: 'Marked reviewed by human' }
  }

  const { classification, edges, taskId } = inputs

  const executingEdges = outgoingEdgesOfKind(edges, taskId, 'executing-in')
  const researchEdges = outgoingEdgesOfKind(edges, taskId, 'research-output')
  const planEdges = outgoingEdgesOfKind(edges, taskId, 'has-plan')

  if (classification === 'QUICK' || classification === 'BENCHMARK') {
    if (executingEdges.length === 0) {
      return { state: 'raw', reason: 'No linked terminal' }
    }
    // A terminal session with ANY status (idle / running / waiting) means the
    // terminal is still alive. Only treat it as "review" once the terminal
    // has been closed entirely (session removed → getTerminalStatus returns undefined).
    const someAlive = executingEdges.some((e) => {
      const info = inputs.getTerminalStatus(e.target)
      return info !== undefined
    })
    if (someAlive) return { state: 'executing', reason: 'Linked terminal is alive' }
    return { state: 'review', reason: 'Linked terminal(s) closed' }
  }

  // NEEDS_RESEARCH or DEEP_FOCUS
  if (planEdges.length > 0) {
    for (const edge of planEdges) {
      const planState = inputs.getPlanState(edge.target)
      if (planState) {
        const mapped = mapPlanStateToTaskState(planState)
        return { state: mapped, reason: `Linked plan is ${planState}` }
      }
    }
    return { state: 'planned', reason: 'Has linked plan (state unknown)' }
  }

  if (researchEdges.length > 0) {
    return { state: 'researched', reason: 'Has linked research output' }
  }

  return { state: 'raw', reason: 'No artifacts linked yet' }
}

export function derivedStateEquals(a: StateDeriveResult, b: StateDeriveResult): boolean {
  return a.state === b.state
}
