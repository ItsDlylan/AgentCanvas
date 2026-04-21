import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import { NodeResizer, Handle, Position } from '@xyflow/react'
import type {
  DerivedTaskState,
  TaskClassification,
  TaskMeta,
  TaskTimeline
} from '../../preload/index'
import { useSemanticZoom } from '../hooks/useSemanticZoom'
import { TileContextMenu, type TileContextMenuItem } from './TileContextMenu'

const CLASSIFICATION_COLOR: Record<TaskClassification, string> = {
  QUICK: '#22c55e',
  NEEDS_RESEARCH: '#f59e0b',
  DEEP_FOCUS: '#a855f7',
  BENCHMARK: '#3b82f6'
}

const CLASSIFICATION_LABEL: Record<TaskClassification, string> = {
  QUICK: 'Quick',
  NEEDS_RESEARCH: 'Research',
  DEEP_FOCUS: 'Deep Focus',
  BENCHMARK: 'Benchmark'
}

const STATE_LABEL: Record<DerivedTaskState, string> = {
  raw: 'Raw',
  researched: 'Researched',
  planned: 'Planned',
  executing: 'Executing',
  review: 'Review',
  done: 'Done'
}

const STATE_COLOR: Record<DerivedTaskState, string> = {
  raw: '#6b7280',
  researched: '#f59e0b',
  planned: '#8b5cf6',
  executing: '#3b82f6',
  review: '#eab308',
  done: '#22c55e'
}

interface TaskTileData {
  taskId: string
}

