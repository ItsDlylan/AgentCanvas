import { useEffect, useRef } from 'react'
import { useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Placeholder from '@tiptap/extension-placeholder'
import { Fragment, Slice } from '@tiptap/pm/model'
import type { Editor } from '@tiptap/react'
import type { JSONContent } from '@tiptap/core'

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
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: 'Type or paste...  # ## - [ ] for formatting' })
    ],
    content: '',
    editorProps: {
      attributes: {
        class: 'outline-none min-h-full'
      },
      handlePaste(view, event) {
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
        editor.commands.setContent(noteFile.content)
      }
    })
  }, [editor, noteId])

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
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
        if (!editor.isDestroyed) {
          window.note.save(noteIdRef.current, {}, editor.getJSON())
        }
      }
    }
  }, [editor])

  return { editor }
}
