import { homedir } from 'os'
import { join } from 'path'
import { readFileSync, unlinkSync, readdirSync, mkdirSync, existsSync, promises as fsp } from 'fs'

const NOTE_DIR = join(homedir(), 'AgentCanvas', 'tmp')

// Per-noteId write queue to serialize concurrent saves on the same note.
const saveQueues = new Map<string, Promise<void>>()

export interface NoteMeta {
  noteId: string
  label: string
  workspaceId: string
  isSoftDeleted: boolean
  position: { x: number; y: number }
  width: number
  height: number
  linkedTerminalId?: string
  linkedNoteId?: string
  parentTaskInfo?: { noteId?: string; taskId: string; taskItemId?: string }
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

export async function saveNote(
  noteId: string,
  meta: Partial<NoteMeta>,
  content?: Record<string, unknown>
): Promise<void> {
  ensureNoteDir()
  const filePath = join(NOTE_DIR, `note-${noteId}.json`)

  const prev = saveQueues.get(noteId) ?? Promise.resolve()
  const next = prev.then(async () => {
    let existing: NoteFile | null = null
    try {
      const raw = await fsp.readFile(filePath, 'utf-8')
      existing = JSON.parse(raw) as NoteFile
    } catch {
      // new file
    }

    const now = Date.now()
    // Guard: refuse to clobber non-empty stored content with an empty TipTap
    // doc. TipTap emits this shape during HMR / load races, and there is no
    // legitimate reason to overwrite real content with an empty doc through
    // the save path (clearing a note happens via delete, not an empty save).
    const incomingIsEmpty =
      content !== undefined &&
      content !== null &&
      typeof content === 'object' &&
      (Object.keys(content).length === 0 ||
        ((content as { type?: unknown }).type === 'doc' &&
          Array.isArray((content as { content?: unknown[] }).content) &&
          ((content as { content: unknown[] }).content as unknown[]).length === 0))
    const existingContent = existing?.content
    const existingIsNonEmpty =
      existingContent &&
      typeof existingContent === 'object' &&
      Object.keys(existingContent).length > 0 &&
      !(
        (existingContent as { type?: unknown }).type === 'doc' &&
        Array.isArray((existingContent as { content?: unknown[] }).content) &&
        ((existingContent as { content: unknown[] }).content as unknown[]).length === 0
      )
    const safeContent =
      content === undefined
        ? existingContent ?? {}
        : incomingIsEmpty && existingIsNonEmpty
          ? existingContent!
          : content
    if (content !== undefined && incomingIsEmpty && existingIsNonEmpty) {
      console.warn(
        `[note-store] refused to overwrite non-empty note ${noteId} with empty content — likely an HMR / load race`
      )
    }

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
        linkedNoteId: meta.linkedNoteId ?? existing?.meta?.linkedNoteId,
        parentTaskInfo: meta.parentTaskInfo ?? existing?.meta?.parentTaskInfo,
        createdAt: existing?.meta?.createdAt ?? now,
        updatedAt: now
      },
      content: safeContent
    }

    await fsp.writeFile(filePath, JSON.stringify(file, null, 2))
  })

  const chained = next.catch((err) => {
    console.error(`[note-store] saveNote failed for ${noteId}:`, err)
  })
  saveQueues.set(noteId, chained)
  chained.finally(() => {
    if (saveQueues.get(noteId) === chained) saveQueues.delete(noteId)
  })

  return next
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