export function TaskTile({ data, selected }: NodeProps): JSX.Element {
  const { taskId } = data as unknown as TaskTileData

  const [meta, setMeta] = useState<TaskMeta | null>(null)
  const [intent, setIntent] = useState<string>('')
  const [acceptanceMarkdown, setAcceptanceMarkdown] = useState<string>('')
  const [derivedState, setDerivedState] = useState<DerivedTaskState>('raw')
  const [editing, setEditing] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [classifyBusy, setClassifyBusy] = useState(false)
  const [copiedPrompt, setCopiedPrompt] = useState(false)
  const tier = useSemanticZoom()
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const reloadDerivedState = useCallback(async () => {
    const d = await window.task.deriveState(taskId)
    if (d) setDerivedState(d.state)
  }, [taskId])

  useEffect(() => {
    let cancelled = false
    window.task.load(taskId).then((file) => {
      if (cancelled || !file) return
      setMeta(file.meta)
      setIntent(file.intent)
      setAcceptanceMarkdown(tiptapToMarkdownFallback(file.acceptanceCriteria))
    })
    reloadDerivedState()
    return () => {
      cancelled = true
    }
  }, [taskId, reloadDerivedState])

  useEffect(() => {
    const unsubState = window.task.onTaskStateChange(({ taskId: id, state }) => {
      if (id === taskId) setDerivedState(state)
    })
    const unsubUpdate = window.task.onTaskUpdate(({ taskId: id }) => {
      if (id !== taskId) return
      window.task.load(taskId).then((file) => {
        if (file) setMeta(file.meta)
      })
      reloadDerivedState()
    })
    return () => {
      unsubState()
      unsubUpdate()
    }
  }, [taskId, reloadDerivedState])

  const saveSoon = useCallback(
    (patch: { label?: string; intent?: string; acceptanceMarkdown?: string }) => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => {
        const metaPatch: Partial<TaskMeta> = {}
        if (patch.label !== undefined) metaPatch.label = patch.label
        const acceptanceDoc =
          patch.acceptanceMarkdown !== undefined
            ? markdownToSimpleTiptap(patch.acceptanceMarkdown)
            : undefined
        window.task.save(taskId, metaPatch, patch.intent, acceptanceDoc).catch((err) => {
          console.warn('[task-tile] save failed:', err)
        })
      }, 400)
    },
    [taskId]
  )

  const markReviewed = useCallback(async () => {
    await window.task.save(taskId, { manualReviewDone: true })
    reloadDerivedState()
  }, [taskId, reloadDerivedState])

  const unmarkReviewed = useCallback(async () => {
    await window.task.save(taskId, { manualReviewDone: false })
    reloadDerivedState()
  }, [taskId, reloadDerivedState])

  const reclassify = useCallback(async () => {
    setClassifyBusy(true)
    try {
      const res = await window.task.classify(intent, acceptanceMarkdown)
      if (res.ok && res.result) {
        const confirm = window.confirm(
          `Reclassify as ${res.result.classification}?\n\n${res.result.rationale ?? ''}`
        )
        if (confirm) {
          await window.task.save(taskId, { classification: res.result.classification })
          const file = await window.task.load(taskId)
          if (file) setMeta(file.meta)
          reloadDerivedState()
        }
      }
    } finally {
      setClassifyBusy(false)
    }
  }, [taskId, intent, acceptanceMarkdown, reloadDerivedState])

  const setClassification = useCallback(
    async (c: TaskClassification) => {
      await window.task.save(taskId, { classification: c })
      const file = await window.task.load(taskId)
      if (file) setMeta(file.meta)
      reloadDerivedState()
    },
    [taskId, reloadDerivedState]
  )

  const setTimeline = useCallback(
    async (t: TaskTimeline) => {
      await window.task.save(taskId, { timelinePressure: t })
      const file = await window.task.load(taskId)
      if (file) setMeta(file.meta)
    },
    [taskId]
  )

  const softDelete = useCallback(async () => {
    await window.task.save(taskId, { isSoftDeleted: true, softDeletedAt: Date.now() })
  }, [taskId])

  const spawnLinkedPlan = useCallback(async () => {
    if (!meta) return
    const content =
      `# Problem statement\n${intent}\n\n` +
      `# Acceptance criteria\n${acceptanceMarkdown || '- [ ] Define at least one measurable success condition'}\n`
    const res = await window.plan.create({
      label: `Plan: ${meta.label}`,
      content,
      workspaceId: meta.workspaceId
    })
    if (res.ok && res.planId) {
      await window.task.link(taskId, res.planId, 'has-plan')
      reloadDerivedState()
    }
  }, [meta, intent, acceptanceMarkdown, taskId, reloadDerivedState])

  const copyAgentPrompt = useCallback(async () => {
    if (!meta) return
    const prompt =
      `# Task: ${meta.label}\n\n` +
      `Classification: ${meta.classification}\n` +
      `Timeline: ${meta.timelinePressure}\n\n` +
      `## Intent\n${intent || '(no intent provided)'}\n\n` +
      `## Acceptance criteria\n${acceptanceMarkdown || '(none specified)'}\n\n` +
      `---\nTask ID: ${meta.taskId}\n` +
      `When you finish, update the task:\n` +
      `curl -s -X POST $AGENT_CANVAS_API/api/task/update -H 'Content-Type: application/json' -d '{"taskId":"${meta.taskId}","manualReviewDone":true}'\n`
    try {
      await navigator.clipboard.writeText(prompt)
      setCopiedPrompt(true)
      setTimeout(() => setCopiedPrompt(false), 2000)
    } catch {
      // Fallback: no-op if clipboard denied
    }
  }, [meta, intent, acceptanceMarkdown])

  const spawnLinkedTerminal = useCallback(async () => {
    if (!meta) return
    const store = (await import('../store/canvas-store')).useCanvasStore
    const existingBefore = new Set(
      store.getState().allNodes.filter((n) => n.type === 'terminal').map((n) => n.id)
    )
    store.getState().addTerminalAt(undefined, 640, 400, undefined, `Task: ${meta.label}`)
    // Wait for ReactFlow to mount the new terminal tile + register its handles.
    // 50ms wasn't enough — the terminal component measures CWD etc. async.
    await new Promise((r) => setTimeout(r, 600))
    const newTerminal = store
      .getState()
      .allNodes.filter((n) => n.type === 'terminal')
      .find((n) => !existingBefore.has(n.id))
    if (newTerminal) {
      await window.task.link(taskId, newTerminal.id, 'executing-in')
      reloadDerivedState()
    }
  }, [meta, taskId, reloadDerivedState])

  const contextMenuItems: TileContextMenuItem[] = useMemo(() => {
    if (!meta) return []
    const items: TileContextMenuItem[] = [
      {
        label: classifyBusy ? 'Reclassifying…' : 'Reclassify (auto)',
        onClick: reclassify,
        disabled: classifyBusy
      }
    ]
    for (const c of ['QUICK', 'NEEDS_RESEARCH', 'DEEP_FOCUS', 'BENCHMARK'] as TaskClassification[]) {
      items.push({
        label: `Set: ${CLASSIFICATION_LABEL[c]}${meta.classification === c ? '  ✓' : ''}`,
        onClick: () => setClassification(c),
        disabled: meta.classification === c
      })
    }
    items.push({ label: '', separator: true, onClick: () => undefined })
    for (const t of ['urgent', 'this-week', 'this-month', 'whenever'] as TaskTimeline[]) {
      items.push({
        label: `Timeline: ${timelineLabel(t)}${meta.timelinePressure === t ? '  ✓' : ''}`,
        onClick: () => setTimeline(t),
        disabled: meta.timelinePressure === t
      })
    }
    items.push({ label: '', separator: true, onClick: () => undefined })
    if (meta.manualReviewDone) {
      items.push({ label: 'Unmark reviewed', onClick: unmarkReviewed })
    } else {
      items.push({ label: 'Mark reviewed', onClick: markReviewed })
    }
    items.push({ label: '', separator: true, onClick: () => undefined })
    items.push({ label: 'Close (soft delete)', onClick: softDelete, danger: true })
    return items
  }, [
    meta,
    classifyBusy,
    reclassify,
    setClassification,
    setTimeline,
    markReviewed,
    unmarkReviewed,
    softDelete
  ])

  if (!meta) {
    return (
      <div style={tileContainerStyle(selected, '#6b7280')}>
        <Handle type="target" position={Position.Top} className="!bg-zinc-600" />
        <div style={{ padding: 16, color: '#9ca3af' }}>Loading…</div>
        <Handle type="source" position={Position.Bottom} className="!bg-zinc-600" />
      </div>
    )
  }

  const accent = CLASSIFICATION_COLOR[meta.classification]

  if (tier === 'badge') {
    return (
      <div style={{ ...tileContainerStyle(selected, accent), padding: 0 }}>
        <Handle type="target" position={Position.Top} className="!bg-zinc-600" />
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: accent,
            borderRadius: 6
          }}
        >
          <div
            style={{
              width: 12,
              height: 12,
              borderRadius: '50%',
              background: STATE_COLOR[derivedState],
              boxShadow: '0 0 0 2px rgba(0,0,0,0.4)'
            }}
          />
        </div>
        <Handle type="source" position={Position.Bottom} className="!bg-zinc-600" />
      </div>
    )
  }

  if (tier === 'compact') {
    return (
      <div style={tileContainerStyle(selected, accent)}>
        <Handle type="target" position={Position.Top} className="!bg-zinc-600" />
        <AccentStripe color={accent} />
        <div style={{ padding: '10px 12px 10px 16px' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#f8f9fa', marginBottom: 4 }}>
            {meta.label}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <Chip color={accent} label={CLASSIFICATION_LABEL[meta.classification]} />
            <Chip color={STATE_COLOR[derivedState]} label={STATE_LABEL[derivedState]} />
          </div>
        </div>
        <Handle type="source" position={Position.Bottom} className="!bg-zinc-600" />
      </div>
    )
  }

  return (
    <div
      style={tileContainerStyle(selected, accent)}
      onContextMenu={(e) => {
        e.preventDefault()
        setContextMenu({ x: e.clientX, y: e.clientY })
      }}
    >
      <NodeResizer minWidth={280} minHeight={200} isVisible={selected} />
      <Handle type="target" position={Position.Top} className="!bg-zinc-600" />
      <AccentStripe color={accent} />
      <div
        style={{
          padding: '10px 12px 10px 16px',
          borderBottom: '1px solid #2a2b32',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8
        }}
      >
        {editing ? (
          <input
            autoFocus
            defaultValue={meta.label}
            onBlur={(e) => {
              setEditing(false)
              if (e.target.value !== meta.label) {
                setMeta({ ...meta, label: e.target.value })
                saveSoon({ label: e.target.value })
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              if (e.key === 'Escape') setEditing(false)
            }}
            style={{
              flex: 1,
              background: '#0f0f12',
              border: '1px solid #3a3b42',
              color: '#f8f9fa',
              padding: '4px 6px',
              fontSize: 14,
              borderRadius: 4
            }}
          />
        ) : (
          <div
            onDoubleClick={() => setEditing(true)}
            style={{ flex: 1, fontSize: 14, fontWeight: 600, color: '#f8f9fa', cursor: 'text' }}
          >
            {meta.label}
          </div>
        )}
        <Chip color={accent} label={CLASSIFICATION_LABEL[meta.classification]} />
        <Chip color={STATE_COLOR[derivedState]} label={STATE_LABEL[derivedState]} />
        <TimelineChip value={meta.timelinePressure} />
        <button
          onClick={(e) => setContextMenu({ x: e.clientX, y: e.clientY })}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#9ca3af',
            cursor: 'pointer',
            fontSize: 18,
            padding: '0 4px'
          }}
        >
          ⋯
        </button>
      </div>
      <div
        style={{
          padding: '10px 12px 12px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          flex: 1,
          overflow: 'auto'
        }}
      >
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(meta.classification === 'QUICK' || meta.classification === 'BENCHMARK') && (
            <ActionButton accent={accent} onClick={spawnLinkedTerminal}>
              ▸ Spawn Terminal
            </ActionButton>
          )}
          {(meta.classification === 'DEEP_FOCUS' || meta.classification === 'NEEDS_RESEARCH') && (
            <ActionButton accent={accent} onClick={spawnLinkedPlan}>
              ▸ Spawn Plan
            </ActionButton>
          )}
          <ActionButton onClick={copyAgentPrompt}>
            {copiedPrompt ? '✓ Copied' : '⧉ Copy Prompt'}
          </ActionButton>
          {!meta.manualReviewDone ? (
            <ActionButton onClick={markReviewed}>✓ Mark Reviewed</ActionButton>
          ) : (
            <ActionButton onClick={unmarkReviewed}>↺ Unreview</ActionButton>
          )}
        </div>
        <div>
          <div style={sectionLabelStyle}>Intent</div>
          <textarea
            value={intent}
            onChange={(e) => {
              setIntent(e.target.value)
              saveSoon({ intent: e.target.value })
            }}
            placeholder="What and why"
            style={textareaStyle}
          />
        </div>
        <div>
          <div style={sectionLabelStyle}>Acceptance criteria (markdown)</div>
          <textarea
            value={acceptanceMarkdown}
            onChange={(e) => {
              setAcceptanceMarkdown(e.target.value)
              saveSoon({ acceptanceMarkdown: e.target.value })
            }}
            placeholder="- [ ] A measurable done condition"
            style={{ ...textareaStyle, minHeight: 80, fontFamily: 'ui-monospace, monospace' }}
          />
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-zinc-600" />
      {contextMenu && (
        <TileContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenuItems}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  )
}

