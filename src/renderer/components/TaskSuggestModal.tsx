import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TaskClassification, TaskTimeline } from '../../preload/index'
import { useCanvasStore } from '@/store/canvas-store'

type TemplateKind =
  | 'web-page-load'
  | 'api-latency'
  | 'bundle-size'
  | 'test-suite-time'
  | 'pure-function'

type ChatMessage = { role: 'user' | 'assistant'; content: string }

type BenchmarkProposal = {
  kind: 'benchmark'
  label: string
  intent: string
  acceptanceCriteria: string
  templateKind: TemplateKind
  targetFiles?: string[]
  targetUrl?: string
  noiseClass: 'low' | 'medium' | 'high'
  higherIsBetter: boolean
  rationale: string
}

type GenericProposal = {
  kind: 'generic'
  label: string
  intent: string
  acceptanceCriteria: string
  classification: TaskClassification
  timelinePressure: TaskTimeline
  rationale: string
}

export type Proposal = BenchmarkProposal | GenericProposal

export interface TaskSuggestModalProps {
  classification: TaskClassification
  onClose: () => void
  /** If set, modal is in "draft from existing task" mode — commit patches that task in place. */
  draftFromTaskId?: string
  /** If set, modal is in "fill-form" mode — commit calls this callback with the proposal instead of persisting. */
  onProposal?: (proposal: Proposal) => void
  /** If set AND onProposal is not, modal persists a new task and calls this with the new id. */
  onCreated?: (taskId: string) => void
  existingLabel?: string
  existingIntent?: string
  existingAcceptance?: string
  /** Which workspace the task should be designed for. Falls back to the canvas's active workspace. */
  defaultWorkspaceId?: string
}

