import { createPortal } from 'react-dom'
import type { DerivedTaskState } from '../../preload/index'
import type { UnsatisfiedDep } from '../lib/task-dependency-check'

const STATE_LABEL: Record<DerivedTaskState, string> = {
  raw: 'Raw',
  researched: 'Researched',
  planned: 'Planned',
  executing: 'Executing',
  review: 'Review',
  done: 'Done'
}

interface Props {
  actionLabel: string
  unsatisfied: UnsatisfiedDep[]
  onProceed: () => void
  onCancel: () => void
}

export function DependencyWarningModal({
  actionLabel,
  unsatisfied,
  onProceed,
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 22,
              height: 22,
              borderRadius: '50%',
              background: '#f59e0b',
              color: '#111',
              fontWeight: 700,
              fontSize: 14
            }}
          >
            !
          </span>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Unresolved dependencies</div>
        </div>

        <div style={{ fontSize: 13, color: '#c7c8cc', marginBottom: 12, lineHeight: 1.5 }}>
          This task depends on {unsatisfied.length === 1 ? 'a task that is' : 'tasks that are'} not
          yet <strong>done</strong>. Proceeding with <strong>{actionLabel}</strong> anyway will
          advance this task past <em>raw</em>.
        </div>

        <div
          style={{
            background: '#0f0f12',
            border: '1px solid #2a2b32',
            borderRadius: 4,
            padding: 8,
            marginBottom: 16,
            maxHeight: 220,
            overflowY: 'auto'
          }}
        >
          {unsatisfied.map((dep) => (
            <div
              key={dep.taskId}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '6px 4px',
                fontSize: 13
              }}
            >
              <span style={{ color: '#e6e7ea', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {dep.label}
              </span>
              <span
                style={{
                  padding: '2px 8px',
                  borderRadius: 10,
                  background: 'rgba(0,0,0,0.3)',
                  border: '1px solid #6b7280',
                  color: '#9ca3af',
                  fontSize: 11,
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                  marginLeft: 8
                }}
              >
                {STATE_LABEL[dep.state]}
              </span>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={buttonStyle(false)}>
            Cancel
          </button>
          <button onClick={onProceed} style={buttonStyle(true)}>
            Proceed anyway
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
