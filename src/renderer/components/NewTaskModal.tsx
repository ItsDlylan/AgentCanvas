import { useState } from 'react'
import type { TaskClassification, TaskTimeline } from '../../preload/index'
import { useCanvasStore } from '@/store/canvas-store'
import { TaskSuggestModal, type Proposal } from './TaskSuggestModal'

const CLASSIFICATION_OPTIONS: Array<{ value: TaskClassification; label: string }> = [
  { value: 'QUICK', label: 'Quick' },
  { value: 'NEEDS_RESEARCH', label: 'Needs Research' },
  { value: 'DEEP_FOCUS', label: 'Deep Focus' },
  { value: 'BENCHMARK', label: 'Benchmark' }
]

const TIMELINE_OPTIONS: TaskTimeline[] = ['urgent', 'this-week', 'this-month', 'whenever']

interface Props {
  onClose: () => void
  onCreated: (taskId: string) => void
}

export function NewTaskModal({ onClose, onCreated }: Props): JSX.Element {
  const [label, setLabel] = useState('')
  const [intent, setIntent] = useState('')
  const [acceptance, setAcceptance] = useState('')
  const [classification, setClassification] = useState<TaskClassification | null>(null)
  const [timeline, setTimeline] = useState<TaskTimeline>('whenever')
  const [submitting, setSubmitting] = useState(false)
  const [aiDraftOpen, setAiDraftOpen] = useState(false)
  const activeWorkspaceId = useCanvasStore((s) => s.activeWorkspaceId)

  const effectiveClassification: TaskClassification = classification ?? 'QUICK'

  const handleProposal = (p: Proposal): void => {
    setLabel(p.label)
    setIntent(p.intent)
    setAcceptance(p.acceptanceCriteria)
    if (p.kind === 'benchmark') {
      setClassification('BENCHMARK')
    } else {
      setClassification(p.classification)
      setTimeline(p.timelinePressure)
    }
  }

  const submit = async (): Promise<void> => {
    if (!label.trim()) return
    setSubmitting(true)
    try {
      const res = await window.task.create({
        label: label.trim(),
        intent,
        acceptanceCriteria: acceptance || undefined,
        classification: classification ?? undefined,
        timelinePressure: timeline,
        workspaceId: activeWorkspaceId
      })
      if (res.ok && res.taskId) {
        onCreated(res.taskId)
        onClose()
      }
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
          width: 480,
          color: '#e6e7ea',
          fontFamily: 'system-ui, -apple-system, sans-serif'
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 12
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 600 }}>New task</div>
          <button
            type="button"
            onClick={() => setAiDraftOpen(true)}
            style={{
              padding: '5px 10px',
              borderRadius: 4,
              background: '#a855f722',
              border: '1px solid #a855f7',
              color: '#c4a3ff',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            ✨ AI draft
          </button>
        </div>

        <Label>LABEL</Label>
        <input
          autoFocus
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
          }}
          style={inputStyle}
        />

        <Label>INTENT (markdown)</Label>
        <textarea
          value={intent}
          onChange={(e) => setIntent(e.target.value)}
          rows={3}
          style={{ ...inputStyle, resize: 'vertical' }}
          placeholder="What and why"
        />

        <Label>ACCEPTANCE CRITERIA (markdown)</Label>
        <textarea
          value={acceptance}
          onChange={(e) => setAcceptance(e.target.value)}
          rows={3}
          style={{ ...inputStyle, resize: 'vertical', fontFamily: 'ui-monospace, monospace' }}
          placeholder="- [ ] Measurable done condition"
        />

        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <div style={{ flex: 1 }}>
            <Label>CLASSIFICATION (leave blank for auto)</Label>
            <select
              value={classification ?? ''}
              onChange={(e) =>
                setClassification((e.target.value || null) as TaskClassification | null)
              }
              style={inputStyle}
            >
              <option value="">Auto-classify</option>
              {CLASSIFICATION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <Label>TIMELINE</Label>
            <select
              value={timeline}
              onChange={(e) => setTimeline(e.target.value as TaskTimeline)}
              style={inputStyle}
            >
              {TIMELINE_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
          <button onClick={onClose} style={buttonStyle(false)}>
            Cancel
          </button>
          <button onClick={submit} disabled={!label.trim() || submitting} style={buttonStyle(true, !label.trim() || submitting)}>
            {submitting ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
      {aiDraftOpen && (
        <TaskSuggestModal
          classification={effectiveClassification}
          defaultWorkspaceId={activeWorkspaceId}
          existingLabel={label || undefined}
          existingIntent={intent || undefined}
          existingAcceptance={acceptance || undefined}
          onClose={() => setAiDraftOpen(false)}
          onProposal={handleProposal}
        />
      )}
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div
      style={{
        fontSize: 10,
        color: '#6b7280',
        marginTop: 10,
        marginBottom: 4,
        letterSpacing: 0.5
      }}
    >
      {children}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: '#0f0f12',
  border: '1px solid #3a3b42',
  color: '#e6e7ea',
  padding: '8px 10px',
  borderRadius: 4,
  fontSize: 13,
  boxSizing: 'border-box',
  fontFamily: 'inherit'
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
