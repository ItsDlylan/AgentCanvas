import { Fzf } from 'fzf'
import type { DerivedTaskState, TaskMeta } from '../../preload/index'
import type { PaletteTile } from './palette-corpus'
import { filterCorpus, parseQuery } from './palette-search'

export interface TaskRowForMatch {
  meta: TaskMeta
  state: DerivedTaskState
}

function taskRowToPaletteTile(row: TaskRowForMatch): PaletteTile {
  return {
    id: row.meta.taskId,
    type: 'task',
    label: row.meta.label,
    metadata: {},
    workspaceId: row.meta.workspaceId,
    taskClassification: row.meta.classification,
    taskState: row.state,
    taskTimeline: row.meta.timelinePressure
  }
}

/**
 * Predicate form: does this task match the given palette-style query string?
 * Uses the same parser + filter as the ⌘K palette so token semantics stay
 * identical (!class:, !state:, !when:, @workspace). Plain-text terms are
 * fuzzy-matched against the task label using the same fzf engine.
 */
export function matchTaskAgainstQuery(
  query: string,
  task: TaskRowForMatch
): boolean {
  const parsed = parseQuery(query)
  const tile = taskRowToPaletteTile(task)
  const filtered = filterCorpus([tile], parsed)
  if (filtered.length === 0) return false
  const terms = parsed.terms.trim()
  if (terms.length === 0) return true
  const fzf = new Fzf([tile], { selector: (t) => t.label, limit: 1 })
  return fzf.find(terms).length > 0
}
