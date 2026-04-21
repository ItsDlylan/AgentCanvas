import { createPortal } from 'react-dom'
import type { TaskClassification } from '../../preload/index'

const CLASSIFICATION_LABEL: Record<TaskClassification, string> = {
  QUICK: 'Quick',
  NEEDS_RESEARCH: 'Research',
  DEEP_FOCUS: 'Deep Focus',
  BENCHMARK: 'Benchmark'
}

const CLASSIFICATION_COLOR: Record<TaskClassification, string> = {
  QUICK: '#22c55e',
  NEEDS_RESEARCH: '#f59e0b',
  DEEP_FOCUS: '#a855f7',
  BENCHMARK: '#3b82f6'
}

interface Props {
  proposed: TaskClassification
  rationale?: string
  onConfirm: () => void
  onCancel: () => void
}

export function ReclassifyConfirmModal({
  proposed,
  rationale,
  onConfirm,
  onCancel
}: Props): JSX.Element {
  return createPortal(
    <div
      onClick={onCancel}
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
          width: 440,
          color: '#e6e7ea',
          fontFamily: 'system-ui, -apple-system, sans-serif'
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Reclassify task?</div>

        <div style={{ fontSize: 13, color: '#c7c8cc', marginBottom: 12, lineHeight: 1.5 }}>
          The classifier proposes:
          <span
            style={{
              display: 'inline-block',
              marginLeft: 8,
              padding: '2px 10px',
              borderRadius: 10,
              background: 'rgba(0,0,0,0.3)',
              border: `1px solid ${CLASSIFICATION_COLOR[proposed]}`,
              color: CLASSIFICATION_COLOR[proposed],
              fontSize: 12,
              fontWeight: 600
            }}
          >
            {CLASSIFICATION_LABEL[proposed]}
          </span>
        </div>

        {rationale && (
          <div
            style={{
              background: '#0f0f12',
              border: '1px solid #2a2b32',
              borderRadius: 4,
              padding: 10,
              marginBottom: 16,
              fontSize: 12,
              color: '#c7c8cc',
              lineHeight: 1.5,
              maxHeight: 220,
              overflowY: 'auto',
              whiteSpace: 'pre-wrap'
            }}
          >
            {rationale}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={buttonStyle(false)}>
            Cancel
          </button>
          <button onClick={onConfirm} style={buttonStyle(true)}>
            Reclassify
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

function buttonStyle(primary: boolean): React.CSSProperties {
  return {
    padding: '8px 14px',
    borderRadius: 4,
    border: primary ? 'none' : '1px solid #3a3b42',
    background: primary ? '#f59e0b' : 'transparent',
    color: primary ? '#111' : '#e6e7ea',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer'
  }
}
