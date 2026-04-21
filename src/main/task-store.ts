import { homedir } from 'os'
import { join } from 'path'
import {
  readFileSync,
  unlinkSync,
  readdirSync,
  mkdirSync,
  existsSync,
  promises as fsp
} from 'fs'

const TASK_DIR = join(homedir(), 'AgentCanvas', 'tmp')
const saveQueues = new Map<string, Promise<void>>()

export type TaskClassification = 'QUICK' | 'NEEDS_RESEARCH' | 'DEEP_FOCUS' | 'BENCHMARK'
export type TaskTimeline = 'urgent' | 'this-week' | 'this-month' | 'whenever'
export type DerivedTaskState =
  | 'raw'
  | 'researched'
  | 'planned'
  | 'executing'
  | 'review'
  | 'done'

export interface TaskMeta {
  taskId: string
  label: string
  workspaceId: string
  classification: TaskClassification
  timelinePressure: TaskTimeline
  manualReviewDone: boolean
  position: { x: number; y: number }
  width: number
  height: number
  isSoftDeleted: boolean
  softDeletedAt?: number
  createdAt: number
  updatedAt: number
}

export interface TaskFile {
  meta: TaskMeta
  intent: string
  acceptanceCriteria: Record<string, unknown>
}

export function ensureTaskDir(): void {
  if (!existsSync(TASK_DIR)) mkdirSync(TASK_DIR, { recursive: true })
}

function taskPath(taskId: string): string {
  return join(TASK_DIR, `task-${taskId}.json`)
}

export function loadTask(taskId: string): TaskFile | null {
  try {
    const raw = readFileSync(taskPath(taskId), 'utf-8')
    return JSON.parse(raw) as TaskFile
  } catch {
    return null
  }
}

export async function saveTask(
  taskId: string,
  meta: Partial<TaskMeta>,
  intent?: string,
  acceptanceCriteria?: Record<string, unknown>
): Promise<void> {
  ensureTaskDir()
  const filePath = taskPath(taskId)

  const prev = saveQueues.get(taskId) ?? Promise.resolve()
  const next = prev.then(async () => {
    let existing: TaskFile | null = null
    try {
      const raw = await fsp.readFile(filePath, 'utf-8')
      existing = JSON.parse(raw) as TaskFile
    } catch {
      // new file
    }

    const now = Date.now()
    const file: TaskFile = {
      meta: {
        taskId,
        label: meta.label ?? existing?.meta.label ?? 'Task',
        workspaceId: meta.workspaceId ?? existing?.meta.workspaceId ?? 'default',
        classification:
          meta.classification ?? existing?.meta.classification ?? 'QUICK',
        timelinePressure:
          meta.timelinePressure ?? existing?.meta.timelinePressure ?? 'whenever',
        manualReviewDone: meta.manualReviewDone ?? existing?.meta.manualReviewDone ?? false,
        position: meta.position ?? existing?.meta.position ?? { x: 100, y: 100 },
        width: meta.width ?? existing?.meta.width ?? 400,
        height: meta.height ?? existing?.meta.height ?? 400,
        isSoftDeleted: meta.isSoftDeleted ?? existing?.meta.isSoftDeleted ?? false,
        softDeletedAt: meta.softDeletedAt ?? existing?.meta.softDeletedAt,
        createdAt: existing?.meta.createdAt ?? now,
        updatedAt: now
      },
      intent: intent ?? existing?.intent ?? '',
      acceptanceCriteria: acceptanceCriteria ?? existing?.acceptanceCriteria ?? {}
    }

    await fsp.writeFile(filePath, JSON.stringify(file, null, 2))
  })

  const chained = next.catch((err) => {
    console.error(`[task-store] saveTask failed for ${taskId}:`, err)
  })
  saveQueues.set(taskId, chained)
  chained.finally(() => {
    if (saveQueues.get(taskId) === chained) saveQueues.delete(taskId)
  })

  return next
}

export function deleteTask(taskId: string): void {
  try {
    unlinkSync(taskPath(taskId))
  } catch {
    // already gone
  }
}

export function listTasks(): TaskFile[] {
  ensureTaskDir()
  try {
    const files = readdirSync(TASK_DIR).filter(
      (f) => f.startsWith('task-') && f.endsWith('.json')
    )
    const results: TaskFile[] = []
    for (const f of files) {
      const taskId = f.replace(/^task-/, '').replace(/\.json$/, '')
      const loaded = loadTask(taskId)
      if (loaded) results.push(loaded)
    }
    return results
  } catch {
    return []
  }
}

export interface TaskFilter {
  classification?: TaskClassification
  workspaceId?: string
  timeline?: TaskTimeline
  includeSoftDeleted?: boolean
}

export function filterTasks(tasks: TaskFile[], filter: TaskFilter): TaskFile[] {
  return tasks.filter((t) => {
    if (!filter.includeSoftDeleted && t.meta.isSoftDeleted) return false
    if (filter.classification && t.meta.classification !== filter.classification) return false
    if (filter.workspaceId && t.meta.workspaceId !== filter.workspaceId) return false
    if (filter.timeline && t.meta.timelinePressure !== filter.timeline) return false
    return true
  })
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

export function findTasksForSweep(tasks: TaskFile[], now = Date.now()): string[] {
  return tasks
    .filter(
      (t) =>
        t.meta.isSoftDeleted &&
        t.meta.softDeletedAt !== undefined &&
        now - t.meta.softDeletedAt >= SEVEN_DAYS_MS
    )
    .map((t) => t.meta.taskId)
}