export function TaskSuggestModal(props: TaskSuggestModalProps): JSX.Element {
  const { classification, onClose, draftFromTaskId, onProposal, onCreated, defaultWorkspaceId } = props

  const workspaces = useCanvasStore((s) => s.workspaces)
  const activeWorkspaceId = useCanvasStore((s) => s.activeWorkspaceId)

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [workspaceId, setWorkspaceId] = useState<string>(
    defaultWorkspaceId || activeWorkspaceId || (workspaces[0]?.id ?? 'default')
  )
  const [awaiting, setAwaiting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [committing, setCommitting] = useState(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const selectedWorkspace = useMemo(
    () => workspaces.find((w) => w.id === workspaceId) ?? null,
    [workspaces, workspaceId]
  )
  const repoPath = selectedWorkspace?.path ?? ''

  // Auto-scroll to bottom when messages change.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, awaiting, proposal])

  const isBench = classification === 'BENCHMARK'

  const sendTurn = useCallback(
    async (userContent: string) => {
      if (!userContent.trim()) return
      setError(null)
      const nextMessages: ChatMessage[] = [
        ...messages,
        { role: 'user', content: userContent.trim() }
      ]
      setMessages(nextMessages)
      setInput('')
      setAwaiting(true)
      try {
        const res = await window.task.suggest({
          classification,
          messages: nextMessages,
          repoPath: repoPath ? repoPath.trim() : undefined,
          draftFromTaskId,
          existingLabel: props.existingLabel,
          existingIntent: props.existingIntent,
          existingAcceptance: props.existingAcceptance
        })
        if (!res.ok || !res.reply) {
          setError(res.error || 'Claude did not return a valid response.')
          setAwaiting(false)
          return
        }
        if (res.reply.kind === 'message') {
          setMessages((prev) => [...prev, { role: 'assistant', content: res.reply!.kind === 'message' ? (res.reply as { content: string }).content : '' }])
        } else {
          setProposal(res.reply.proposal as Proposal)
          setMessages((prev) => [
            ...prev,
            {
              role: 'assistant',
              content:
                `**Proposed task:** ${(res.reply.proposal as Proposal).label}\n\n*${(res.reply.proposal as Proposal).rationale || 'No rationale provided.'}*`
            }
          ])
        }
      } catch (err) {
        setError((err as Error).message || String(err))
      } finally {
        setAwaiting(false)
      }
    },
    [classification, messages, repoPath, draftFromTaskId, props.existingLabel, props.existingIntent, props.existingAcceptance]
  )

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        sendTurn(input)
      }
    },
    [input, sendTurn]
  )

  const patchProposal = useCallback((patch: Partial<Proposal>) => {
    setProposal((prev) => (prev ? ({ ...prev, ...patch } as Proposal) : prev))
  }, [])

  const finalize = useCallback(async () => {
    if (!proposal) return
    setError(null)
    // Mode 1: caller wants to fill a form, not persist.
    if (onProposal) {
      onProposal(proposal)
      onClose()
      return
    }
    // Mode 2: entry point B — patch an existing task.
    if (draftFromTaskId) {
      setCommitting(true)
      try {
        const res = await window.task.applyMarkdownDraft({
          taskId: draftFromTaskId,
          label: proposal.label,
          intent: proposal.intent,
          acceptanceMarkdown: proposal.acceptanceCriteria,
          classification: proposal.kind === 'benchmark' ? 'BENCHMARK' : proposal.classification
        })
        if (!res.ok) {
          setError(res.error || 'Could not apply draft.')
          setCommitting(false)
          return
        }
        onCreated?.(draftFromTaskId)
        onClose()
      } catch (err) {
        setError((err as Error).message || String(err))
        setCommitting(false)
      }
      return
    }
    // Mode 3: create a new task directly.
    setCommitting(true)
    try {
      const res = await window.task.create({
        label: proposal.label,
        intent: proposal.intent,
        acceptanceCriteria: proposal.acceptanceCriteria,
        classification: proposal.kind === 'benchmark' ? 'BENCHMARK' : proposal.classification,
        timelinePressure: proposal.kind === 'generic' ? proposal.timelinePressure : undefined,
        workspaceId
      })
      if (!res.ok || !res.taskId) {
        setError(res.error || 'Could not create task.')
        setCommitting(false)
        return
      }
      onCreated?.(res.taskId)
      onClose()
    } catch (err) {
      setError((err as Error).message || String(err))
      setCommitting(false)
    }
  }, [proposal, onProposal, onClose, draftFromTaskId, onCreated, workspaceId])

  const keepChatting = useCallback(() => {
    setProposal(null)
  }, [])

  const placeholder = useMemo(() => {
    if (messages.length === 0) {
      return isBench
        ? `e.g. "The markdown-to-tiptap conversion feels slow on large documents"`
        : `e.g. "We need to audit who can delete user accounts"`
    }
    return 'Reply…'
  }, [messages.length, isBench])

  return (
    <div onClick={onClose} style={backdropStyle}>
      <div onClick={(e) => e.stopPropagation()} style={panelStyle}>
        <header style={headerStyle}>
          <div style={kickerStyle}>✨ AI Task Draft {isBench && '— Benchmark'}</div>
          <div style={titleStyle}>
            {draftFromTaskId ? 'Refine this task with Claude' : 'Chat with Claude to design your task'}
          </div>
          <div style={hintStyle}>
            Classification: <strong style={{ color: '#e6e7ea' }}>{classification}</strong>. Pick which workspace to design this task for — Claude will read/grep inside that workspace's folder, and the task tile will spawn there.
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
            <select
              style={{ ...inputStyle, fontSize: 11, padding: '4px 6px', flex: 1 }}
              value={workspaceId}
              onChange={(e) => setWorkspaceId(e.target.value)}
            >
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}{w.path ? ` — ${w.path}` : ' — (no folder)'}
                </option>
              ))}
            </select>
          </div>
          {!selectedWorkspace?.path && (
            <div style={{ ...hintStyle, color: '#fbbf24', marginTop: 6 }}>
              This workspace has no folder set — Claude won't be able to investigate code. Set a path in the Workspace Panel, or switch workspace.
            </div>
          )}
        </header>

        <div style={chatScrollStyle} ref={scrollRef}>
          {messages.length === 0 && (
            <div style={emptyHintStyle}>
              Describe what you want to benchmark or plan — Claude will ask follow-up questions if it needs more info, then emit a proposal.
            </div>
          )}
          {messages.map((m, i) => (
            <MessageBubble key={i} role={m.role} content={m.content} />
          ))}
          {awaiting && (
            <div style={{ ...assistantBubble, display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={smallSpinner} />
              <span style={{ color: '#9ca3af' }}>Claude is thinking…</span>
            </div>
          )}
          {proposal && (
            <div style={proposalCardStyle}>
              <div style={{ fontSize: 10, color: '#a855f7', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>
                Proposal ready
              </div>
              <Field label="Label">
                <input
                  style={inputStyle}
                  value={proposal.label}
                  onChange={(e) => patchProposal({ label: e.target.value } as Partial<Proposal>)}
                />
              </Field>
              <Field label="Intent (markdown)">
                <textarea
                  style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }}
                  value={proposal.intent}
                  onChange={(e) => patchProposal({ intent: e.target.value } as Partial<Proposal>)}
                />
              </Field>
              <Field label="Acceptance criteria (markdown)">
                <textarea
                  style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }}
                  value={proposal.acceptanceCriteria}
                  onChange={(e) => patchProposal({ acceptanceCriteria: e.target.value } as Partial<Proposal>)}
                />
              </Field>
              {proposal.kind === 'benchmark' ? (
                <BenchmarkExtras proposal={proposal} patch={patchProposal} />
              ) : (
                <GenericExtras proposal={proposal} patch={patchProposal} />
              )}
            </div>
          )}
          {error && <div style={errorBoxStyle}>{error}</div>}
        </div>

        <footer style={footerStyle}>
          {!proposal && (
            <>
              <textarea
                style={{ ...inputStyle, minHeight: 50, resize: 'vertical', flex: 1 }}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder={placeholder}
                autoFocus
                disabled={awaiting}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <button
                  style={buttonStyle('#a855f7')}
                  onClick={() => sendTurn(input)}
                  disabled={awaiting || !input.trim()}
                  type="button"
                >
                  {messages.length === 0 ? 'Start' : 'Send'}
                </button>
                <button style={buttonStyle()} onClick={onClose} type="button">
                  Close
                </button>
              </div>
            </>
          )}
          {proposal && (
            <div style={{ display: 'flex', gap: 8, width: '100%', justifyContent: 'flex-end' }}>
              <button style={buttonStyle()} onClick={keepChatting} disabled={committing} type="button">
                ← Keep chatting
              </button>
              <button style={buttonStyle()} onClick={onClose} disabled={committing} type="button">
                Cancel
              </button>
              <button style={buttonStyle('#22c55e')} onClick={finalize} disabled={committing} type="button">
                {committing
                  ? 'Applying…'
                  : onProposal
                    ? 'Use this draft'
                    : draftFromTaskId
                      ? 'Apply draft'
                      : 'Create task'}
              </button>
            </div>
          )}
        </footer>
      </div>
    </div>
  )
}

