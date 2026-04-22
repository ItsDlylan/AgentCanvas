import { useCallback, useEffect, useState } from 'react'

/**
 * Modal for converting a BENCHMARK-classified Task Tile into a running
 * Benchmark Tile. Collects the required acceptance contract + harness paths
 * and calls window.benchmark.convertFromTask — no terminal required.
 */
export interface HarnessBenchmarkModalProps {
  taskId: string
  taskLabel: string
  /** Prefilled acceptance text from the task's acceptanceCriteria (markdown). */
  inheritedAcceptance: string
  onClose: () => void
  onCreated: (benchmarkId: string) => void
}

export function HarnessBenchmarkModal({
  taskId,
  taskLabel,
  inheritedAcceptance,
  onClose,
  onCreated
}: HarnessBenchmarkModalProps): JSX.Element {
  const [sourceRepoPath, setSourceRepoPath] = useState('')
  const [evaluatorPath, setEvaluatorPath] = useState('benchmark/evaluator.sh')
  const [targetFilesCsv, setTargetFilesCsv] = useState('')
  const [noiseClass, setNoiseClass] = useState<'low' | 'medium' | 'high'>('medium')
  const [higherIsBetter, setHigherIsBetter] = useState(false)
  const [acceptance, setAcceptance] = useState(inheritedAcceptance || '')
  const [baselineMode, setBaselineMode] = useState<'auto' | 'manual'>('auto')
  const [baselineScore, setBaselineScore] = useState<string>('')
  const [targetMode, setTargetMode] = useState<'pct' | 'absolute'>('pct')
  const [improvementPct, setImprovementPct] = useState<string>('20')
  const [scoreTarget, setScoreTarget] = useState<string>('')
  const [stagnationN, setStagnationN] = useState<string>('20')
  const [wallClockHours, setWallClockHours] = useState<string>('8')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Best-effort prefill of sourceRepoPath from the current working directory.
  // The user can override with the picker.
  useEffect(() => {
    // no window.process in renderer; leave blank and let picker fill it
  }, [])

  const pickFolder = useCallback(async () => {
    const picked = await window.workspace.pickDirectory()
    if (picked) setSourceRepoPath(picked)
  }, [])

  const submit = useCallback(async () => {
    setError(null)
    if (!sourceRepoPath.trim()) {
      setError('Source repo path is required (pick the folder that contains your .git).')
      return
    }
    if (!acceptance.trim()) {
      setError('Acceptance criteria cannot be empty.')
      return
    }
    if (baselineMode === 'manual' && !isFiniteNum(baselineScore)) {
      setError('Baseline score must be a number when in manual mode.')
      return
    }
    if (targetMode === 'pct' && !(Number(improvementPct) > 0)) {
      setError('Improvement % must be positive.')
      return
    }
    if (targetMode === 'absolute' && !isFiniteNum(scoreTarget)) {
      setError('Absolute target must be a finite number.')
      return
    }

    // Build payload. If baselineMode is 'auto', send a placeholder — the runner
    // re-measures baseline on first launch anyway, and the server requires a
    // number for validation.
    const baselineNum = baselineMode === 'manual' ? Number(baselineScore) : 0
    const targetFiles = targetFilesCsv
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const stopConditions: Record<string, number> = {}
    if (isFiniteNum(stagnationN)) stopConditions.stagnationN = Number(stagnationN)
    if (isFiniteNum(wallClockHours)) stopConditions.wallClockMs = Math.round(Number(wallClockHours) * 3600_000)

    setBusy(true)
    try {
      const res = await window.benchmark.convertFromTask({
        taskId,
        sourceRepoPath: sourceRepoPath.trim(),
        evaluatorPath: evaluatorPath.trim(),
        targetFiles,
        noiseClass,
        higherIsBetter,
        acceptanceCriteria: acceptance.trim(),
        baselineScore: baselineNum,
        improvementPct: targetMode === 'pct' ? Number(improvementPct) : undefined,
        scoreTarget: targetMode === 'absolute' ? Number(scoreTarget) : undefined,
        stopConditions
      })
      if (!res.ok) {
        setError(res.error || 'Conversion failed (unknown reason).')
        setBusy(false)
        return
      }
      onCreated(res.benchmarkId!)
      onClose()
    } catch (e) {
      setError((e as Error).message || String(e))
      setBusy(false)
    }
  }, [
    sourceRepoPath,
    evaluatorPath,
    targetFilesCsv,
    noiseClass,
    higherIsBetter,
    acceptance,
    baselineMode,
    baselineScore,
    targetMode,
    improvementPct,
    scoreTarget,
    stagnationN,
    wallClockHours,
    taskId,
    onClose,
    onCreated
  ])

  return (
    <div
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
      style={backdropStyle}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={panelStyle}
      >
        <header style={{ padding: '14px 16px', borderBottom: '1px solid #2a2b32' }}>
          <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Harness as Benchmark
          </div>
          <div style={{ fontSize: 15, color: '#e6e7ea', fontWeight: 600, marginTop: 2 }}>{taskLabel}</div>
          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
            Creates an isolated git worktree from the source repo, wires up the
            evaluator, and opens a runnable Benchmark Tile. Main branch is never
            mutated.
          </div>
        </header>

        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto', maxHeight: '65vh' }}>
          <Field label="Source repo path" hint="The folder containing .git. A worktree will be auto-created next to it at ../<repo>-worktrees/bench-<id>.">
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

          <Field label="Evaluator path (relative to repo)" hint="Must print `SCORE=<number>` on its final line.">
            <input
              style={inputStyle}
              value={evaluatorPath}
              onChange={(e) => setEvaluatorPath(e.target.value)}
            />
          </Field>

          <Field label="Target files (comma-separated)" hint="Files the agent is allowed to edit. Leave empty to let the agent pick.">
            <input
              style={inputStyle}
              value={targetFilesCsv}
              onChange={(e) => setTargetFilesCsv(e.target.value)}
              placeholder="src/main/foo.ts, src/lib/bar.ts"
            />
          </Field>

          <Field label="Acceptance criteria" hint="Plain language — what success looks like. Agents see this on every iteration.">
            <textarea
              style={{ ...inputStyle, minHeight: 64, resize: 'vertical' }}
              value={acceptance}
              onChange={(e) => setAcceptance(e.target.value)}
              placeholder="e.g. Reduce p95 search latency by 30% without regressing accuracy"
            />
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Field label="Noise class" hint="low=deterministic (strict >); medium/high=delta must exceed observed stddev.">
              <select style={inputStyle} value={noiseClass} onChange={(e) => setNoiseClass(e.target.value as typeof noiseClass)}>
                <option value="low">low (deterministic)</option>
                <option value="medium">medium</option>
                <option value="high">high (flaky)</option>
              </select>
            </Field>
            <Field label="Direction" hint="Uncheck for latency / bundle-size / loss (lower is better).">
              <label style={{ fontSize: 12, color: '#e6e7ea', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, padding: '6px 0' }}>
                <input type="checkbox" checked={higherIsBetter} onChange={(e) => setHigherIsBetter(e.target.checked)} />
                Higher score is better
              </label>
            </Field>
          </div>

          <Field label="Baseline score" hint="'Auto' runs the evaluator 3× on HEAD before the first iteration and patches the tile with the measured median. Manual only if you've already measured.">
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <select
                style={{ ...inputStyle, flex: '0 0 160px' }}
                value={baselineMode}
                onChange={(e) => setBaselineMode(e.target.value as 'auto' | 'manual')}
              >
                <option value="auto">auto-measure on launch</option>
                <option value="manual">manual</option>
              </select>
              {baselineMode === 'manual' && (
                <input
                  style={inputStyle}
                  type="number"
                  step="any"
                  value={baselineScore}
                  onChange={(e) => setBaselineScore(e.target.value)}
                  placeholder="e.g. 49.80"
                />
              )}
            </div>
          </Field>

          <Field label="Target" hint="Stop-condition the comparator checks every iteration.">
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <select
                style={{ ...inputStyle, flex: '0 0 160px' }}
                value={targetMode}
                onChange={(e) => setTargetMode(e.target.value as 'pct' | 'absolute')}
              >
                <option value="pct">% improvement</option>
                <option value="absolute">absolute score</option>
              </select>
              <input
                style={inputStyle}
                type="number"
                step="any"
                value={targetMode === 'pct' ? improvementPct : scoreTarget}
                onChange={(e) =>
                  targetMode === 'pct' ? setImprovementPct(e.target.value) : setScoreTarget(e.target.value)
                }
                placeholder={targetMode === 'pct' ? '20' : 'e.g. 40.0'}
              />
              <span style={{ fontSize: 12, color: '#6b7280' }}>
                {targetMode === 'pct' ? '%' : ''}
              </span>
            </div>
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Field label="Stop after N stagnations" hint="Stop if no accepted diff for N consecutive iterations.">
              <input
                style={inputStyle}
                type="number"
                value={stagnationN}
                onChange={(e) => setStagnationN(e.target.value)}
              />
            </Field>
            <Field label="Wallclock cap (hours)" hint="Hard upper bound on run time.">
              <input
                style={inputStyle}
                type="number"
                value={wallClockHours}
                onChange={(e) => setWallClockHours(e.target.value)}
              />
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
            {busy ? 'Creating…' : 'Harness + open tile'}
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

function isFiniteNum(s: string): boolean {
  if (s === '' || s === null || s === undefined) return false
  const n = Number(s)
  return Number.isFinite(n)
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
  width: 560,
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
