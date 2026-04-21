import { useEffect, useRef } from 'react'
import { useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import TaskList from '@tiptap/extension-task-list'
import Placeholder from '@tiptap/extension-placeholder'
import { LinkedTaskItem } from '@/extensions/LinkedTaskItem'
import type { Editor } from '@tiptap/react'
import type { JSONContent } from '@tiptap/core'

const SAVE_DEBOUNCE_MS = 400

export function useAcceptanceEditor(args: {
  editable: boolean
  onChange: (json: JSONContent) => void
}): Editor | null {
  const { editable, onChange } = args

  // Keep a stable ref to the latest onChange so `onUpdate` below can read it
  // without forcing editor recreation.
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const editor = useEditor({
    extensions: [
      StarterKit,
      TaskList,
      LinkedTaskItem.configure({ nested: true }),
      Placeholder.configure({
        placeholder: '- [ ] A measurable done condition'
      })
    ],
    editable,
    content: '',
    editorProps: {
      attributes: {
        class: 'outline-none min-h-full'
      }
    },
    onUpdate: ({ editor }) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null
        if (!editor.isDestroyed) onChangeRef.current(editor.getJSON())
      }, SAVE_DEBOUNCE_MS)
    }
  })

  // Sync `editable` into the editor when it changes.
  useEffect(() => {
    if (!editor) return
    if (editor.isEditable !== editable) editor.setEditable(editable)
  }, [editor, editable])

  // On unmount (or editor swap), flush any pending debounced save.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
        if (editor && !editor.isDestroyed) onChangeRef.current(editor.getJSON())
      }
    }
  }, [editor])

  return editor
}
