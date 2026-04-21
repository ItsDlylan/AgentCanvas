import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

interface Props {
  mode: 'create' | 'rename'
  initialName?: string
  query?: string
  onClose: () => void
  onSubmit: (name: string) => void
}

export function SaveLensViewModal({
  mode,
  initialName = '',
  query,
  onClose,
  onSubmit
}: Props): JSX.Element {
  const [name, setName] = useState(initialName)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const submit = (): void => {
    const trimmed = name.trim()
    if (!trimmed) return
    onSubmit(trimmed)
  }

  const title = mode === 'rename' ? 'Rename view' : 'Save Task Lens view'
  const cta = mode === 'rename' ? 'Rename' : 'Save'

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        zIndex: 20000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#1a1b1f',
          border: '1px solid #3a3b42',
          borderRadius: 8,
          padding: 20,
          width: 420,
          color: '#e6e7ea',
          fontFamily: 'system-ui, -apple-system, sans-serif'
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>{title}</div>
        <div
          style={{
            fontSize: 10,
            color: '#6b7280',
            marginTop: 4,
            marginBottom: 4,
            letterSpacing: 0.5
          }}
        >
          NAME
        </div>
        <input
          ref={inputRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
            else if (e.key === 'Escape') onClose()
          }}
          placeholder="e.g. Daily standup"
          style={{
            width: '100%',
            background: '#0f0f12',
            border: '1px solid #3a3b42',
            color: '#e6e7ea',
            padding: '8px 10px',
            borderRadius: 4,
            fontSize: 13,
            boxSizing: 'border-box',
            fontFamily: 'inherit'
          }}
        />
        {query !== undefined && (
          <>
            <div
              style={{
                fontSize: 10,
                color: '#6b7280',
                marginTop: 12,
                marginBottom: 4,
                letterSpacing: 0.5
              }}
            >
              QUERY
            </div>
            <div
              style={{
                padding: '8px 10px',
                background: '#0f0f12',
                border: '1px solid #3a3b42',
                borderRadius: 4,
                fontSize: 12,
                color: '#9ca3af',
                fontFamily: 'ui-monospace, monospace',
                minHeight: 20,
                wordBreak: 'break-word'
              }}
            >
              {query.trim() || <span style={{ fontStyle: 'italic' }}>(empty)</span>}
            </div>
          </>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
          <button
            onClick={onClose}
            style={{
              padding: '8px 14px',
              borderRadius: 4,
              border: '1px solid #3a3b42',
              background: 'transparent',
              color: '#e6e7ea',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!name.trim()}
            style={{
              padding: '8px 14px',
              borderRadius: 4,
              border: 'none',
              background: '#3b82f6',
              color: 'white',
              fontSize: 13,
              fontWeight: 600,
              cursor: !name.trim() ? 'not-allowed' : 'pointer',
              opacity: !name.trim() ? 0.6 : 1
            }}
          >
            {cta}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
