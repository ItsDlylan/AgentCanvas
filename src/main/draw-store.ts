import { homedir } from 'os'
import { join } from 'path'
import { readFileSync, writeFileSync, unlinkSync, readdirSync, mkdirSync, existsSync } from 'fs'

const DRAW_DIR = join(homedir(), 'AgentCanvas', 'tmp')

export interface DrawMeta {
  drawId: string
  label: string
  workspaceId: string
  isSoftDeleted: boolean
  position: { x: number; y: number }
  width: number
  height: number
  linkedTerminalId?: string
  createdAt: number
  updatedAt: number
}

export interface DrawFile {
  meta: DrawMeta
  elements: unknown[]
  appState: Record<string, unknown>
}

export function ensureDrawDir(): void {
  if (!existsSync(DRAW_DIR)) mkdirSync(DRAW_DIR, { recursive: true })
}

export function loadDraw(drawId: string): DrawFile | null {
  const filePath = join(DRAW_DIR, `draw-${drawId}.json`)
  try {
    const raw = readFileSync(filePath, 'utf-8')
    return JSON.parse(raw) as DrawFile
  } catch {
    return null
  }
}

export function saveDraw(
  drawId: string,
  meta: Partial<DrawMeta>,
  elements?: unknown[],
  appState?: Record<string, unknown>
): void {
  ensureDrawDir()
  const filePath = join(DRAW_DIR, `draw-${drawId}.json`)
  let existing: DrawFile | null = null
  try {
    const raw = readFileSync(filePath, 'utf-8')
    existing = JSON.parse(raw) as DrawFile
  } catch {
    // new file
  }

  const now = Date.now()
  const file: DrawFile = {
    meta: {
      drawId,
      label: meta.label ?? existing?.meta?.label ?? 'Draw',
      workspaceId: meta.workspaceId ?? existing?.meta?.workspaceId ?? 'default',
      isSoftDeleted: meta.isSoftDeleted ?? existing?.meta?.isSoftDeleted ?? false,
      position: meta.position ?? existing?.meta?.position ?? { x: 100, y: 100 },
      width: meta.width ?? existing?.meta?.width ?? 800,
      height: meta.height ?? existing?.meta?.height ?? 600,
      linkedTerminalId: meta.linkedTerminalId ?? existing?.meta?.linkedTerminalId,
      createdAt: existing?.meta?.createdAt ?? now,
      updatedAt: now
    },
    elements: elements ?? existing?.elements ?? [],
    appState: appState ?? existing?.appState ?? {}
  }

  writeFileSync(filePath, JSON.stringify(file, null, 2))
}

export function deleteDraw(drawId: string): void {
  const filePath = join(DRAW_DIR, `draw-${drawId}.json`)
  try {
    unlinkSync(filePath)
  } catch {
    // File already gone — no-op
  }
}

export function listDraws(): DrawFile[] {
  ensureDrawDir()
  try {
    const files = readdirSync(DRAW_DIR).filter((f) => f.startsWith('draw-') && f.endsWith('.json'))
    const results: DrawFile[] = []
    for (const f of files) {
      try {
        const drawId = f.replace(/^draw-/, '').replace(/\.json$/, '')
        const loaded = loadDraw(drawId)
        if (loaded) results.push(loaded)
      } catch {
        // skip corrupt files
      }
    }
    return results
  } catch {
    return []
  }
}
