import { useState, useRef, useCallback, useEffect } from 'react'

interface EditableLabelProps {
  label: string
  onRename: (newLabel: string) => void
  className?: string
}

export function EditableLabel({ label, onRename, className }: EditableLabelProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(label)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  // Sync draft when label changes externally while not editing
  useEffect(() => {
    if (!editing) setDraft(label)
  }, [label, editing])

  const commit = useCallback(() => {
    setEditing(false)
    const trimmed = draft.trim()
    if (trimmed && trimmed !== label) {
      onRename(trimmed)
    } else {
      setDraft(label)
    }
  }, [draft, label, onRename])

  const cancel = useCallback(() => {
    setEditing(false)
    setDraft(label)
  }, [label])

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          else if (e.key === 'Escape') cancel()
          e.stopPropagation()
        }}
        className={`titlebar-no-drag bg-transparent outline-none border-b border-blue-500/50 ${className ?? ''}`}
        maxLength={50}
      />
    )
  }

  return (
    <span
      className={`truncate cursor-default ${className ?? ''}`}
      onDoubleClick={() => setEditing(true)}
      title="Double-click to rename"
    >
      {label}
    </span>
  )
}
