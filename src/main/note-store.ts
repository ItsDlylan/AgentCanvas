import { homedir } from 'os'
import { join } from 'path'
import { readFileSync, writeFileSync, unlinkSync, readdirSync, mkdirSync, existsSync } from 'fs'

const NOTE_DIR = join(homedir(), 'AgentCanvas', 'tmp')

export interface NoteMeta {
  noteId: string
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

export interface NoteFile {
  meta: NoteMeta
  content: Record<string, unknown>
}

export function ensureNoteDir(): void {
  if (!existsSync(NOTE_DIR)) mkdirSync(NOTE_DIR, { recursive: true })
}

export function loadNote(noteId: string): NoteFile | null {
  const filePath = join(NOTE_DIR, `note-${noteId}.json`)
  try {
    const raw = readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw)
    // Handle legacy files that are raw TipTap content (no meta wrapper)
    if (!parsed.meta) {
      return {
        meta: {
          noteId,
          label: 'Note',
          workspaceId: 'default',
          isSoftDeleted: false,
          position: { x: 100, y: 100 },
          width: 400,
          height: 400,
          createdAt: Date.now(),
          updatedAt: Date.now()
        },
        content: parsed
      }
    }
    return parsed as NoteFile
  } catch {
    return null
  }
}

export function saveNote(noteId: string, meta: Partial<NoteMeta>, content?: Record<string, unknown>): void {
  ensureNoteDir()
  const filePath = join(NOTE_DIR, `note-${noteId}.json`)
  // Load existing to merge
  let existing: NoteFile | null = null
  try {
    const raw = readFileSync(filePath, 'utf-8')
    existing = JSON.parse(raw) as NoteFile
  } catch {
    // new file
  }

  const now = Date.now()
  const file: NoteFile = {
    meta: {
      noteId,
      label: meta.label ?? existing?.meta?.label ?? 'Note',
      workspaceId: meta.workspaceId ?? existing?.meta?.workspaceId ?? 'default',
      isSoftDeleted: meta.isSoftDeleted ?? existing?.meta?.isSoftDeleted ?? false,
      position: meta.position ?? existing?.meta?.position ?? { x: 100, y: 100 },
      width: meta.width ?? existing?.meta?.width ?? 400,
      height: meta.height ?? existing?.meta?.height ?? 400,
      linkedTerminalId: meta.linkedTerminalId ?? existing?.meta?.linkedTerminalId,
      createdAt: existing?.meta?.createdAt ?? now,
      updatedAt: now
    },
    content: content ?? existing?.content ?? {}
  }

  writeFileSync(filePath, JSON.stringify(file, null, 2))
}

export function deleteNote(noteId: string): void {
  const filePath = join(NOTE_DIR, `note-${noteId}.json`)
  try {
    unlinkSync(filePath)
  } catch {
    // File already gone — no-op
  }
}

export function listNotes(): NoteFile[] {
  ensureNoteDir()
  try {
    const files = readdirSync(NOTE_DIR).filter((f) => f.startsWith('note-') && f.endsWith('.json'))
    const results: NoteFile[] = []
    for (const f of files) {
      try {
        const noteId = f.replace(/^note-/, '').replace(/\.json$/, '')
        const loaded = loadNote(noteId)
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
