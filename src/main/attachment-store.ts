import { homedir } from 'os'
import { join, basename } from 'path'
import { mkdirSync, existsSync, copyFileSync, writeFileSync, readdirSync, rmSync } from 'fs'
import { v4 as uuid } from 'uuid'

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
