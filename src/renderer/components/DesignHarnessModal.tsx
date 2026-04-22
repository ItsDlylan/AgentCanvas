import { useCallback, useState } from 'react'

/**
 * Modal for Stage 2 of the benchmark pipeline: spawning a harness-design
 * agent in an isolated worktree. The agent's only job is to draft the
 * evaluator + bench + corpus + golden files and commit them. When the
 * agent finishes, the human clicks "Harness as Benchmark" to start the
 * optimization loop in the same worktree.
 */
export interface DesignHarnessModalProps {
  taskId: string
  taskLabel: string
  inheritedAcceptance: string
  onClose: () => void
  onSpawned: (info: { worktreePath: string; branchName: string; terminalId: string }) => void
}

export function DesignHarnessModal({
  taskId,
  taskLabel,
  inheritedAcceptance,
  onClose,
  onSpawned
}: DesignHarnessModalProps): JSX.Element {
  const [sourceRepoPath, setSourceRepoPath] = useState('')
  const [targetFilesCsv, setTargetFilesCsv] = useState('')
  const [acceptance, setAcceptance] = useState(inheritedAcceptance || '')
  const [noiseClass, setNoiseClass] = useState<'low' | 'medium' | 'high'>('medium')
  const [higherIsBetter, setHigherIsBetter] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pickFolder = useCallback(async () => {
    const picked = await window.workspace.pickDirectory()
    if (picked) setSourceRepoPath(picked)
  }, [])

  const submit = useCallback(async () => {
    setError(null)
    if (!sourceRepoPath.trim()) {
      setError('Source repo path is required.')
      return
    }
    if (!acceptance.trim()) {
      setError('Acceptance criteria cannot be empty — the agent needs to know what to measure.')
      return
    }
    const targetFiles = targetFilesCsv
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)

    setBusy(true)
    try {
      const res = await window.benchmark.designHarness({
        taskId,
        sourceRepoPath: sourceRepoPath.trim(),
        targetFiles,
        acceptanceCriteria: acceptance.trim(),
        noiseClass,
        higherIsBetter
      })
      if (!res.ok) {
        setError(res.error || 'Could not spawn harness-design terminal.')
        setBusy(false)
        return
      }
      onSpawned({
        worktreePath: res.worktreePath!,
        branchName: res.branchName!,
        terminalId: res.terminalId!
      })
      onClose()
    } catch (e) {
      setError((e as Error).message || String(e))
      setBusy(false)
    }
  }, [sourceRepoPath, targetFilesCsv, acceptance, noiseClass, higherIsBetter, taskId, onClose, onSpawned])

  return (
    <div onClick={onClose} style={backdropStyle}>
      <div onClick={(e) => e.stopPropagation()} style={panelStyle}>
        <header style={{ padding: '14px 16px', borderBottom: '1px solid #2a2b32' }}>
          <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Design Harness
          </div>
          <div style={{ fontSize: 15, color: '#e6e7ea', fontWeight: 600, marginTop: 2 }}>{taskLabel}</div>
          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4, lineHeight: 1.4 }}>
            Creates an isolated git worktree and spawns an agent terminal in it.
            The agent writes <code>benchmark/evaluator.sh</code>, bench script,
            corpus, and golden snapshot — then commits and exits. You review,
            then click <em>Harness as Benchmark</em> to start the optimization loop.
          </div>
        </header>

        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Field label="Source repo path" hint="Contains .git. The worktree is auto-created next to it at ../<repo>-worktrees/bench-<id>.">
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                style={inputStyle}
                value={sourceRepoPath}
                onChange={(e) => setSourceRepoPath(e.target.value)}
                placeholder="/Users/you/dev/my-repo"
              />
              <button style={buttonStyle('#3b82f6')} onClick={pickFolder} type="button">Pick…</button>
            </div>
          </Field>

          <Field label="Target files (comma-separated, optional)" hint="The files whose performance the benchmark should measure. Agent won't edit these — it only writes the harness.">
            <input
              style={inputStyle}
              value={targetFilesCsv}
              onChange={(e) => setTargetFilesCsv(e.target.value)}
              placeholder="src/main/markdown-to-tiptap.ts"
            />
          </Field>

          <Field label="Acceptance criteria" hint="Exact success condition. The agent uses this to decide what metric to report in SCORE=.">
            <textarea
              style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }}
              value={acceptance}
              onChange={(e) => setAcceptance(e.target.value)}
              placeholder='e.g. "Reduce markdown-to-tiptap parse cost by 20% measured in ns/char on a diverse corpus"'
            />
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Field label="Noise class" hint="Deterministic score? 'low'. Flaky wall-clock / network? 'medium' or 'high'.">
              <select style={inputStyle} value={noiseClass} onChange={(e) => setNoiseClass(e.target.value as typeof noiseClass)}>
                <option value="low">low (deterministic)</option>
                <option value="medium">medium</option>
                <option value="high">high (flaky)</option>
              </select>
            </Field>
            <Field label="Direction" hint="Uncheck for latency / bundle-size / loss.">
              <label style={{ fontSize: 12, color: '#e6e7ea', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, padding: '6px 0' }}>
                <input type="checkbox" checked={higherIsBetter} onChange={(e) => setHigherIsBetter(e.target.checked)} />
                Higher score is better
              </label>
            </Field>
          </div>

          {error && (
            <div
              style={{
                fontSize: 12,
                color: '#ef4444',
                padding: '8px 10px',
                background: '#2a1a1a',
                border: '1px solid #5a2828',
                borderRadius: 4
              }}
            >
              {error}
            </div>
          )}
        </div>

        <footer style={{ padding: '12px 16px', borderTop: '1px solid #2a2b32', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button style={buttonStyle()} onClick={onClose} disabled={busy} type="button">Cancel</button>
          <button style={buttonStyle('#22c55e')} onClick={submit} disabled={busy} type="button">
            {busy ? 'Spawning…' : 'Spawn harness agent'}
          </button>
        </footer>
      </div>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }): JSX.Element {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 11, color: '#e6e7ea', fontWeight: 500 }}>{label}</span>
      {hint && <span style={{ fontSize: 10, color: '#6b7280', lineHeight: 1.3 }}>{hint}</span>}
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
  width: 540,
  maxWidth: '92vw',
  background: '#1a1b1f',
  border: '1px solid #3a3b42',
  borderRadius: 8,
  boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  fontFamily: 'system-ui, -apple-system, sans-serif'
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
