import { useEffect, useState } from 'react'
import type { TaskClassification, TaskTimeline } from '../../preload/index'

const CLASSIFICATION_OPTIONS: Array<{ value: TaskClassification; label: string }> = [
  { value: 'QUICK', label: 'Quick' },
  { value: 'NEEDS_RESEARCH', label: 'Needs Research' },
  { value: 'DEEP_FOCUS', label: 'Deep Focus' },
  { value: 'BENCHMARK', label: 'Benchmark' }
]

const TIMELINE_OPTIONS: Array<{ value: TaskTimeline; label: string }> = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'this-week', label: 'This week' },
  { value: 'this-month', label: 'This month' },
  { value: 'whenever', label: 'Whenever' }
]

interface Props {
  noteId: string
  onClose: () => void
}

export function ConvertNoteToTaskModal({ noteId, onClose }: Props): JSX.Element {
  const [classification, setClassification] = useState<TaskClassification | null>(null)
  const [timeline, setTimeline] = useState<TaskTimeline>('whenever')
  const [rationale, setRationale] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [preview, setPreview] = useState<string>('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const note = await window.note.load(noteId)
      if (cancelled || !note) return
      const markdown = tiptapToText(note.content)
      setPreview(markdown.slice(0, 500))
      try {
        const res = await window.task.classify(markdown, '')
        if (!cancelled && res.ok && res.result) {
          setClassification(res.result.classification)
          setRationale(res.result.rationale ?? '')
        }
      } catch {
        // ignore; user will pick manually
      }
      if (!cancelled) setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [noteId])

  const submit = async (): Promise<void> => {
    if (!classification) return
    setSubmitting(true)
    try {
      await window.task.convertFromNote(noteId, classification, timeline)
      onClose()
    } finally {
      setSubmitting(false)
    }
  }

  return (
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
          minWidth: 420,
          maxWidth: 560,
          color: '#e6e7ea',
          fontFamily: 'system-ui, -apple-system, sans-serif'
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Convert note to task</div>
        {loading ? (
          <div style={{ padding: '20px 0', color: '#9ca3af' }}>Classifying…</div>
        ) : (
          <>
            <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>PREVIEW</div>
            <div
              style={{
                background: '#0f0f12',
                border: '1px solid #2a2b32',
                borderRadius: 4,
                padding: 8,
                maxHeight: 140,
                overflow: 'auto',
                fontSize: 12,
                color: '#c5c6cc',
                whiteSpace: 'pre-wrap',
                marginBottom: 12
              }}
            >
              {preview || '(empty)'}
            </div>
            <label style={{ fontSize: 11, color: '#6b7280', display: 'block', marginBottom: 4 }}>
              CLASSIFICATION {rationale && <span style={{ color: '#9ca3af' }}>— {rationale}</span>}
            </label>
            <select
              value={classification ?? ''}
              onChange={(e) => setClassification(e.target.value as TaskClassification)}
              style={selectStyle}
            >
              <option value="" disabled>
                Pick a classification…
              </option>
              {CLASSIFICATION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>

            <label style={{ fontSize: 11, color: '#6b7280', display: 'block', marginTop: 12, marginBottom: 4 }}>
              TIMELINE PRESSURE
            </label>
            <select
              value={timeline}
              onChange={(e) => setTimeline(e.target.value as TaskTimeline)}
              style={selectStyle}
            >
              {TIMELINE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
              <button onClick={onClose} style={buttonStyle(false)}>
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={!classification || submitting}
                style={buttonStyle(true, !classification || submitting)}
              >
                {submitting ? 'Converting…' : 'Convert'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

const selectStyle: React.CSSProperties = {
  width: '100%',
  background: '#0f0f12',
  border: '1px solid #3a3b42',
  color: '#e6e7ea',
  padding: '8px 10px',
  borderRadius: 4,
  fontSize: 13
}

function buttonStyle(primary: boolean, disabled = false): React.CSSProperties {
  return {
    padding: '8px 14px',
    borderRadius: 4,
    border: primary ? 'none' : '1px solid #3a3b42',
    background: primary ? '#3b82f6' : 'transparent',
    color: primary ? 'white' : '#e6e7ea',
    fontSize: 13,
    fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1
  }
}

function tiptapToText(doc: Record<string, unknown>): string {
  try {
    const out: string[] = []
    const walk = (node: Record<string, unknown>): void => {
      const t = node.type as string | undefined
      const text = node.text as string | undefined
      if (text) {
        out.push(text)
        return
      }
      const content = (node.content as Array<Record<string, unknown>>) ?? []
      for (const c of content) walk(c)
      if (t === 'paragraph' || t === 'heading' || t === 'listItem' || t === 'taskItem') out.push('\n')
    }
    walk(doc)
    return out.join('').trim()
  } catch {
    return ''
  }
}
