import { useEffect, useRef } from 'react'
import { EditorContent } from '@tiptap/react'
import type { JSONContent } from '@tiptap/core'
import { useAcceptanceEditor } from '@/hooks/useAcceptanceEditor'
import { useCanvasStore } from '@/store/canvas-store'

interface Props {
  taskId: string
  initialContent: Record<string, unknown>
  editable: boolean
  onChange: (json: JSONContent) => void
}

export function TaskTileAcceptanceEditor({
  taskId,
  initialContent,
  editable,
  onChange
}: Props): JSX.Element {
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const editor = useAcceptanceEditor({ editable, onChange })

  // Seed the editor once per taskId — the hook starts empty and this avoids
  // resetting content on every parent re-render. Re-seed only when the
  // component represents a different task.
  const seededForRef = useRef<string | null>(null)
  useEffect(() => {
    if (!editor) return
    if (seededForRef.current === taskId) return
    try {
      editor.commands.setContent(initialContent ?? { type: 'doc', content: [] })
    } catch {
      editor.commands.setContent({ type: 'doc', content: [] })
    }
    seededForRef.current = taskId
  }, [editor, taskId, initialContent])

  // Listen for spawn/navigate CustomEvents dispatched by LinkedTaskItem's NodeView.
  // The extension is tile-type-agnostic; we decide here what "linked note" means
  // in the task context — create a sibling note tile wired via a research-output
  // edge, and stamp the new note's id back onto the task item.
  useEffect(() => {
    const el = bodyRef.current
    if (!el || !editor) return

    const handleSpawn = (e: Event) => {
      const { taskId: taskItemId, taskText } = (e as CustomEvent).detail
      if (!taskItemId) return
      useCanvasStore
        .getState()
        .spawnLinkedNoteFromTask(taskId, taskItemId, taskText, (newNoteId: string) => {
          const { state } = editor
          const { tr } = state
          let set = false
          state.doc.descendants((node, pos) => {
            if (set) return false
            if (node.type.name === 'taskItem' && node.attrs.taskId === taskItemId) {
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, linkedNoteId: newNoteId })
              set = true
              return false
            }
          })
          if (set) editor.view.dispatch(tr)
        })
    }

    const handleNavigate = (e: Event) => {
      const { linkedNoteId } = (e as CustomEvent).detail
      if (linkedNoteId) useCanvasStore.getState().focusNoteOnCanvas(linkedNoteId)
    }

    el.addEventListener('task:spawn-note', handleSpawn)
    el.addEventListener('task:navigate-note', handleNavigate)
    return () => {
      el.removeEventListener('task:spawn-note', handleSpawn)
      el.removeEventListener('task:navigate-note', handleNavigate)
    }
  }, [editor, taskId])

  // When a linked note is removed elsewhere, clear stale linkedNoteId refs.
  useEffect(() => {
    if (!editor) return
    const handler = (e: Event) => {
      const { noteId: removedId } = (e as CustomEvent).detail
      if (!removedId || editor.isDestroyed) return
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

  return (
    <div
      ref={bodyRef}
      className="notes-tile-body titlebar-no-drag nokey"
      onKeyDown={(e) => e.stopPropagation()}
    >
      <EditorContent editor={editor} />
    </div>
  )
}
