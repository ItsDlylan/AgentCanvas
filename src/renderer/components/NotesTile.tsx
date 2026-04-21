import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NodeProps, Handle, Position, NodeResizer } from '@xyflow/react'
import { EditorContent } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import type { JSONContent } from '@tiptap/core'
import { useNotes } from '@/hooks/useNotes'
import { useFocusedTerminal } from '@/hooks/useFocusedTerminal'
import { usePomodoroContext } from '@/hooks/usePomodoro'
import { useIsPanning, isPanningNow } from '@/hooks/usePanState'
import { registerRender } from '@/hooks/usePerformanceDebug'
import { EditableLabel } from './EditableLabel'

function getChecklistInfo(editor: Editor | null): { isChecklist: boolean; checked: number; total: number } {
  if (!editor) return { isChecklist: false, checked: 0, total: 0 }
  const json = editor.getJSON()
  const nodes = (json.content ?? []) as JSONContent[]
  let hasTaskList = false
  let checked = 0
  let total = 0
  for (const node of nodes) {
    if (node.type === 'taskList') {
      hasTaskList = true
      for (const item of node.content ?? []) {
        if (item.type === 'taskItem') {
          total++
          if (item.attrs?.checked) checked++
        }
      }
    } else if (node.type === 'paragraph') {
      // Allow empty paragraphs (TipTap always adds a trailing one)
      const text = (node.content ?? []).map((c) => c.text ?? '').join('')
      if (text.trim()) return { isChecklist: false, checked: 0, total: 0 }
    } else {
      return { isChecklist: false, checked: 0, total: 0 }
    }
  }
  return { isChecklist: hasTaskList, checked, total }
}

function getTaskItems(editor: Editor | null): Array<{ text: string; checked: boolean }> {
  if (!editor) return []
  const json = editor.getJSON()
  const tasks: Array<{ text: string; checked: boolean }> = []
  for (const node of (json.content ?? []) as JSONContent[]) {
    if (node.type === 'taskList') {
      for (const item of node.content ?? []) {
        if (item.type === 'taskItem') {
          const text = (item.content ?? [])
            .flatMap((p) => p.content ?? [])
            .filter((n) => n.type === 'text')
            .map((n) => n.text ?? '')
            .join('')
          if (text.trim()) {
            tasks.push({ text: text.trim(), checked: !!item.attrs?.checked })
          }
        }
      }
    }
  }
  return tasks
}

export interface NotesNodeData {
  sessionId: string
  label: string
  linkedTerminalId?: string
  linkedNoteId?: string
  onClose?: (sessionId: string) => void
  onDelete?: (sessionId: string) => void
  onSpawnLinkedNote?: (
    sourceNoteId: string,
    taskId: string,
    taskText: string,
    onCreated: (newNoteId: string) => void
  ) => void
  onNavigateToNote?: (noteId: string) => void
}