// ── helpers ──

function tileContainerStyle(selected: boolean | undefined, accent: string): React.CSSProperties {
  return {
    position: 'relative',
    width: '100%',
    height: '100%',
    background: '#1a1b1f',
    border: `1px solid ${selected ? accent : '#3a3b42'}`,
    borderRadius: 6,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    fontFamily: 'system-ui, -apple-system, sans-serif'
  }
}

const sectionLabelStyle: React.CSSProperties = {
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  color: '#6b7280',
  marginBottom: 4
}

const textareaStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 50,
  background: '#0f0f12',
  border: '1px solid #2a2b32',
  color: '#e6e7ea',
  borderRadius: 4,
  padding: 6,
  fontSize: 13,
  resize: 'vertical',
  fontFamily: 'system-ui, -apple-system, sans-serif'
}

function AccentStripe({ color }: { color: string }): JSX.Element {
  return (
    <div
      style={{
        width: 4,
        background: color,
        position: 'absolute',
        left: 0,
        top: 0,
        bottom: 0,
        borderTopLeftRadius: 6,
        borderBottomLeftRadius: 6
      }}
    />
  )
}

function ActionButton({
  children,
  onClick,
  accent
}: {
  children: React.ReactNode
  onClick: () => void
  accent?: string
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '5px 10px',
        borderRadius: 4,
        background: accent ? `${accent}22` : 'transparent',
        border: `1px solid ${accent ?? '#3a3b42'}`,
        color: accent ?? '#e6e7ea',
        fontSize: 11,
        fontWeight: 600,
        cursor: 'pointer',
        whiteSpace: 'nowrap'
      }}
      onMouseEnter={(e) => {
        if (accent) e.currentTarget.style.background = `${accent}44`
        else e.currentTarget.style.background = '#22232a'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = accent ? `${accent}22` : 'transparent'
      }}
    >
      {children}
    </button>
  )
}

