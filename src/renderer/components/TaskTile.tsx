import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import { NodeResizer, Handle, Position } from '@xyflow/react'
import type { JSONContent } from '@tiptap/core'
import type {
  DerivedTaskState,
  TaskClassification,
  TaskMeta,
  TaskTimeline
} from '../../preload/index'
import { useSemanticZoom } from '../hooks/useSemanticZoom'
import { TileContextMenu, type TileContextMenuItem } from './TileContextMenu'
import { DependencyWarningModal } from './DependencyWarningModal'
import { ReclassifyConfirmModal } from './ReclassifyConfirmModal'
import { TaskTileAcceptanceEditor } from './TaskTileAcceptanceEditor'
import { HarnessBenchmarkModal } from './HarnessBenchmarkModal'
import {
  unsatisfiedDependencies,
  type UnsatisfiedDep
} from '../lib/task-dependency-check'

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
  const [acceptanceDoc, setAcceptanceDoc] = useState<Record<string, unknown> | null>(null)
  const [derivedState, setDerivedState] = useState<DerivedTaskState>('raw')
  const [editing, setEditing] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [classifyBusy, setClassifyBusy] = useState(false)
  const [copiedPrompt, setCopiedPrompt] = useState(false)
  const [depWarning, setDepWarning] = useState<{
    actionLabel: string
    unsatisfied: UnsatisfiedDep[]
    proceed: () => void
  } | null>(null)
  const [reclassifyProposal, setReclassifyProposal] = useState<{
    classification: TaskClassification
    rationale?: string
  } | null>(null)
  const tier = useSemanticZoom()
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [harnessOpen, setHarnessOpen] = useState(false)

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
      setAcceptanceDoc(file.acceptanceCriteria ?? { type: 'doc', content: [] })
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
    (patch: { label?: string; intent?: string }) => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => {
        const metaPatch: Partial<TaskMeta> = {}
        if (patch.label !== undefined) metaPatch.label = patch.label
        window.task.save(taskId, metaPatch, patch.intent, undefined).catch((err) => {
          console.warn('[task-tile] save failed:', err)
        })
      }, 400)
    },
    [taskId]
  )

  // The TipTap editor persists its own debounced updates. We bypass saveSoon
  // here to avoid double-debouncing the doc.
  const saveAcceptanceDoc = useCallback(
    (json: JSONContent) => {
      setAcceptanceDoc(json as unknown as Record<string, unknown>)
      window.task
        .save(taskId, {}, undefined, json as unknown as Record<string, unknown>)
        .catch((err) => {
          console.warn('[task-tile] acceptance save failed:', err)
        })
    },
    [taskId]
  )

  const runWithDepCheck = useCallback(
    async (actionLabel: string, run: () => void | Promise<void>) => {
      const unsatisfied = await unsatisfiedDependencies(taskId)
      if (unsatisfied.length === 0) {
        await run()
        return
      }
      setDepWarning({
        actionLabel,
        unsatisfied,
        proceed: () => {
          setDepWarning(null)
          void run()
        }
      })
    },
    [taskId]
  )

  const markReviewed = useCallback(async () => {
    await runWithDepCheck('Mark Reviewed', async () => {
      await window.task.save(taskId, { manualReviewDone: true })
      reloadDerivedState()
    })
  }, [taskId, reloadDerivedState, runWithDepCheck])

  const unmarkReviewed = useCallback(async () => {
    await window.task.save(taskId, { manualReviewDone: false })
    reloadDerivedState()
  }, [taskId, reloadDerivedState])

  const acceptanceMarkdown = useMemo(
    () => tiptapDocToMarkdown(acceptanceDoc ?? { type: 'doc', content: [] }),
    [acceptanceDoc]
  )

  const reclassify = useCallback(async () => {
    setClassifyBusy(true)
    try {
      const res = await window.task.classify(intent, acceptanceMarkdown)
      if (res.ok && res.result) {
        setReclassifyProposal({
          classification: res.result.classification,
          rationale: res.result.rationale ?? undefined
        })
      }
    } finally {
      setClassifyBusy(false)
    }
  }, [intent, acceptanceMarkdown])

  const confirmReclassify = useCallback(async () => {
    if (!reclassifyProposal) return
    const next = reclassifyProposal.classification
    setReclassifyProposal(null)
    await window.task.save(taskId, { classification: next })
    const file = await window.task.load(taskId)
    if (file) setMeta(file.meta)
    reloadDerivedState()
  }, [taskId, reclassifyProposal, reloadDerivedState])

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
    await runWithDepCheck('Spawn Plan', async () => {
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
    })
  }, [meta, intent, acceptanceMarkdown, taskId, reloadDerivedState, runWithDepCheck])

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
    await runWithDepCheck('Spawn Terminal', async () => {
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
    })
  }, [meta, taskId, reloadDerivedState, runWithDepCheck])

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
    if (meta.classification === 'BENCHMARK') {
      items.push({
        label: 'Harness as Benchmark…',
        onClick: () => setHarnessOpen(true)
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
          {meta.classification === 'BENCHMARK' && (
            <ActionButton accent="#3b82f6" onClick={() => setHarnessOpen(true)}>
              ▸ Harness as Benchmark
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
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 120 }}>
          <div style={sectionLabelStyle}>Acceptance criteria</div>
          {acceptanceDoc && (
            <TaskTileAcceptanceEditor
              taskId={taskId}
              initialContent={acceptanceDoc}
              editable={true}
              onChange={saveAcceptanceDoc}
            />
          )}
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
      {depWarning && (
        <DependencyWarningModal
          actionLabel={depWarning.actionLabel}
          unsatisfied={depWarning.unsatisfied}
          onProceed={depWarning.proceed}
          onCancel={() => setDepWarning(null)}
        />
      )}
      {harnessOpen && meta && (
        <HarnessBenchmarkModal
          taskId={taskId}
          taskLabel={meta.label}
          inheritedAcceptance={acceptanceMarkdown}
          onClose={() => setHarnessOpen(false)}
          onCreated={() => {
            // onCreated: the benchmark tile auto-appears via canvas:benchmark-open.
            // No further work from this tile; an executing-in edge is drawn.
            reloadDerivedState()
          }}
        />
      )}
      {reclassifyProposal && (
        <ReclassifyConfirmModal
          proposed={reclassifyProposal.classification}
          rationale={reclassifyProposal.rationale}
          onConfirm={confirmReclassify}
          onCancel={() => setReclassifyProposal(null)}
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

// Lossy one-way TipTap doc -> markdown, used only by the three consumers that
// need a text payload (reclassify, spawn-plan, copy-prompt). Writes go through
// the editor as TipTap JSON directly.
function tiptapDocToMarkdown(doc: Record<string, unknown>): string {
  try {
    const content = (doc as { content?: Array<Record<string, unknown>> }).content ?? []
    const lines: string[] = []

    const textOf = (n: Record<string, unknown>): string => {
      const inner = (n as { content?: Array<Record<string, unknown>> }).content ?? []
      return inner
        .map((c) => {
          const ct = (c as { type?: string }).type
          if (ct === 'text') return (c as { text?: string }).text ?? ''
          return textOf(c)
        })
        .join('')
    }

    for (const node of content) {
      const t = (node as { type?: string }).type
      if (t === 'heading') {
        const level = ((node as { attrs?: { level?: number } }).attrs?.level ?? 1)
        lines.push(`${'#'.repeat(Math.max(1, Math.min(6, level)))} ${textOf(node)}`)
      } else if (t === 'codeBlock') {
        lines.push('```', textOf(node), '```')
      } else if (t === 'bulletList' || t === 'orderedList' || t === 'taskList') {
        const items = (node as { content?: Array<Record<string, unknown>> }).content ?? []
        let idx = 1
        for (const li of items) {
          const liText = textOf(li).trim()
          if (t === 'taskList') {
            const checked = (li as { attrs?: { checked?: boolean } }).attrs?.checked
            lines.push(`- [${checked ? 'x' : ' '}] ${liText}`)
          } else if (t === 'orderedList') {
            lines.push(`${idx}. ${liText}`)
            idx++
          } else {
            lines.push(`- ${liText}`)
          }
        }
      } else if (t === 'paragraph') {
        const s = textOf(node)
        if (s) lines.push(s)
      }
    }
    return lines.join('\n')
  } catch {
    return ''
  }
}
