import { homedir } from 'os'
import { join, basename } from 'path'
import { mkdirSync, existsSync, copyFileSync, writeFileSync, readdirSync, rmSync, unlinkSync, statSync } from 'fs'
import { v4 as uuid } from 'uuid'
import { listNotes, loadNote } from './note-store'

const ATTACHMENTS_DIR = join(homedir(), 'AgentCanvas', 'attachments')

export function ensureAttachmentDir(noteId: string): string {
  const dir = join(ATTACHMENTS_DIR, noteId)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

/** Save raw data (e.g., from clipboard paste) to the attachments directory. Returns the agentcanvas:// URL. */
export function saveAttachment(noteId: string, filename: string, data: Buffer): string {
  const dir = ensureAttachmentDir(noteId)
  const safeFilename = `${uuid()}-${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`
  const filePath = join(dir, safeFilename)
  writeFileSync(filePath, data)
  return `agentcanvas://attachment/${noteId}/${safeFilename}`
}

/** Copy a file from a source path (for drag-and-drop of local files). Returns the agentcanvas:// URL. */
export function saveAttachmentFromPath(noteId: string, sourcePath: string): string {
  const dir = ensureAttachmentDir(noteId)
  const originalName = basename(sourcePath)
  const safeFilename = `${uuid()}-${originalName.replace(/[^a-zA-Z0-9._-]/g, '_')}`
  const destPath = join(dir, safeFilename)
  copyFileSync(sourcePath, destPath)
  return `agentcanvas://attachment/${noteId}/${safeFilename}`
}

/** Recursively delete all attachments for a note. */
export function deleteAttachments(noteId: string): void {
  const dir = join(ATTACHMENTS_DIR, noteId)
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** List all attachment filenames for a note. */
export function listAttachments(noteId: string): string[] {
  const dir = join(ATTACHMENTS_DIR, noteId)
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

/** Walk a TipTap doc and collect referenced attachment filenames for a given noteId. */
function collectReferencedFilenames(content: unknown, noteId: string): Set<string> {
  const prefix = `agentcanvas://attachment/${noteId}/`
  const referenced = new Set<string>()
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    const n = node as { type?: string; attrs?: { src?: unknown }; content?: unknown[] }
    if ((n.type === 'image' || n.type === 'video') && typeof n.attrs?.src === 'string') {
      if (n.attrs.src.startsWith(prefix)) referenced.add(n.attrs.src.slice(prefix.length))
    }
    if (Array.isArray(n.content)) for (const child of n.content) walk(child)
  }
  walk(content)
  return referenced
}

/**
 * Delete any attachment file for `noteId` that is not referenced in the currently saved doc.
 * Returns the number of files removed.
 */
export function sweepNoteAttachments(noteId: string): number {
  const dir = join(ATTACHMENTS_DIR, noteId)
  if (!existsSync(dir)) return 0

  const note = loadNote(noteId)
  if (!note) {
    // Note file no longer exists — drop the whole attachment dir.
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
    return 0
  }

  const referenced = collectReferencedFilenames(note.content, noteId)
  let removed = 0
  try {
    for (const filename of readdirSync(dir)) {
      if (referenced.has(filename)) continue
      try {
        unlinkSync(join(dir, filename))
        removed++
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
  return removed
}

/**
 * Sweep attachments across all notes: removes unreferenced files per note and
 * drops attachment dirs for notes that no longer exist. Safe to call on startup.
 * Returns { notesScanned, filesRemoved, orphanDirsRemoved }.
 */
export function sweepAllAttachments(): { notesScanned: number; filesRemoved: number; orphanDirsRemoved: number } {
  if (!existsSync(ATTACHMENTS_DIR)) return { notesScanned: 0, filesRemoved: 0, orphanDirsRemoved: 0 }

  const knownNoteIds = new Set(listNotes().map((n) => n.meta.noteId))
  let filesRemoved = 0
  let orphanDirsRemoved = 0

  let dirs: string[] = []
  try {
    dirs = readdirSync(ATTACHMENTS_DIR)
  } catch {
    return { notesScanned: 0, filesRemoved: 0, orphanDirsRemoved: 0 }
  }

  for (const noteIdDir of dirs) {
    const dirPath = join(ATTACHMENTS_DIR, noteIdDir)
    try {
      if (!statSync(dirPath).isDirectory()) continue
    } catch {
      continue
    }
    if (!knownNoteIds.has(noteIdDir)) {
      try {
        rmSync(dirPath, { recursive: true, force: true })
        orphanDirsRemoved++
      } catch {
        /* ignore */
      }
      continue
    }
    filesRemoved += sweepNoteAttachments(noteIdDir)
  }

  return { notesScanned: knownNoteIds.size, filesRemoved, orphanDirsRemoved }
}
