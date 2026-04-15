// ── Voice Notes ──────────────────────────────────────────
// Handles voice annotations, dictation mode, and standup notes.
// Creates and appends to NotesTiles via the note API.

import { useCanvasStore } from '@/store/canvas-store'

// ── TipTap JSON helpers ──────────────────────────────────

function textDoc(lines: string[]): Record<string, unknown> {
  return {
    type: 'doc',
    content: lines.map((line) => ({
      type: 'paragraph',
      content: line ? [{ type: 'text', text: line }] : []
    }))
  }
}

function timestamp(): string {
  return new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

// ── Voice Annotation ─────────────────────────────────────

/**
 * Create a new note tile with a single voice annotation.
 * Optionally linked to the focused terminal.
 */
export function createVoiceAnnotation(text: string, linkedTileId?: string | null): string {
  const store = useCanvasStore.getState()
  const sourceLabel = linkedTileId
    ? getLabelForTile(linkedTileId) ?? 'Terminal'
    : null

  // Spawn the note tile
  store.addNoteAt()
  const noteId = store.focusedId
  if (!noteId) return ''

  // Build label and content
  const label = sourceLabel ? `Note — ${sourceLabel}` : 'Voice Note'
  const lines = [
    `[${timestamp()}]${sourceLabel ? ` (from ${sourceLabel})` : ''}`,
    text
  ]

  store.renameTile(noteId, label)
  window.note.save(noteId, { label }, textDoc(lines))

  return noteId
}

// ── Dictation ────────────────────────────────────────────

/**
 * Append a timestamped entry to an existing dictation note.
 */
export async function appendToDictation(noteId: string, text: string): Promise<void> {
  const noteFile = await window.note.load(noteId)
  if (!noteFile) return

  const existing = noteFile.content as { type: string; content?: unknown[] } | null
  const newParagraphs = [
    {
      type: 'paragraph',
      content: [
        { type: 'text', marks: [{ type: 'bold' }], text: `[${timestamp()}] ` },
        { type: 'text', text }
      ]
    }
  ]

  let content: Record<string, unknown>
  if (existing?.content && Array.isArray(existing.content)) {
    content = { ...existing, content: [...existing.content, ...newParagraphs] }
  } else {
    content = { type: 'doc', content: newParagraphs }
  }

  window.note.save(noteId, { updatedAt: Date.now() }, content)
}

/**
 * Create a new note for dictation mode.
 * Returns the noteId.
 */
export function createDictationNote(): string {
  const store = useCanvasStore.getState()
  store.addNoteAt()
  const noteId = store.focusedId
  if (!noteId) return ''

  const label = 'Dictation'
  store.renameTile(noteId, label)
  window.note.save(noteId, { label }, textDoc([`Dictation started at ${timestamp()}`, '']))

  return noteId
}

// ── Standup ──────────────────────────────────────────────

/**
 * Create a standup note with today's date.
 * Returns the noteId.
 */
export function createStandupNote(): string {
  const store = useCanvasStore.getState()
  store.addNoteAt()
  const noteId = store.focusedId
  if (!noteId) return ''

  const date = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const label = `Standup — ${date}`
  store.renameTile(noteId, label)
  window.note.save(noteId, { label }, textDoc([`Standup — ${date}`, `Started at ${timestamp()}`, '']))

  return noteId
}

// ── Helpers ──────────────────────────────────────────────

function getLabelForTile(sessionId: string): string | null {
  const store = useCanvasStore.getState()
  const node = store.allNodes.find(
    (n) => (n.data as Record<string, unknown>).sessionId === sessionId
  )
  return node ? ((node.data as Record<string, unknown>).label as string) ?? null : null
}
