import { useEffect, useRef } from 'react'
import { useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Placeholder from '@tiptap/extension-placeholder'
import type { Editor } from '@tiptap/react'

const SAVE_DEBOUNCE_MS = 500

export function useNotes({ noteId }: { noteId: string }): { editor: Editor | null } {
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const noteIdRef = useRef(noteId)
  noteIdRef.current = noteId

  const editor = useEditor({
    extensions: [
      StarterKit,
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: 'Start typing...' })
    ],
    content: '',
    editorProps: {
      attributes: {
        class: 'outline-none min-h-full'
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
      // Flush pending save on unmount
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
