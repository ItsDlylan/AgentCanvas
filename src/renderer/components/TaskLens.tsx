import { useCallback, useEffect, useMemo, useState } from 'react'
import { useReactFlow } from '@xyflow/react'
import { useCanvasStore } from '@/store/canvas-store'
import type { TaskClassification, TaskMeta, TaskTimeline } from '../../preload/index'
import { NewTaskModal } from './NewTaskModal'
import { ReviewAllNotesModal } from './ReviewAllNotesModal'

type DerivedState = 'raw' | 'researched' | 'planned' | 'executing' | 'review' | 'done'

interface TaskLensView {
  id: string
  label: string
  match: (meta: TaskMeta, state: DerivedState) => boolean
}

const BUILT_IN_VIEWS: TaskLensView[] = [
  {
    id: 'morning-quick-burst',
    label: 'Morning Quick Burst',
    match: (m, s) => m.classification === 'QUICK' && s === 'raw'
  },
  {
    id: 'this-week-deep-focus',
    label: 'This Week Deep Focus',
    match: (m) => m.classification === 'DEEP_FOCUS' && m.timelinePressure === 'this-week'
  },
  {
    id: 'needs-research-inbox',
    label: 'Needs-Research Inbox',
    match: (m, s) => m.classification === 'NEEDS_RESEARCH' && s === 'raw'
  },
  {
    id: 'in-flight',
    label: 'In Flight',
    match: (_m, s) => s === 'executing'
  }
]

const CLASSIFICATION_COLOR: Record<TaskClassification, string> = {
  QUICK: '#22c55e',
  NEEDS_RESEARCH: '#f59e0b',
  DEEP_FOCUS: '#a855f7',
  BENCHMARK: '#3b82f6'
}

interface TaskRow {
  meta: TaskMeta
  state: DerivedState
}