function Chip({ color, label }: { color: string; label: string }): JSX.Element {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px',
        borderRadius: 10,
        background: 'rgba(0,0,0,0.3)',
        border: `1px solid ${color}`,
        color,
        fontSize: 11,
        fontWeight: 600,
        whiteSpace: 'nowrap'
      }}
    >
      {label}
    </span>
  )
}

function TimelineChip({ value }: { value: TaskTimeline }): JSX.Element | null {
  if (value === 'whenever') return null
  const color = value === 'urgent' ? '#ef4444' : value === 'this-week' ? '#f59e0b' : '#3b82f6'
  return (
    <span
      style={{
        padding: '2px 6px',
        borderRadius: 4,
        color,
        fontSize: 10,
        fontWeight: 500,
        border: `1px dashed ${color}`,
        whiteSpace: 'nowrap'
      }}
    >
      {timelineLabel(value)}
    </span>
  )
}

function timelineLabel(v: TaskTimeline): string {
  return v === 'urgent' ? 'Urgent' : v === 'this-week' ? 'This week' : v === 'this-month' ? 'This month' : 'Whenever'
}

// Very rough TipTap -> markdown fallback for display.
function tiptapToMarkdownFallback(doc: Record<string, unknown>): string {
  try {
    const content = (doc as { content?: Array<Record<string, unknown>> }).content ?? []
    const lines: string[] = []
    for (const node of content) {
      const t = (node as { type?: string }).type
      const inner = (node as { content?: Array<Record<string, unknown>> }).content ?? []
      const text = inner
        .map((c) => (c as { text?: string }).text ?? '')
        .join('')
      if (t === 'heading') lines.push(`# ${text}`)
      else if (t === 'bulletList' || t === 'taskList') {
        for (const li of inner) {
          const liInner = (li as { content?: Array<{ content?: Array<{ text?: string }> }> }).content ?? []
          const liText = (liInner[0]?.content ?? []).map((c) => c.text ?? '').join('')
          const checked = (li as { attrs?: { checked?: boolean } }).attrs?.checked
          if (t === 'taskList') lines.push(`- [${checked ? 'x' : ' '}] ${liText}`)
          else lines.push(`- ${liText}`)
        }
      } else {
        if (text) lines.push(text)
      }
    }
    return lines.join('\n')
  } catch {
    return ''
  }
}

