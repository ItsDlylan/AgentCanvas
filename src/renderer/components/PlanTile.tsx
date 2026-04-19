import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NodeResizer } from '@xyflow/react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { usePlan, stateVisuals, latestVersion, displayVersion, approvedVersion, unresolvedQuestionsCount } from '@/hooks/usePlans'
import type { PlanStep, PlanOpenQuestion, PlanState } from '../../preload/index'

const SAVE_DEBOUNCE_MS = 600

interface NodeProps {
  id: string
  data: {
    sessionId: string
    label: string
    linkedTerminalId?: string
  }
  selected?: boolean
}

export const PlanTile = memo(function PlanTile({ id, data, selected }: NodeProps) {
  const { doc, loading, reload } = usePlan(data.sessionId)

  const [expanded, setExpanded] = useState<{
    risks: boolean
    open_questions: boolean
    deviations: boolean
    versions: boolean
  }>({ risks: false, open_questions: true, deviations: false, versions: false })

  const [model, setModel] = useState<'sonnet' | 'opus'>('sonnet')
  const [busy, setBusy] = useState<string | null>(null)

  const vis = doc ? stateVisuals(doc.meta.state) : stateVisuals('draft')
  const latest = doc ? latestVersion(doc) : null
  const shown = doc ? displayVersion(doc) : null
  const approved = doc ? approvedVersion(doc) : null
  const isLocked = !!(doc && (doc.meta.state === 'approved' || doc.meta.state === 'executing' || doc.meta.state === 'done'))
  const unresolved = doc ? unresolvedQuestionsCount(doc) : 0

  // ── TipTap editors for prose fields ──

  const problemEditor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: 'What problem does this plan solve?' })
    ],
    content: '',
    editable: !isLocked,
    editorProps: { attributes: { class: 'outline-none min-h-[60px] text-sm' } }
  })

  const approachEditor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: 'High-level strategy...' })
    ],
    content: '',
    editable: !isLocked,
    editorProps: { attributes: { class: 'outline-none min-h-[80px] text-sm' } }
  })

  // Load content into editors when plan loads/changes
  useEffect(() => {
    if (!problemEditor || !shown) return
    const content = shown.plan.problem_statement
    try {
      problemEditor.commands.setContent(content as object)
    } catch {
      problemEditor.commands.setContent('')
    }
  }, [problemEditor, shown?.version])

  useEffect(() => {
    if (!approachEditor || !shown) return
    const content = shown.plan.approach
    try {
      approachEditor.commands.setContent(content as object)
    } catch {
      approachEditor.commands.setContent('')
    }
  }, [approachEditor, shown?.version])

  useEffect(() => {
    if (problemEditor) problemEditor.setEditable(!isLocked)
    if (approachEditor) approachEditor.setEditable(!isLocked)
  }, [problemEditor, approachEditor, isLocked])

  // ── Save helpers ──

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleSave = useCallback(
    (patch: Record<string, unknown>) => {
      if (!doc) return
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(async () => {
        saveTimer.current = null
        await window.plan.update(doc.meta.planId, patch)
      }, SAVE_DEBOUNCE_MS)
    },
    [doc]
  )

  useEffect(() => {
    if (!problemEditor || !doc) return
    const h = () => scheduleSave({ problem_statement: problemEditor.getJSON() })
    problemEditor.on('update', h)
    return () => {
      problemEditor.off('update', h)
    }
  }, [problemEditor, doc, scheduleSave])

  useEffect(() => {
    if (!approachEditor || !doc) return
    const h = () => scheduleSave({ approach: approachEditor.getJSON() })
    approachEditor.on('update', h)
    return () => {
      approachEditor.off('update', h)
    }
  }, [approachEditor, doc, scheduleSave])

  const withBusy = useCallback(async <T,>(key: string, fn: () => Promise<T>): Promise<T | undefined> => {
    if (busy) return
    setBusy(key)
    try {
      return await fn()
    } finally {
      setBusy(null)
      reload()
    }
  }, [busy, reload])

  // ── Action handlers ──

  const onVerify = () => withBusy('verify', () => window.plan.verify(data.sessionId, model))
  const onApprove = () => withBusy('approve', () => window.plan.approve(data.sessionId))
  const onUnapprove = () => withBusy('unapprove', () => window.plan.unapprove(data.sessionId))
  const onExecute = () => withBusy('execute', () => window.plan.execute(data.sessionId))
  const onResume = () => withBusy('resume', () => window.plan.resume(data.sessionId))
  const onArchive = () => withBusy('archive', () => window.plan.archive(data.sessionId))
  const onMarkDone = () => withBusy('done', () => window.plan.markDone(data.sessionId))

  const steps = shown?.plan.steps ?? []
  const stepsDone = steps.filter((s) => s.status === 'done' || s.status === 'skipped').length

  // ── Step editing ──

  const mutateSteps = (updater: (prev: PlanStep[]) => PlanStep[]) => {
    if (!doc || !latest) return
    const nextSteps = updater(latest.plan.steps)
    scheduleSave({ steps: nextSteps })
  }

  const addStep = () => {
    mutateSteps((prev) => [
      ...prev,
      { id: `s_${Math.random().toString(36).slice(2, 10)}`, text: '', status: 'pending' }
    ])
  }

  const updateStepText = (stepId: string, text: string) => {
    mutateSteps((prev) => prev.map((s) => (s.id === stepId ? { ...s, text } : s)))
  }

  const toggleStep = (stepId: string) => {
    mutateSteps((prev) =>
      prev.map((s) =>
        s.id === stepId
          ? { ...s, status: s.status === 'done' ? 'pending' : 'done' }
          : s
      )
    )
  }

  const removeStep = (stepId: string) => {
    mutateSteps((prev) => prev.filter((s) => s.id !== stepId))
  }

  // ── Open questions ──

  const mutateQuestions = (updater: (prev: PlanOpenQuestion[]) => PlanOpenQuestion[]) => {
    if (!latest) return
    scheduleSave({ open_questions: updater(latest.plan.open_questions) })
  }

  const addQuestion = () => {
    mutateQuestions((prev) => [
      ...prev,
      { id: `q_${Math.random().toString(36).slice(2, 10)}`, text: '' }
    ])
  }

  const updateQuestionText = (qid: string, text: string) => {
    mutateQuestions((prev) => prev.map((q) => (q.id === qid ? { ...q, text } : q)))
  }

  const updateQuestionResolution = (qid: string, resolution: string) => {
    mutateQuestions((prev) => prev.map((q) => (q.id === qid ? { ...q, resolution } : q)))
  }

  const removeQuestion = (qid: string) => {
    mutateQuestions((prev) => prev.filter((q) => q.id !== qid))
  }

  // ── Risks ──

  const updateRisk = (index: number, text: string) => {
    if (!latest) return
    const next = [...latest.plan.risks]
    next[index] = text
    scheduleSave({ risks: next })
  }

  const addRisk = () => {
    if (!latest) return
    scheduleSave({ risks: [...latest.plan.risks, ''] })
  }

  const removeRisk = (index: number) => {
    if (!latest) return
    scheduleSave({ risks: latest.plan.risks.filter((_, i) => i !== index) })
  }

  // ── Acceptance criteria ──

  const updateCriteria = (text: string) => {
    scheduleSave({ acceptance_criteria: text })
  }

  if (loading || !doc || !shown || !latest) {
    return (
      <div className={`rounded-lg border-2 bg-zinc-950 text-zinc-400 p-4 ${selected ? 'ring-2 ring-blue-400' : ''}`}>
        <div className="text-sm">Loading plan...</div>
      </div>
    )
  }

  const canVerify = doc.meta.state === 'draft' || doc.meta.state === 'needs_revision'
  const canApprove = (doc.meta.state === 'verified' || doc.meta.state === 'needs_revision') && unresolved === 0
  const canExecute = doc.meta.state === 'approved'
  const canResume = doc.meta.state === 'execution_failed' || doc.meta.state === 'paused_needs_replan'
  const canMarkDone = doc.meta.state === 'executing'

  return (
    <div
      className={`plan-tile rounded-lg border-2 bg-zinc-950 text-zinc-100 flex flex-col overflow-hidden ${vis.borderClass} ${selected ? 'ring-2 ring-blue-400' : ''}`}
      style={{ width: '100%', height: '100%' }}
    >
      <NodeResizer minWidth={360} minHeight={300} isVisible={!!selected} lineClassName="!border-zinc-500" handleClassName="!bg-zinc-500 !border-zinc-300" />

      {/* Header (drag handle) */}
      <div className="plan-tile-header flex items-center gap-2 px-3 py-2 border-b border-zinc-800 bg-zinc-900/70 cursor-move select-none">
        <div className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${vis.badgeClass}`}>{vis.label}</div>
        <div className="flex-1 text-sm font-medium truncate">{doc.meta.label}</div>
        <div className="text-[10px] text-zinc-500">v{shown.version}{approved && approved.version === shown.version ? ' · locked' : ''}</div>
      </div>

      {/* Action bar */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-zinc-800 bg-zinc-900/40 flex-wrap">
        <button
          className="px-2 py-1 text-xs rounded bg-blue-700 text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-blue-600"
          disabled={!canVerify || !!busy}
          onClick={onVerify}
        >
          {busy === 'verify' ? '…' : 'Verify'}
        </button>
        <select
          value={model}
          onChange={(e) => setModel(e.target.value as 'sonnet' | 'opus')}
          className="text-[10px] bg-zinc-800 border border-zinc-700 rounded px-1 py-0.5 text-zinc-300"
          title="Verifier model"
        >
          <option value="sonnet">sonnet</option>
          <option value="opus">opus</option>
        </select>
        {doc.meta.state === 'approved' ? (
          <button
            className="px-2 py-1 text-xs rounded bg-zinc-700 text-white hover:bg-zinc-600"
            disabled={!!busy}
            onClick={onUnapprove}
          >
            Unapprove
          </button>
        ) : (
          <button
            className="px-2 py-1 text-xs rounded bg-green-700 text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-green-600"
            disabled={!canApprove || !!busy}
            onClick={onApprove}
            title={unresolved > 0 ? `${unresolved} open question(s) unresolved` : ''}
          >
            {busy === 'approve' ? '…' : 'Approve'}
          </button>
        )}
        {canResume ? (
          <button
            className="px-2 py-1 text-xs rounded bg-amber-700 text-white hover:bg-amber-600"
            disabled={!!busy}
            onClick={onResume}
          >
            {busy === 'resume' ? '…' : 'Resume'}
          </button>
        ) : (
          <button
            className="px-2 py-1 text-xs rounded bg-green-800 text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-green-700"
            disabled={!canExecute || !!busy}
            onClick={onExecute}
          >
            {busy === 'execute' ? '…' : 'Execute'}
          </button>
        )}
        {canMarkDone && (
          <button
            className="px-2 py-1 text-xs rounded bg-zinc-700 text-white hover:bg-zinc-600"
            disabled={!!busy}
            onClick={onMarkDone}
          >
            Mark done
          </button>
        )}
        <div className="flex-1" />
        <button
          className="px-2 py-1 text-[10px] rounded bg-zinc-800 text-zinc-400 hover:text-zinc-200"
          disabled={!!busy}
          onClick={onArchive}
          title="Archive"
        >
          ⧖
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-3 text-xs space-y-3 nowheel nodrag">
        <section>
          <div className="text-[10px] uppercase text-zinc-500 mb-1 tracking-wide">Problem</div>
          <div className="border border-zinc-800 rounded px-2 py-1.5 bg-zinc-900/40">
            <EditorContent editor={problemEditor} />
          </div>
        </section>

        <section>
          <div className="text-[10px] uppercase text-zinc-500 mb-1 tracking-wide">Approach</div>
          <div className="border border-zinc-800 rounded px-2 py-1.5 bg-zinc-900/40">
            <EditorContent editor={approachEditor} />
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between mb-1">
            <div className="text-[10px] uppercase text-zinc-500 tracking-wide">
              Steps {steps.length > 0 && <span className="text-zinc-400 normal-case">({stepsDone}/{steps.length} done)</span>}
            </div>
            {!isLocked && (
              <button className="text-[10px] text-zinc-400 hover:text-zinc-200" onClick={addStep}>+ add</button>
            )}
          </div>
          {steps.length === 0 && (
            <div className="text-[11px] text-zinc-600 italic">No steps yet.</div>
          )}
          <ul className="space-y-1">
            {steps.map((s) => (
              <li key={s.id} className="flex items-start gap-2 group">
                <input
                  type="checkbox"
                  checked={s.status === 'done'}
                  onChange={() => toggleStep(s.id)}
                  className="mt-0.5 accent-green-500"
                  disabled={!isLocked && false}
                />
                <input
                  className="flex-1 bg-transparent outline-none border-b border-transparent focus:border-zinc-700 text-[12px]"
                  value={s.text}
                  onChange={(e) => updateStepText(s.id, e.target.value)}
                  disabled={isLocked}
                  placeholder="Describe this step..."
                />
                {s.status === 'in-progress' && <span className="text-[9px] text-amber-400">●</span>}
                {!isLocked && (
                  <button
                    className="text-[10px] text-zinc-600 opacity-0 group-hover:opacity-100 hover:text-red-400"
                    onClick={() => removeStep(s.id)}
                  >
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>

        <CollapsibleSection
          title={`Risks (${latest.plan.risks.length})`}
          expanded={expanded.risks}
          onToggle={() => setExpanded((e) => ({ ...e, risks: !e.risks }))}
        >
          {latest.plan.risks.map((r, i) => (
            <div key={i} className="flex items-center gap-2 mb-1 group">
              <span className="text-zinc-500">•</span>
              <input
                className="flex-1 bg-transparent outline-none border-b border-transparent focus:border-zinc-700 text-[12px]"
                value={r}
                onChange={(e) => updateRisk(i, e.target.value)}
                disabled={isLocked}
                placeholder="Risk description..."
              />
              {!isLocked && (
                <button
                  className="text-[10px] text-zinc-600 opacity-0 group-hover:opacity-100 hover:text-red-400"
                  onClick={() => removeRisk(i)}
                >
                  ×
                </button>
              )}
            </div>
          ))}
          {!isLocked && (
            <button className="text-[10px] text-zinc-400 hover:text-zinc-200 mt-1" onClick={addRisk}>
              + add risk
            </button>
          )}
        </CollapsibleSection>

        <CollapsibleSection
          title={`Open Questions (${latest.plan.open_questions.filter(q => q.resolution).length}/${latest.plan.open_questions.length} resolved)`}
          expanded={expanded.open_questions}
          onToggle={() => setExpanded((e) => ({ ...e, open_questions: !e.open_questions }))}
          titleClass={unresolved > 0 ? 'text-amber-400' : ''}
        >
          {latest.plan.open_questions.map((q) => (
            <div key={q.id} className="mb-2 group">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-zinc-500">?</span>
                <input
                  className="flex-1 bg-transparent outline-none border-b border-transparent focus:border-zinc-700 text-[12px]"
                  value={q.text}
                  onChange={(e) => updateQuestionText(q.id, e.target.value)}
                  disabled={isLocked}
                  placeholder="Question..."
                />
                {!isLocked && (
                  <button
                    className="text-[10px] text-zinc-600 opacity-0 group-hover:opacity-100 hover:text-red-400"
                    onClick={() => removeQuestion(q.id)}
                  >
                    ×
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2 ml-4">
                <span className="text-zinc-500 text-[10px]">→</span>
                <input
                  className="flex-1 bg-transparent outline-none border-b border-transparent focus:border-zinc-700 text-[11px] text-zinc-300"
                  value={q.resolution ?? ''}
                  onChange={(e) => updateQuestionResolution(q.id, e.target.value)}
                  disabled={isLocked}
                  placeholder="Answer... (required for Approve)"
                />
              </div>
            </div>
          ))}
          {!isLocked && (
            <button className="text-[10px] text-zinc-400 hover:text-zinc-200 mt-1" onClick={addQuestion}>
              + add question
            </button>
          )}
        </CollapsibleSection>

        <CollapsibleSection
          title={`Deviations (${doc.deviations.length})`}
          expanded={expanded.deviations}
          onToggle={() => setExpanded((e) => ({ ...e, deviations: !e.deviations }))}
        >
          {doc.deviations.length === 0 && (
            <div className="text-[11px] text-zinc-600 italic">No deviations.</div>
          )}
          {doc.deviations.map((d, i) => (
            <div key={i} className="mb-2 p-2 rounded border border-amber-800/40 bg-amber-950/20">
              <div className="text-[10px] text-zinc-400 mb-1">
                Step <code className="text-amber-400">{d.stepId}</code> · {new Date(d.timestamp).toLocaleString()}
              </div>
              <div className="text-[11px] text-zinc-200 mb-1"><span className="text-zinc-500">Reason:</span> {d.reason}</div>
              <div className="text-[11px] text-zinc-300"><span className="text-zinc-500">Proposed:</span> {d.proposed_change}</div>
            </div>
          ))}
        </CollapsibleSection>

        <CollapsibleSection
          title={`Versions (${doc.versions.length}) · Critiques (${doc.critiqueNoteIds.length})`}
          expanded={expanded.versions}
          onToggle={() => setExpanded((e) => ({ ...e, versions: !e.versions }))}
        >
          {doc.versions.map((v) => (
            <div key={v.version} className="text-[11px] text-zinc-400 mb-0.5">
              v{v.version} · {new Date(v.timestamp).toLocaleString()} · {v.author}
              {doc.meta.approvedVersion === v.version && <span className="ml-1 text-green-400">(approved)</span>}
            </div>
          ))}
          {doc.critiqueNoteIds.length > 0 && (
            <div className="mt-2 pt-2 border-t border-zinc-800">
              <div className="text-[10px] uppercase text-zinc-500 mb-1">Critiques</div>
              {doc.critiqueNoteIds.map((c, i) => (
                <div key={i} className="text-[11px] text-zinc-400">
                  v{c.version} · severity: <span className={c.verdict.severity === 'major' ? 'text-red-400' : c.verdict.severity === 'minor' ? 'text-amber-400' : 'text-green-400'}>{c.verdict.severity}</span> · {c.verdict.findings.length} finding(s)
                </div>
              ))}
            </div>
          )}
        </CollapsibleSection>

        <section>
          <div className="text-[10px] uppercase text-zinc-500 mb-1 tracking-wide">Acceptance Criteria</div>
          <textarea
            className="w-full bg-zinc-900/40 border border-zinc-800 rounded p-1.5 text-[12px] outline-none focus:border-zinc-700 resize-none"
            value={latest.plan.acceptance_criteria}
            onChange={(e) => updateCriteria(e.target.value)}
            rows={2}
            disabled={isLocked}
            placeholder="Definition of done..."
          />
        </section>

        {doc.meta.linkedPR && (
          <section className="text-[11px] text-zinc-400">
            <span className="text-zinc-500">PR:</span> {doc.meta.linkedPR}
          </section>
        )}
      </div>
    </div>
  )
})

function CollapsibleSection({
  title,
  expanded,
  onToggle,
  children,
  titleClass = ''
}: {
  title: string
  expanded: boolean
  onToggle: () => void
  children: React.ReactNode
  titleClass?: string
}): JSX.Element {
  return (
    <section>
      <button
        onClick={onToggle}
        className={`text-[10px] uppercase tracking-wide flex items-center gap-1 hover:text-zinc-200 ${titleClass || 'text-zinc-500'}`}
      >
        <span>{expanded ? '▾' : '▸'}</span>
        {title}
      </button>
      {expanded && <div className="mt-1 pl-2">{children}</div>}
    </section>
  )
}
