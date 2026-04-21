import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, unlinkSync } from 'fs'

export interface TaskLensView {
  id: string
  label: string
  query: string
  builtIn?: boolean
}

export interface TaskLensUserConfig {
  version: 1
  views: TaskLensView[]
  order: string[]
}

const DEFAULT_CONFIG: TaskLensUserConfig = {
  version: 1,
  views: [],
  order: []
}

function getStorePath(): string {
  const dir = join(app.getPath('userData'), 'agentcanvas')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'task-lens-views.json')
}

function isValidConfig(value: unknown): value is TaskLensUserConfig {
  if (!value || typeof value !== 'object') return false
  const c = value as Record<string, unknown>
  if (c.version !== 1) return false
  if (!Array.isArray(c.views)) return false
  if (!Array.isArray(c.order)) return false
  for (const v of c.views) {
    if (!v || typeof v !== 'object') return false
    const view = v as Record<string, unknown>
    if (typeof view.id !== 'string' || !view.id) return false
    if (typeof view.label !== 'string') return false
    if (typeof view.query !== 'string') return false
  }
  for (const id of c.order) {
    if (typeof id !== 'string') return false
  }
  return true
}

export function loadTaskLensConfig(): TaskLensUserConfig {
  const filePath = getStorePath()
  try {
    const raw = readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw)
    if (!isValidConfig(parsed)) return { ...DEFAULT_CONFIG }
    const views = parsed.views.map((v) => ({
      id: v.id,
      label: v.label,
      query: v.query,
      builtIn: false as const
    }))
    return { version: 1, views, order: [...parsed.order] }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

export function saveTaskLensConfig(config: TaskLensUserConfig): void {
  if (!isValidConfig(config)) {
    throw new Error('Invalid TaskLensUserConfig')
  }
  const normalized: TaskLensUserConfig = {
    version: 1,
    views: config.views.map((v) => ({
      id: v.id,
      label: v.label,
      query: v.query,
      builtIn: false
    })),
    order: [...config.order]
  }
  const filePath = getStorePath()
  const tmpPath = `${filePath}.tmp`
  writeFileSync(tmpPath, JSON.stringify(normalized, null, 2))
  try {
    renameSync(tmpPath, filePath)
  } catch (err) {
    try {
      unlinkSync(tmpPath)
    } catch {
      /* ignore */
    }
    throw err
  }
}