// Very basic markdown -> TipTap doc (simplified for checkboxes and paragraphs).
// The server also accepts markdown via the /api/task/open route and converts via
// markdownToTiptap; this fallback is for the IPC save path which expects JSON.
function markdownToSimpleTiptap(md: string): Record<string, unknown> {
  const lines = md.split('\n')
  const content: Array<Record<string, unknown>> = []
  const taskItems: Array<Record<string, unknown>> = []
  const bulletItems: Array<Record<string, unknown>> = []

  const flushTask = (): void => {
    if (taskItems.length > 0) {
      content.push({ type: 'taskList', content: [...taskItems] })
      taskItems.length = 0
    }
  }
  const flushBullet = (): void => {
    if (bulletItems.length > 0) {
      content.push({ type: 'bulletList', content: [...bulletItems] })
      bulletItems.length = 0
    }
  }

  for (const line of lines) {
    const taskMatch = line.match(/^\s*-\s*\[([ xX])\]\s*(.*)$/)
    const bulletMatch = line.match(/^\s*-\s*(.*)$/)
    if (taskMatch) {
      flushBullet()
      taskItems.push({
        type: 'taskItem',
        attrs: { checked: taskMatch[1].toLowerCase() === 'x' },
        content: [{ type: 'paragraph', content: [{ type: 'text', text: taskMatch[2] }] }]
      })
      continue
    }
    if (bulletMatch) {
      flushTask()
      bulletItems.push({
        type: 'listItem',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: bulletMatch[1] }] }]
      })
      continue
    }
    flushTask()
    flushBullet()
    if (line.trim()) {
      content.push({ type: 'paragraph', content: [{ type: 'text', text: line }] })
    }
  }
  flushTask()
  flushBullet()

  return { type: 'doc', content }
}
