import { useEffect, useState } from 'react'
import type { TaskClassification, TaskTimeline, TaskReviewProposal } from '../../preload/index'

const CLASSIFICATION_OPTIONS: TaskClassification[] = [
  'QUICK',
  'NEEDS_RESEARCH',
  'DEEP_FOCUS',
  'BENCHMARK'
]

const TIMELINE_OPTIONS: TaskTimeline[] = ['urgent', 'this-week', 'this-month', 'whenever']

type RowAction = 'convert' | 'skip'

interface Row {
  proposal: TaskReviewProposal
  classification: TaskClassification
  timeline: TaskTimeline
  action: RowAction
}

interface Props {
  onClose: () => void
  onComplete: (convertedCount: number) => void
}

export function ReviewAllNotesModal({ onClose, onComplete }: Props): JSX.Element {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    window.task.reviewAll().then((res) => {
      if (cancelled) return
      if (!res.ok) {
        setRows([])
        return
      }
      setRows(
        res.proposals.map((p) => ({
          proposal: p,
          classification: p.proposedClassification,
          timeline: 'whenever' as TaskTimeline,
          action: 'convert' as RowAction
        }))
      )
    })
    return () => {
      cancelled = true
    }
  }, [])

  const applyAll = async (): Promise<void> => {
    if (!rows) return
    setSubmitting(true)
    const toConvert = rows.filter((r) => r.action === 'convert')
    setProgress({ done: 0, total: toConvert.length })
    let converted = 0
    for (const r of toConvert) {
      try {
        const res = await window.task.convertFromNote(
          r.proposal.noteId,
          r.classification,
          r.timeline
        )
        if (res.ok) converted++
      } catch {
        // skip individual failures
      }
      setProgress({ done: ++converted === toConvert.length ? toConvert.length : converted, total: toConvert.length })
    }
    setSubmitting(false)
    onComplete(converted)
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.7)',
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
          width: 720,
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          color: '#e6e7ea',
          fontFamily: 'system-ui, -apple-system, sans-serif'
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Review all notes</div>
        <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 16 }}>
          Classifier suggestions. Override class/timeline per row, skip what shouldn't convert, then Apply.
        </div>

        {rows === null ? (
          <div style={{ padding: 20, color: '#9ca3af' }}>Classifying all notes…</div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 20, color: '#9ca3af' }}>No notes to review.</div>
        ) : (
          <>
            <div
              style={{
                flex: 1,
                overflow: 'auto',
                border: '1px solid #2a2b32',
                borderRadius: 4,
                marginBottom: 16
              }}
            >
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead style={{ background: '#15161a', position: 'sticky', top: 0 }}>
                  <tr>
                    <th style={thStyle}>Note</th>
                    <th style={thStyle}>Classification</th>
                    <th style={thStyle}>Timeline</th>
                    <th style={thStyle}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.proposal.noteId} style={{ borderTop: '1px solid #2a2b32' }}>
                      <td style={tdStyle}>
                        <div
                          style={{
                            fontWeight: 500,
                            color: r.action === 'skip' ? '#6b7280' : '#e6e7ea',
                            textDecoration: r.action === 'skip' ? 'line-through' : 'none'
                          }}
                        >
                          {r.proposal.label || '(Untitled)'}
                        </div>
                        <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2 }}>
                          {r.proposal.confidence === 'low' ? 'Classifier confidence: low' : ''}
                        </div>
                      </td>
                      <td style={tdStyle}>
                        <select
                          value={r.classification}
                          disabled={r.action === 'skip'}
                          onChange={(e) => {
                            const next = [...rows]
                            next[i] = { ...r, classification: e.target.value as TaskClassification }
                            setRows(next)
                          }}
                          style={selectStyle}
                        >
                          {CLASSIFICATION_OPTIONS.map((c) => (
                            <option key={c} value={c}>
                              {c.replace('_', ' ')}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td style={tdStyle}>
                        <select
                          value={r.timeline}
                          disabled={r.action === 'skip'}
                          onChange={(e) => {
                            const next = [...rows]
                            next[i] = { ...r, timeline: e.target.value as TaskTimeline }
                            setRows(next)
                          }}
                          style={selectStyle}
                        >
                          {TIMELINE_OPTIONS.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td style={tdStyle}>
                        <button
                          onClick={() => {
                            const next = [...rows]
                            next[i] = {
                              ...r,
                              action: r.action === 'convert' ? 'skip' : 'convert'
                            }
                            setRows(next)
                          }}
                          style={{
                            padding: '4px 10px',
                            borderRadius: 4,
                            border: '1px solid #3a3b42',
                            background: r.action === 'convert' ? '#3b82f6' : 'transparent',
                            color: r.action === 'convert' ? 'white' : '#9ca3af',
                            fontSize: 11,
                            cursor: 'pointer'
                          }}
                        >
                          {r.action === 'convert' ? 'Convert' : 'Skip'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {progress && (
              <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 8 }}>
                Converting {progress.done}/{progress.total}…
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={onClose} style={buttonStyle(false)}>
                Cancel
              </button>
              <button
                onClick={applyAll}
                disabled={submitting || rows.every((r) => r.action === 'skip')}
                style={buttonStyle(true, submitting)}
              >
                {submitting ? 'Applying…' : `Apply (${rows.filter((r) => r.action === 'convert').length})`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 10px',
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  color: '#6b7280',
  fontWeight: 500
}

const tdStyle: React.CSSProperties = {
  padding: '8px 10px',
  verticalAlign: 'middle'
}

const selectStyle: React.CSSProperties = {
  width: '100%',
  background: '#0f0f12',
  border: '1px solid #3a3b42',
  color: '#e6e7ea',
  padding: '4px 6px',
  borderRadius: 4,
  fontSize: 12
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