function MessageBubble({ role, content }: { role: 'user' | 'assistant'; content: string }): JSX.Element {
  return (
    <div style={role === 'user' ? userBubble : assistantBubble}>
      <div style={bubbleRoleStyle}>{role === 'user' ? 'You' : 'Claude'}</div>
      <div style={{ whiteSpace: 'pre-wrap' }}>{content}</div>
    </div>
  )
}

function BenchmarkExtras({
  proposal,
  patch
}: {
  proposal: BenchmarkProposal
  patch: (p: Partial<Proposal>) => void
}): JSX.Element {
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Template">
          <select
            style={inputStyle}
            value={proposal.templateKind}
            onChange={(e) => patch({ templateKind: e.target.value as TemplateKind } as Partial<Proposal>)}
          >
            <option value="pure-function">pure-function (ns/op)</option>
            <option value="web-page-load">web-page-load (LCP/TTI/FCP)</option>
            <option value="api-latency">api-latency (p50/p95 ms)</option>
            <option value="bundle-size">bundle-size (gzip bytes)</option>
            <option value="test-suite-time">test-suite-time (seconds)</option>
          </select>
        </Field>
        <Field label="Noise class">
          <select
            style={inputStyle}
            value={proposal.noiseClass}
            onChange={(e) => patch({ noiseClass: e.target.value as BenchmarkProposal['noiseClass'] } as Partial<Proposal>)}
          >
            <option value="low">low (deterministic)</option>
            <option value="medium">medium</option>
            <option value="high">high (flaky)</option>
          </select>
        </Field>
      </div>
      {proposal.templateKind === 'web-page-load' ? (
        <Field label="Target URL">
          <input
            style={inputStyle}
            value={proposal.targetUrl || ''}
            onChange={(e) => patch({ targetUrl: e.target.value } as Partial<Proposal>)}
            placeholder="https://example.com"
          />
        </Field>
      ) : (
        <Field label="Target files (comma-separated, optional)">
          <input
            style={inputStyle}
            value={(proposal.targetFiles || []).join(', ')}
            onChange={(e) =>
              patch({
                targetFiles: e.target.value.split(',').map((s) => s.trim()).filter(Boolean)
              } as Partial<Proposal>)
            }
          />
        </Field>
      )}
      <Field label="Direction">
        <label style={checkboxRow}>
          <input
            type="checkbox"
            checked={proposal.higherIsBetter}
            onChange={(e) => patch({ higherIsBetter: e.target.checked } as Partial<Proposal>)}
          />
          Higher score is better
        </label>
      </Field>
    </>
  )
}