export function TaskLens({ onClose }: { onClose: () => void }): JSX.Element {
  const [activeViewId, setActiveViewId] = useState<string>('morning-quick-burst')
  const [rows, setRows] = useState<TaskRow[]>([])
  const [showNewModal, setShowNewModal] = useState(false)
  const [showReviewModal, setShowReviewModal] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const reactFlow = useReactFlow()
  const allNodes = useCanvasStore((s) => s.allNodes)

  const refresh = useCallback(async () => {
    const tasks = await window.task.list()
    const results: TaskRow[] = []
    for (const t of tasks) {
      if (t.meta.isSoftDeleted) continue
      const derived = await window.task.deriveState(t.meta.taskId)
      results.push({ meta: t.meta, state: (derived?.state ?? 'raw') as DerivedState })
    }
    setRows(results)
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    const unsubs = [
      window.task.onTaskOpen(() => refresh()),
      window.task.onTaskClose(() => refresh()),
      window.task.onTaskDelete(() => refresh()),
      window.task.onTaskUpdate(() => refresh()),
      window.task.onTaskStateChange(() => refresh())
    ]
    return () => {
      for (const u of unsubs) u()
    }
  }, [refresh])

  const activeView = BUILT_IN_VIEWS.find((v) => v.id === activeViewId) ?? BUILT_IN_VIEWS[0]
  const matching = useMemo(
    () => rows.filter((r) => activeView.match(r.meta, r.state)),
    [rows, activeView]
  )

  const jumpTo = useCallback(
    (taskId: string) => {
      const node = allNodes.find((n) => n.id === taskId)
      if (!node) return
      reactFlow.setCenter(
        node.position.x + ((node.style?.width as number) ?? 420) / 2,
        node.position.y + ((node.style?.height as number) ?? 440) / 2,
        { zoom: 0.8, duration: 300 }
      )
    },
    [allNodes, reactFlow]
  )

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }, [])

  return (
    <div
      style={{
        position: 'fixed',
        top: 40,
        left: 0,
        bottom: 0,
        width: 320,
        background: '#15161a',
        borderRight: '1px solid #2a2b32',
        zIndex: 5000,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        color: '#e6e7ea'
      }}
    >
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid #2a2b32',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 600 }}>Task Lens</div>
        <button
          onClick={onClose}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#9ca3af',
            cursor: 'pointer',
            fontSize: 18
          }}
        >
          ×
        </button>
      </div>
      <div style={{ padding: '8px 10px', borderBottom: '1px solid #2a2b32', display: 'flex', gap: 6 }}>
        <button onClick={() => setShowNewModal(true)} style={actionButtonStyle()}>+ New Task</button>
        <button onClick={() => setShowReviewModal(true)} style={actionButtonStyle()}>Review all notes…</button>
      </div>
      <div style={{ padding: '8px 0' }}>
        {BUILT_IN_VIEWS.map((v) => {
          const count = rows.filter((r) => v.match(r.meta, r.state)).length
          const active = v.id === activeViewId
          return (
            <button
              key={v.id}
              onClick={() => setActiveViewId(v.id)}
              style={{
                display: 'flex',
                width: '100%',
                justifyContent: 'space-between',
                alignItems: 'center',
                textAlign: 'left',
                padding: '6px 16px',
                background: active ? '#22232a' : 'transparent',
                border: 'none',
                color: active ? '#f8f9fa' : '#c5c6cc',
                cursor: 'pointer',
                fontSize: 13,
                borderLeft: active ? '3px solid #3b82f6' : '3px solid transparent'
              }}
            >
              <span>{v.label}</span>
              <span style={{ fontSize: 11, color: '#9ca3af', background: '#2a2b32', padding: '1px 6px', borderRadius: 8 }}>
                {count}
              </span>
            </button>
          )
        })}
      </div>
      {toast && (
        <div
          style={{
            margin: '0 10px 8px',
            padding: '6px 10px',
            background: '#22232a',
            border: '1px solid #3a3b42',
            borderRadius: 4,
            fontSize: 12,
            color: '#c5c6cc'
          }}
        >
          {toast}
        </div>
      )}
      {showNewModal && (
        <NewTaskModal
          onClose={() => setShowNewModal(false)}
          onCreated={() => {
            refresh()
            showToast('Task created')
          }}
        />
      )}
      {showReviewModal && (
        <ReviewAllNotesModal
          onClose={() => setShowReviewModal(false)}
          onComplete={(n) => {
            setShowReviewModal(false)
            refresh()
            showToast(`Converted ${n} note${n === 1 ? '' : 's'} to tasks`)
          }}
        />
      )}
      <div style={{ borderTop: '1px solid #2a2b32', flex: 1, overflow: 'auto' }}>
        {matching.length === 0 ? (
          <div style={{ padding: 20, color: '#6b7280', fontSize: 12 }}>
            No tasks in this view.
          </div>
        ) : (
          matching.map((r) => (
            <div
              key={r.meta.taskId}
              onClick={() => jumpTo(r.meta.taskId)}
              style={{
                padding: '8px 16px',
                borderBottom: '1px solid #2a2b32',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 8
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#1d1e24')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <div
                style={{
                  width: 4,
                  alignSelf: 'stretch',
                  background: CLASSIFICATION_COLOR[r.meta.classification]
                }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.meta.label}
                </div>
                <div style={{ fontSize: 10, color: '#9ca3af', display: 'flex', gap: 8 }}>
                  <span>{r.meta.classification.replace('_', ' ')}</span>
                  <span>·</span>
                  <span>{r.state}</span>
                  {r.meta.timelinePressure !== 'whenever' && (
                    <>
                      <span>·</span>
                      <span style={{ color: timelineColor(r.meta.timelinePressure) }}>
                        {r.meta.timelinePressure}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function actionButtonStyle(): React.CSSProperties {
  return {
    flex: 1,
    padding: '5px 10px',
    background: 'transparent',
    border: '1px solid #3a3b42',
    borderRadius: 4,
    color: '#e6e7ea',
    fontSize: 12,
    cursor: 'pointer'
  }
}

function timelineColor(t: TaskTimeline): string {
  if (t === 'urgent') return '#ef4444'
  if (t === 'this-week') return '#f59e0b'
  if (t === 'this-month') return '#3b82f6'
  return '#9ca3af'
}
