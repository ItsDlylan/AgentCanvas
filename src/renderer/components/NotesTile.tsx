import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { NodeProps, Handle, Position, NodeResizer } from '@xyflow/react'
import { EditorContent } from '@tiptap/react'
import { useNotes } from '@/hooks/useNotes'
import { useFocusedTerminal } from '@/hooks/useFocusedTerminal'
import { useIsPanning, isPanningNow } from '@/hooks/usePanState'
import { registerRender } from '@/hooks/usePerformanceDebug'

export interface NotesNodeData {
  sessionId: string
  label: string
  linkedTerminalId?: string
  onClose?: (sessionId: string) => void
  onDelete?: (sessionId: string) => void
}

function NotesTileComponent({ data, width, height }: NodeProps) {
  registerRender('NotesTile')
  const { sessionId, label, onClose, onDelete } = data as unknown as NotesNodeData
  const { focusedId, setFocusedId, killHighlight } = useFocusedTerminal()
  const isPanning = useIsPanning()
  const isFocused = focusedId === sessionId
  const bodyElRef = useRef<HTMLDivElement | null>(null)
  const [isResizing, setIsResizing] = useState(false)

  const { editor } = useNotes({ noteId: sessionId })

  const handleFocus = useCallback(() => {
    setFocusedId(sessionId)
  }, [setFocusedId, sessionId])

  const onResizeStart = useCallback(() => setIsResizing(true), [])
  const onResizeEnd = useCallback(() => setIsResizing(false), [])

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
      <div className={`notes-tile-header ${isFocused ? 'border-b-blue-500/30' : ''}`}>
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 shrink-0 rounded-full ${isFocused ? 'bg-blue-400' : 'bg-amber-400'}`} />
          <span className={`text-xs font-medium ${isFocused ? 'text-zinc-200' : 'text-zinc-400'}`}>
            {label}
          </span>
          <span className="text-[10px] text-amber-400/70">Note</span>
        </div>
        <div className="flex items-center gap-1">
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
      </div>

      {/* Toolbar */}
      {editor && (
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
        </div>
      )}

      {/* Editor body */}
      <div
        ref={bodyElRef}
        className="notes-tile-body titlebar-no-drag"
      >
        <EditorContent editor={editor} />
      </div>

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