function GenericExtras({
  proposal,
  patch
}: {
  proposal: GenericProposal
  patch: (p: Partial<Proposal>) => void
}): JSX.Element {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      <Field label="Classification">
        <select
          style={inputStyle}
          value={proposal.classification}
          onChange={(e) => patch({ classification: e.target.value as TaskClassification } as Partial<Proposal>)}
        >
          <option value="QUICK">QUICK</option>
          <option value="NEEDS_RESEARCH">NEEDS_RESEARCH</option>
          <option value="DEEP_FOCUS">DEEP_FOCUS</option>
          <option value="BENCHMARK">BENCHMARK</option>
        </select>
      </Field>
      <Field label="Timeline">
        <select
          style={inputStyle}
          value={proposal.timelinePressure}
          onChange={(e) => patch({ timelinePressure: e.target.value as TaskTimeline } as Partial<Proposal>)}
        >
          <option value="urgent">urgent</option>
          <option value="this-week">this-week</option>
          <option value="this-month">this-month</option>
          <option value="whenever">whenever</option>
        </select>
      </Field>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 11, color: '#e6e7ea', fontWeight: 500 }}>{label}</span>
      {children}
    </label>
  )
}

const backdropStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.6)',
  zIndex: 2000,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center'
}

const panelStyle: React.CSSProperties = {
  width: 620,
  maxWidth: '94vw',
  maxHeight: '90vh',
  background: '#1a1b1f',
  border: '1px solid #3a3b42',
  borderRadius: 8,
  boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  fontFamily: 'system-ui, -apple-system, sans-serif'
}

const headerStyle: React.CSSProperties = { padding: '14px 16px', borderBottom: '1px solid #2a2b32' }
const kickerStyle: React.CSSProperties = {
  fontSize: 10,
  color: '#a855f7',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  fontWeight: 600
}
const titleStyle: React.CSSProperties = { fontSize: 15, color: '#e6e7ea', fontWeight: 600, marginTop: 2 }
const hintStyle: React.CSSProperties = { fontSize: 11, color: '#9ca3af', marginTop: 4, lineHeight: 1.4 }
const chatScrollStyle: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: 14,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  background: '#131418'
}
const emptyHintStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#6b7280',
  padding: '20px 10px',
  textAlign: 'center',
  lineHeight: 1.5
}
const userBubble: React.CSSProperties = {
  alignSelf: 'flex-end',
  maxWidth: '86%',
  background: '#1e3a5f',
  border: '1px solid #2e5080',
  padding: '8px 10px',
  borderRadius: 8,
  fontSize: 12,
  color: '#e6e7ea',
  lineHeight: 1.5
}
const assistantBubble: React.CSSProperties = {
  alignSelf: 'flex-start',
  maxWidth: '86%',
  background: '#1a1b1f',
  border: '1px solid #3a3b42',
  padding: '8px 10px',
  borderRadius: 8,
  fontSize: 12,
  color: '#d1d5db',
  lineHeight: 1.5
}
const bubbleRoleStyle: React.CSSProperties = {
  fontSize: 9,
  color: '#6b7280',
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  fontWeight: 600,
  marginBottom: 4
}
const proposalCardStyle: React.CSSProperties = {
  alignSelf: 'stretch',
  background: '#1a1225',
  border: '1px solid #3a2a5a',
  padding: 12,
  borderRadius: 8,
  display: 'flex',
  flexDirection: 'column',
  gap: 10
}
const footerStyle: React.CSSProperties = {
  padding: '10px 12px',
  borderTop: '1px solid #2a2b32',
  display: 'flex',
  gap: 8,
  alignItems: 'stretch',
  background: '#1a1b1f'
}
const inputStyle: React.CSSProperties = {
  width: '100%',
  flex: 1,
  padding: '6px 8px',
  background: '#0f0f12',
  border: '1px solid #2a2b32',
  color: '#e6e7ea',
  borderRadius: 4,
  fontSize: 12,
  fontFamily: 'system-ui, -apple-system, sans-serif'
}
const errorBoxStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#ef4444',
  padding: '8px 10px',
  background: '#2a1a1a',
  border: '1px solid #5a2828',
  borderRadius: 4
}
const checkboxRow: React.CSSProperties = {
  fontSize: 12,
  color: '#e6e7ea',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 0'
}
const smallSpinner: React.CSSProperties = {
  width: 14,
  height: 14,
  border: '2px solid #2a2b32',
  borderTopColor: '#a855f7',
  borderRadius: '50%',
  animation: 'spin 0.9s linear infinite'
}

function buttonStyle(accent?: string): React.CSSProperties {
  return {
    padding: '6px 14px',
    borderRadius: 4,
    background: accent ? `${accent}22` : 'transparent',
    border: `1px solid ${accent ?? '#3a3b42'}`,
    color: accent ?? '#e6e7ea',
    fontSize: 12,
    cursor: 'pointer',
    whiteSpace: 'nowrap'
  }
}
