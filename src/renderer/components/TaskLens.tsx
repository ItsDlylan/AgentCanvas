import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useReactFlow } from '@xyflow/react'
import { useCanvasStore } from '@/store/canvas-store'
import type {
  DerivedTaskState,
  TaskClassification,
  TaskLensUserConfig,
  TaskLensView,
  TaskMeta,
  TaskTimeline
} from '../../preload/index'
import { NewTaskModal } from './NewTaskModal'
import { ReviewAllNotesModal } from './ReviewAllNotesModal'
import { SaveLensViewModal } from './SaveLensViewModal'
import { TileContextMenu, type TileContextMenuItem } from './TileContextMenu'
import { matchTaskAgainstQuery } from '../lib/task-lens-match'

type DerivedState = DerivedTaskState

const BUILT_IN_VIEWS: TaskLensView[] = [
  { id: 'morning-quick-burst', label: 'Morning Quick Burst', query: '!class:QUICK !state:raw', builtIn: true },
  { id: 'this-week-deep-focus', label: 'This Week Deep Focus', query: '!class:DEEP_FOCUS !when:this-week', builtIn: true },
  { id: 'needs-research-inbox', label: 'Needs-Research Inbox', query: '!class:NEEDS_RESEARCH !state:raw', builtIn: true },
  { id: 'in-flight', label: 'In Flight', query: '!state:executing', builtIn: true }
]

