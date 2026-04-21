import { useEffect, useRef } from 'react'
import { useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import TaskList from '@tiptap/extension-task-list'
import { LinkedTaskItem } from '@/extensions/LinkedTaskItem'
import Placeholder from '@tiptap/extension-placeholder'
import { ResizableImage } from '@/extensions/ResizableImage'
import { VideoNode } from '@/extensions/VideoNode'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableHeader } from '@tiptap/extension-table-header'
import { TableCell } from '@tiptap/extension-table-cell'
import { Fragment, Slice } from '@tiptap/pm/model'
import type { Editor } from '@tiptap/react'
import type { JSONContent } from '@tiptap/core'

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml', 'image/bmp']

const SAVE_DEBOUNCE_MS = 500

/* ── Smart paste handling ── */

function looksLikeCode(lines: string[]): boolean {
  if (lines.length === 0) return false
  let signals = 0
  for (const line of lines) {
    if (/^\s{2,}/.test(line)) signals++
    if (/^[\$#>]/.test(line.trim())) signals++
    if (/[{}()\[\];]/.test(line)) signals++
    if (/^(\/|\.\/|\.\.\/)/.test(line.trim())) signals++
    if (/^\s*(POST|GET|PUT|DELETE|PATCH)\s/.test(line)) signals++
  }
  return signals / lines.length > 0.4
}

function processTerminalPaste(text: string): JSONContent[] {
  const blocks = text.split(/\n{2,}/)
  const result: JSONContent[] = []

  for (const block of blocks) {
    const trimmed = block.trim()
    if (!trimmed) continue

    const lines = trimmed.split('\n')

    if (looksLikeCode(lines)) {
      result.push({
        type: 'codeBlock',
        content: [{ type: 'text', text: trimmed }]
      })
    } else {
      const joined = lines.map((l) => l.trimEnd()).join(' ')
      result.push({
        type: 'paragraph',
        content: [{ type: 'text', text: joined }]
      })
    }
  }

  return result
}

/* ── Hook ── */

export function useNotes({ noteId }: { noteId: string }): { editor: Editor | null } {
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const noteIdRef = useRef(noteId)
  noteIdRef.current = noteId

  const editor = useEditor({
    extensions: [
      StarterKit,
      TaskList,
      LinkedTaskItem.configure({ nested: true }),
      ResizableImage.configure({ allowBase64: true }),
      VideoNode,
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      Placeholder.configure({ placeholder: 'Type or paste...  # ## - [ ] for formatting' })
    ],
    content: '',
    editorProps: {
      attributes: {
        class: 'outline-none min-h-full'
      },
      handlePaste(view, event) {
        // Check for image files in clipboard (screenshot paste)
        const clipFiles = event.clipboardData?.files
        if (clipFiles && clipFiles.length > 0) {
          const imageFiles = Array.from(clipFiles).filter((f) => IMAGE_TYPES.includes(f.type))
          if (imageFiles.length > 0) {
            event.preventDefault()
            for (const file of imageFiles) {
              const reader = new FileReader()
              reader.onload = () => {
                const buffer = reader.result as ArrayBuffer
                const ext = file.type.split('/')[1] || 'png'
                const filename = `paste-${Date.now()}.${ext}`
                window.attachment.save(noteIdRef.current, filename, buffer).then((url) => {
                  view.dispatch(
                    view.state.tr.replaceSelectionWith(
                      view.state.schema.nodes.image.create({ src: url })
                    )
                  )
                })
              }
              reader.readAsArrayBuffer(file)
            }
            return true
          }
        }

        const html = event.clipboardData?.getData('text/html')
        const text = event.clipboardData?.getData('text/plain')

        // Let TipTap handle HTML pastes normally
        if (html || !text) return false

        const content = processTerminalPaste(text)
        if (content.length === 0) return false

        const { schema, tr } = view.state
        const nodes = content
          .map((json) => {
            try {
              return schema.nodeFromJSON(json)
            } catch {
              return null
            }
          })
          .filter((n): n is NonNullable<typeof n> => n !== null)

        if (nodes.length === 0) return false

        view.dispatch(tr.replaceSelection(new Slice(Fragment.from(nodes), 0, 0)))
        return true
      }
    }
  })

  // Load persisted content on mount
  useEffect(() => {
    if (!editor) return
    window.note.load(noteId).then((noteFile) => {
      if (noteFile?.content && editor && !editor.isDestroyed) {
        try {
          editor.commands.setContent(noteFile.content)
        } catch (err) {
          console.error('[useNotes] setContent (load) failed', err)
          editor.commands.setContent('')
        }
      }
    })
  }, [editor, noteId])

  // Refresh content when Pomodoro syncs a task check back to this note
  useEffect(() => {
    if (!editor) return
    const handler = (e: Event) => {
      const { noteId: updatedId } = (e as CustomEvent).detail
      if (updatedId === noteIdRef.current && !editor.isDestroyed) {
        window.note.load(noteIdRef.current).then((noteFile) => {
          if (noteFile?.content && !editor.isDestroyed) {
            try {
              editor.commands.setContent(noteFile.content)
            } catch (err) {
              console.error('[useNotes] setContent (pomodoro) failed', err)
              editor.commands.setContent('')
            }
          }
        })
      }
    }
    window.addEventListener('pomodoro:note-updated', handler)
    return () => window.removeEventListener('pomodoro:note-updated', handler)
  }, [editor])

  // Refresh content when updated via API (POST /api/note/update)
  useEffect(() => {
    if (!editor) return
    const handler = (e: Event) => {
      const { noteId: updatedId } = (e as CustomEvent).detail
      if (updatedId === noteIdRef.current && !editor.isDestroyed) {
        window.note.load(noteIdRef.current).then((noteFile) => {
          if (noteFile?.content && !editor.isDestroyed) {
            try {
              editor.commands.setContent(noteFile.content)
            } catch (err) {
              console.error('[useNotes] setContent (api) failed', err)
              editor.commands.setContent('')
            }
          }
        })
      }
    }
    window.addEventListener('api:note-updated', handler)
    return () => window.removeEventListener('api:note-updated', handler)
  }, [editor])

  // When a linked note is removed, clear stale linkedNoteId attributes
  useEffect(() => {
    if (!editor) return
    const handler = (e: Event) => {
      const { noteId: removedId } = (e as CustomEvent).detail
      if (!removedId || editor.isDestroyed) return
      // Walk the doc and clear any taskItem linkedNoteId pointing to the removed note
      const { doc, tr } = editor.state
      let modified = false
      doc.descendants((node, pos) => {
        if (node.type.name === 'taskItem' && node.attrs.linkedNoteId === removedId) {
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, linkedNoteId: null })
          modified = true
        }
      })
      if (modified) editor.view.dispatch(tr)
    }
    window.addEventListener('note:removed', handler)
    return () => window.removeEventListener('note:removed', handler)
  }, [editor])

  // Auto-save content on changes (metadata is saved separately by Canvas)
  useEffect(() => {
    if (!editor) return

    const handler = () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null
        if (!editor.isDestroyed) {
          window.note.save(noteIdRef.current, {}, editor.getJSON())
        }
      }, SAVE_DEBOUNCE_MS)
    }

    editor.on('update', handler)
    return () => {
      editor.off('update', handler)
      const id = noteIdRef.current
      const pendingSave = saveTimerRef.current !== null
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
      if (editor.isDestroyed) return
      const finalSave = pendingSave
        ? window.note.save(id, {}, editor.getJSON())
        : Promise.resolve()
      // GC orphan attachments (images deleted from the note) once the final save lands.
      finalSave.then(() => window.attachment.sweepNote(id))
    }
  }, [editor])

  return { editor }
}