function NotesTileComponent({ data, width, height }: NodeProps) {
  registerRender('NotesTile')
  const { sessionId, label, onClose, onDelete, onSpawnLinkedNote, onNavigateToNote } = data as unknown as NotesNodeData
  const { focusedId, setFocusedId, killHighlight, renameTile } = useFocusedTerminal()
  const { addTask: addPomodoroTask, tasks: pomodoroTasks } = usePomodoroContext()
  const isPanning = useIsPanning()
  const isFocused = focusedId === sessionId
  const bodyElRef = useRef<HTMLDivElement | null>(null)
  const [isResizing, setIsResizing] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const [showToolbar, setShowToolbar] = useState(false)
  const [contentVersion, setContentVersion] = useState(0)
  const [pomodoroPickerOpen, setPomodoroPickerOpen] = useState(false)
  const pomodoroPickerRef = useRef<HTMLDivElement>(null)

  const { editor } = useNotes({ noteId: sessionId })

  // Track content changes for checklist detection
  useEffect(() => {
    if (!editor) return
    const handler = () => setContentVersion((v) => v + 1)
    editor.on('update', handler)
    return () => { editor.off('update', handler) }
  }, [editor])

  const checklistInfo = useMemo(
    () => getChecklistInfo(editor),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, contentVersion]
  )

  const noteTaskItems = useMemo(
    () => getTaskItems(editor),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, contentVersion]
  )

  const uncheckedTasks = useMemo(
    () => noteTaskItems.filter((t) => !t.checked),
    [noteTaskItems]
  )

  // Track which tasks are already in Pomodoro (by text match)
  const pomodoroTaskTexts = useMemo(
    () => new Set(pomodoroTasks.map((t) => t.text)),
    [pomodoroTasks]
  )

  // Close picker on click outside
  useEffect(() => {
    if (!pomodoroPickerOpen) return
    const handler = (e: MouseEvent) => {
      if (pomodoroPickerRef.current && !pomodoroPickerRef.current.contains(e.target as HTMLElement)) {
        setPomodoroPickerOpen(false)
      }
    }
    const timer = setTimeout(() => document.addEventListener('mousedown', handler), 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handler)
    }
  }, [pomodoroPickerOpen])

  const handleFocus = useCallback(() => {
    setFocusedId(sessionId)
  }, [setFocusedId, sessionId])

  const onResizeStart = useCallback(() => setIsResizing(true), [])
  const onResizeEnd = useCallback(() => setIsResizing(false), [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    setIsDragOver(false)
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    e.stopPropagation()
    if (!editor) return

    const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp']
    const VIDEO_EXTS = ['.mp4', '.webm', '.mov', '.avi', '.mkv']
    const files = Array.from(e.dataTransfer.files)
    for (const file of files) {
      const filePath = window.fileUtils.getPathForFile(file)
      if (!filePath) continue
      const lower = filePath.toLowerCase()
      const isImage = file.type.startsWith('image/') || IMAGE_EXTS.some((ext) => lower.endsWith(ext))
      const isVideo = file.type.startsWith('video/') || VIDEO_EXTS.some((ext) => lower.endsWith(ext))
      if (!isImage && !isVideo) continue
      window.attachment.saveFromPath(sessionId, filePath).then((url) => {
        if (!url) return
        if (isImage) editor.chain().focus().setImage({ src: url }).run()
        else editor.chain().focus().setVideo({ src: url, type: 'local' }).run()
      })
    }
  }, [editor, sessionId])

  // Prevent canvas pan when scrolling inside note body
  useEffect(() => {
    const el = bodyElRef.current
    if (!el || !isFocused) return
    const handler = (e: WheelEvent) => {
      if (!e.ctrlKey) e.stopPropagation()
    }
    el.addEventListener('wheel', handler)
    return () => el.removeEventListener('wheel', handler)
  }, [isFocused])

  // Listen for task:spawn-note and task:navigate-note CustomEvents from LinkedTaskItem NodeView
  useEffect(() => {
    const el = bodyElRef.current
    if (!el || !editor) return

    const handleSpawn = (e: Event) => {
      const { taskId, taskText } = (e as CustomEvent).detail
      if (!taskId || !onSpawnLinkedNote) return

      // taskId was already assigned by the NodeView via getPos() — just spawn the note
      onSpawnLinkedNote(sessionId, taskId, taskText, (newNoteId: string) => {
        // Set linkedNoteId on the task item via editor transaction
        const { state } = editor
        const { tr } = state
        let set = false
        state.doc.descendants((node, pos) => {
          if (set) return false
          if (node.type.name === 'taskItem' && node.attrs.taskId === taskId) {
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
      if (linkedNoteId && onNavigateToNote) onNavigateToNote(linkedNoteId)
    }

    el.addEventListener('task:spawn-note', handleSpawn)
    el.addEventListener('task:navigate-note', handleNavigate)
    return () => {
      el.removeEventListener('task:spawn-note', handleSpawn)
      el.removeEventListener('task:navigate-note', handleNavigate)
    }
  }, [editor, sessionId, onSpawnLinkedNote, onNavigateToNote])

  return (
    <div
      className={`notes-tile ${
        isFocused && killHighlight
          ? 'ring-1 ring-red-500/80 shadow-[0_0_25px_rgba(239,68,68,0.3)] animate-pulse'
          : isFocused
            ? 'ring-1 ring-blue-500/60 shadow-[0_0_20px_rgba(59,130,246,0.15)]'
            : ''
      }`}
      style={{ width: '100%', height: '100%', pointerEvents: isPanning ? 'none' : 'auto' }}
      onMouseDown={handleFocus}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <NodeResizer
        minWidth={300}
        minHeight={200}
        isVisible={isFocused}
        color="#3b82f6"
        onResizeStart={onResizeStart}
        onResizeEnd={onResizeEnd}
      />

      {/* Dimension overlay during resize */}
      {isResizing && width != null && height != null && (
        <div className="absolute inset-0 z-50 flex items-center justify-center pointer-events-none">
          <span className="rounded bg-black/80 px-2 py-1 text-xs font-mono text-zinc-300">
            {Math.round(width)} x {Math.round(height)}
          </span>
        </div>
      )}

      {/* Header */}
      <div className={`notes-tile-header ${isFocused ? 'border-b-blue-500/30' : ''}`} style={{ position: 'relative' }}>
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 shrink-0 rounded-full ${isFocused ? 'bg-blue-400' : 'bg-zinc-500'}`} />
          <EditableLabel
            label={label}
            onRename={(newLabel) => renameTile(sessionId, newLabel)}
            className={`text-xs font-medium ${isFocused ? 'text-zinc-200' : 'text-zinc-400'}`}
          />
          {checklistInfo.isChecklist ? (
            <span className="flex items-center gap-1">
              <span className="text-[10px] text-blue-400/70">Checklist</span>
              <span className="text-[10px] text-zinc-600">{checklistInfo.checked}/{checklistInfo.total}</span>
            </span>
          ) : (
            <span className="text-[10px] text-zinc-500">Note</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* Export as markdown */}
          <button
            className="titlebar-no-drag rounded px-1.5 py-0.5 text-xs text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300"
            onClick={() => window.note.export(sessionId, 'markdown')}
            title="Export as markdown"
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          </button>
          {/* Soft close — remove from canvas, keep file */}
          <button
            className="titlebar-no-drag rounded px-1.5 py-0.5 text-xs text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300"
            onClick={() => onClose?.(sessionId)}
            title="Close (keep file)"
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          {/* Hard delete — remove from canvas AND delete file */}
          <button
            className="titlebar-no-drag rounded px-1.5 py-0.5 text-xs text-zinc-500 hover:bg-zinc-700 hover:text-red-400"
            onClick={() => onDelete?.(sessionId)}
            title="Delete permanently"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
        {/* Progress bar for checklists */}
        {checklistInfo.isChecklist && checklistInfo.total > 0 && (
          <div
            className="absolute bottom-0 left-0 right-0 h-[3px] bg-zinc-800"
          >
            <div
              className="h-full rounded-r-full bg-blue-500"
              style={{ width: `${(checklistInfo.checked / checklistInfo.total) * 100}%` }}
            />
          </div>
        )}
      </div>

      {/* Editor area with hover-reveal toolbar */}
      <div
        className="flex flex-1 flex-col min-h-0"
        onMouseEnter={() => setShowToolbar(true)}
        onMouseLeave={() => setShowToolbar(false)}
      >
        {editor && showToolbar && (
          <div className="notes-tile-toolbar titlebar-no-drag">
            <ToolbarButton
              active={editor.isActive('bold')}
              onClick={() => editor.chain().focus().toggleBold().run()}
              title="Bold"
            >
              B
            </ToolbarButton>
            <ToolbarButton
              active={editor.isActive('italic')}
              onClick={() => editor.chain().focus().toggleItalic().run()}
              title="Italic"
            >
              <span className="italic">I</span>
            </ToolbarButton>
            <ToolbarButton
              active={editor.isActive('heading', { level: 1 })}
              onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
              title="Heading 1"
            >
              H1
            </ToolbarButton>
            <ToolbarButton
              active={editor.isActive('heading', { level: 2 })}
              onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
              title="Heading 2"
            >
              H2
            </ToolbarButton>
            <span className="mx-1 h-4 w-px bg-zinc-700" />
            <ToolbarButton
              active={editor.isActive('bulletList')}
              onClick={() => editor.chain().focus().toggleBulletList().run()}
              title="Bullet List"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
              </svg>
            </ToolbarButton>
            <ToolbarButton
              active={editor.isActive('taskList')}
              onClick={() => editor.chain().focus().toggleTaskList().run()}
              title="Task List"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
            </ToolbarButton>
            <span className="mx-1 h-4 w-px bg-zinc-700" />
            <ToolbarButton
              active={false}
              onClick={() => {
                window.attachment.pickFile().then((paths) => {
                  if (!paths || !editor) return
                  for (const filePath of paths) {
                    const lower = filePath.toLowerCase()
                    const isImage = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'].some((ext) => lower.endsWith(ext))
                    const isVideo = ['.mp4', '.webm', '.mov', '.avi', '.mkv'].some((ext) => lower.endsWith(ext))
                    if (isImage) {
                      window.attachment.saveFromPath(sessionId, filePath).then((url) => {
                        editor.chain().focus().setImage({ src: url }).run()
                      })
                    } else if (isVideo) {
                      window.attachment.saveFromPath(sessionId, filePath).then((url) => {
                        editor.chain().focus().setVideo({ src: url, type: 'local' }).run()
                      })
                    }
                  }
                })
              }}
              title="Insert image or video"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path d="m21 15-5-5L5 21" />
              </svg>
            </ToolbarButton>
            {uncheckedTasks.length > 0 && (
              <>
                <span className="mx-1 h-4 w-px bg-zinc-700" />
                <div className="relative" ref={pomodoroPickerRef}>
                  <ToolbarButton
                    active={pomodoroPickerOpen}
                    onClick={() => setPomodoroPickerOpen((o) => !o)}
                    title="Send tasks to Pomodoro"
                  >
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <circle cx="12" cy="13" r="8" />
                      <path strokeLinecap="round" d="M12 9v4l2 2" />
                      <path strokeLinecap="round" d="M12 5V3" />
                      <path strokeLinecap="round" d="M9.5 3.5l5-1" />
                    </svg>
                  </ToolbarButton>
                  {pomodoroPickerOpen && (
                    <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-md border border-zinc-700 bg-zinc-900 py-1 shadow-xl">
                      <div className="px-2 py-1 text-[10px] font-medium text-zinc-500">Add to Pomodoro</div>
                      <div className="max-h-40 overflow-y-auto">
                        {uncheckedTasks.map((task, i) => {
                          const alreadyAdded = pomodoroTaskTexts.has(task.text)
                          return (
                            <button
                              key={i}
                              className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs transition-colors ${
                                alreadyAdded
                                  ? 'text-zinc-600 cursor-default'
                                  : 'text-zinc-300 hover:bg-zinc-800'
                              }`}
                              onClick={() => {
                                if (!alreadyAdded) addPomodoroTask(task.text, { noteId: sessionId, noteLabel: label })
                              }}
                              disabled={alreadyAdded}
                            >
                              {alreadyAdded ? (
                                <svg className="h-3 w-3 shrink-0 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                                </svg>
                              ) : (
                                <svg className="h-3 w-3 shrink-0 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                                </svg>
                              )}
                              <span className="truncate">{task.text}</span>
                            </button>
                          )
                        })}
                      </div>
                      {uncheckedTasks.length > 1 && !uncheckedTasks.every((t) => pomodoroTaskTexts.has(t.text)) && (
                        <>
                          <div className="my-1 h-px bg-zinc-800" />
                          <button
                            className="flex w-full items-center gap-2 px-2 py-1.5 text-xs text-blue-400 hover:bg-zinc-800"
                            onClick={() => {
                              for (const task of uncheckedTasks) {
                                if (!pomodoroTaskTexts.has(task.text)) addPomodoroTask(task.text, { noteId: sessionId, noteLabel: label })
                              }
                              setPomodoroPickerOpen(false)
                            }}
                          >
                            Add all ({uncheckedTasks.filter((t) => !pomodoroTaskTexts.has(t.text)).length})
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        <div
          ref={bodyElRef}
          className="notes-tile-body titlebar-no-drag nokey"
          onKeyDown={(e) => e.stopPropagation()}
        >
          <EditorContent editor={editor} />
        </div>
      </div>

      {isDragOver && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center rounded-lg bg-zinc-900/90 border-2 border-dashed border-blue-500/60 pointer-events-none">
          <svg className="w-8 h-8 text-blue-400 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z" />
          </svg>
          <span className="text-xs text-blue-300 font-medium">Drop image to embed</span>
        </div>
      )}

      <Handle type="target" position={Position.Left} className="!bg-zinc-600" />
      <Handle type="source" position={Position.Right} className="!bg-zinc-600" />
    </div>
  )
}

function ToolbarButton({
  active,
  onClick,
  title,
  children
}: {
  active: boolean
  onClick: () => void
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`rounded px-1.5 py-0.5 text-xs font-medium transition-colors ${
        active
          ? 'bg-zinc-700 text-zinc-200'
          : 'text-zinc-500 hover:bg-zinc-700/50 hover:text-zinc-300'
      }`}
    >
      {children}
    </button>
  )
}

export const NotesTile = memo(NotesTileComponent)