const BUILT_IN_IDS = new Set(BUILT_IN_VIEWS.map((v) => v.id))

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
  const [userViews, setUserViews] = useState<TaskLensView[]>([])
  const [order, setOrder] = useState<string[]>([])
  const [filterText, setFilterText] = useState('')
  const [saveModal, setSaveModal] = useState<null | { mode: 'create'; query: string } | { mode: 'rename'; id: string; initialName: string }>(null)
  const [contextMenu, setContextMenu] = useState<null | { viewId: string; x: number; y: number }>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const reactFlow = useReactFlow()
  const allNodes = useCanvasStore((s) => s.allNodes)
  const configLoadedRef = useRef(false)

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

  useEffect(() => {
    let cancelled = false
    window.taskLens.load().then((cfg) => {
      if (cancelled) return
      setUserViews(cfg.views.map((v) => ({ ...v, builtIn: false })))
      setOrder(cfg.order)
      configLoadedRef.current = true
    })
    return () => {
      cancelled = true
    }
  }, [])

  const persist = useCallback(
    (nextViews: TaskLensView[], nextOrder: string[]) => {
      if (!configLoadedRef.current) return
      const config: TaskLensUserConfig = {
        version: 1,
        views: nextViews.map((v) => ({ id: v.id, label: v.label, query: v.query, builtIn: false })),
        order: nextOrder
      }
      void window.taskLens.save(config)
    },
    []
  )

  // Ordered view list: respect `order` for both built-ins and user views, then
  // append anything missing (e.g. on first launch, or after a new built-in is added).
  const orderedViews = useMemo(() => {
    const all: TaskLensView[] = [...BUILT_IN_VIEWS, ...userViews]
    const byId = new Map(all.map((v) => [v.id, v]))
    const seen = new Set<string>()
    const out: TaskLensView[] = []
    for (const id of order) {
      const v = byId.get(id)
      if (v && !seen.has(id)) {
        out.push(v)
        seen.add(id)
      }
    }
    for (const v of all) {
      if (!seen.has(v.id)) {
        out.push(v)
        seen.add(v.id)
      }
    }
    return out
  }, [userViews, order])

  const activeView = orderedViews.find((v) => v.id === activeViewId) ?? orderedViews[0]
  const effectiveQuery = filterText.trim().length > 0 ? filterText : (activeView?.query ?? '')

  const matching = useMemo(
    () => rows.filter((r) => matchTaskAgainstQuery(effectiveQuery, r)),
    [rows, effectiveQuery]
  )

  const queryMatchesExistingView = useMemo(() => {
    const trimmed = filterText.trim()
    if (trimmed.length === 0) return true
    return orderedViews.some((v) => v.query.trim() === trimmed)
  }, [filterText, orderedViews])

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

  const handleSaveView = useCallback(
    (name: string) => {
      if (!saveModal) return
      if (saveModal.mode === 'create') {
        const id = `user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
        const view: TaskLensView = { id, label: name, query: saveModal.query, builtIn: false }
        const nextViews = [...userViews, view]
        const nextOrder = order.includes(id) ? order : [...order, id]
        setUserViews(nextViews)
        setOrder(nextOrder)
        setActiveViewId(id)
        setFilterText('')
        persist(nextViews, nextOrder)
        showToast('View saved')
      } else {
        const nextViews = userViews.map((v) =>
          v.id === saveModal.id ? { ...v, label: name } : v
        )
        setUserViews(nextViews)
        persist(nextViews, order)
        showToast('View renamed')
      }
      setSaveModal(null)
    },
    [saveModal, userViews, order, persist, showToast]
  )

  const handleDeleteView = useCallback(
    (viewId: string) => {
      const nextViews = userViews.filter((v) => v.id !== viewId)
      const nextOrder = order.filter((id) => id !== viewId)
      setUserViews(nextViews)
      setOrder(nextOrder)
      if (activeViewId === viewId) setActiveViewId('morning-quick-burst')
      persist(nextViews, nextOrder)
      showToast('View deleted')
    },
    [userViews, order, activeViewId, persist, showToast]
  )

  const handleReorder = useCallback(
    (draggedId: string, targetId: string) => {
      if (draggedId === targetId) return
      const currentIds = orderedViews.map((v) => v.id)
      const fromIdx = currentIds.indexOf(draggedId)
      const toIdx = currentIds.indexOf(targetId)
      if (fromIdx < 0 || toIdx < 0) return
      const next = [...currentIds]
      next.splice(fromIdx, 1)
      next.splice(toIdx, 0, draggedId)
      setOrder(next)
      persist(userViews, next)
    },
    [orderedViews, userViews, persist]
  )

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
      <div style={{ padding: '8px 10px', borderBottom: '1px solid #2a2b32' }}>
        <input
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          placeholder="Filter: e.g. !class:QUICK !state:raw"
          style={{
            width: '100%',
            background: '#0f0f12',
            border: '1px solid #3a3b42',
            color: '#e6e7ea',
            padding: '6px 8px',
            borderRadius: 4,
            fontSize: 12,
            boxSizing: 'border-box',
            fontFamily: 'ui-monospace, monospace'
          }}
        />
        {filterText.trim().length > 0 && !queryMatchesExistingView && (
          <button
            onClick={() => setSaveModal({ mode: 'create', query: filterText.trim() })}
            style={{
              marginTop: 6,
              width: '100%',
              padding: '5px 10px',
              background: 'transparent',
              border: '1px solid #3a3b42',
              borderRadius: 4,
              color: '#e6e7ea',
              fontSize: 12,
              cursor: 'pointer'
            }}
          >
            Save current filter…
          </button>
        )}
      </div>
      <div style={{ padding: '8px 0' }}>
        {orderedViews.map((v) => {
          const count = rows.filter((r) => matchTaskAgainstQuery(v.query, r)).length
          const active = v.id === activeViewId && filterText.trim().length === 0
          const isUser = !v.builtIn
          const isDragOver = dropTarget === v.id && dragId !== null && dragId !== v.id
          return (
            <div
              key={v.id}
              draggable={isUser}
              onDragStart={(e) => {
                if (!isUser) return
                setDragId(v.id)
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', v.id)
              }}
              onDragEnd={() => {
                setDragId(null)
                setDropTarget(null)
              }}
              onDragOver={(e) => {
                if (dragId === null) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                setDropTarget(v.id)
              }}
              onDragLeave={() => {
                if (dropTarget === v.id) setDropTarget(null)
              }}
              onDrop={(e) => {
                e.preventDefault()
                if (dragId && dragId !== v.id) handleReorder(dragId, v.id)
                setDragId(null)
                setDropTarget(null)
              }}
              onContextMenu={(e) => {
                if (!isUser) return
                e.preventDefault()
                setContextMenu({ viewId: v.id, x: e.clientX, y: e.clientY })
              }}
              style={{
                display: 'flex',
                width: '100%',
                alignItems: 'center',
                gap: 6,
                padding: '0 16px 0 0',
                background: active ? '#22232a' : 'transparent',
                color: active ? '#f8f9fa' : '#c5c6cc',
                borderLeft: active ? '3px solid #3b82f6' : '3px solid transparent',
                borderTop: isDragOver ? '1px solid #3b82f6' : '1px solid transparent',
                cursor: isUser ? 'grab' : 'pointer',
                opacity: dragId === v.id ? 0.5 : 1
              }}
            >
              {isUser && (
                <span
                  title="Drag to reorder"
                  style={{
                    padding: '0 4px 0 8px',
                    color: '#6b7280',
                    fontSize: 12,
                    userSelect: 'none'
                  }}
                >
                  ⋮⋮
                </span>
              )}
              <button
                onClick={() => {
                  setActiveViewId(v.id)
                  setFilterText('')
                }}
                style={{
                  display: 'flex',
                  flex: 1,
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  textAlign: 'left',
                  padding: isUser ? '6px 0' : '6px 0 6px 13px',
                  background: 'transparent',
                  border: 'none',
                  color: 'inherit',
                  cursor: 'pointer',
                  fontSize: 13
                }}
              >
                <span>{v.label}</span>
                <span style={{ fontSize: 11, color: '#9ca3af', background: '#2a2b32', padding: '1px 6px', borderRadius: 8 }}>
                  {count}
                </span>
              </button>
            </div>
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
      {saveModal && (
        <SaveLensViewModal
          mode={saveModal.mode}
          initialName={saveModal.mode === 'rename' ? saveModal.initialName : ''}
          query={saveModal.mode === 'create' ? saveModal.query : undefined}
          onClose={() => setSaveModal(null)}
          onSubmit={handleSaveView}
        />
      )}
      {contextMenu && (() => {
        const view = userViews.find((v) => v.id === contextMenu.viewId)
        if (!view || BUILT_IN_IDS.has(view.id)) return null
        const items: TileContextMenuItem[] = [
          {
            label: 'Rename…',
            onClick: () => setSaveModal({ mode: 'rename', id: view.id, initialName: view.label })
          },
          {
            label: 'Delete',
            danger: true,
            onClick: () => handleDeleteView(view.id)
          }
        ]
        return (
          <TileContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            items={items}
            onClose={() => setContextMenu(null)}
          />
        )
      })()}
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
