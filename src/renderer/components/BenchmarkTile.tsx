import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import { NodeResizer, Handle, Position } from '@xyflow/react'
import type {
  BenchmarkFile,
  BenchmarkMeta,
  BenchmarkResultsRow,
  BenchmarkRuntimeState,
  BenchmarkStatus
} from '../../preload/index'
import { useSemanticZoom } from '../hooks/useSemanticZoom'

interface BenchmarkTileData {
  benchmarkId: string
}

const STATUS_COLOR: Record<BenchmarkStatus, string> = {
  unstarted: '#6b7280',
  running: '#22c55e',
  paused: '#eab308',
  frozen: '#ef4444',
  stopped: '#9ca3af',
  done: '#14b8a6'
}

const ACCENT = '#3b82f6' // benchmark-tile accent (blue — matches BENCHMARK classification)

export function BenchmarkTile({ data, selected }: NodeProps): JSX.Element {
  const { benchmarkId } = data as unknown as BenchmarkTileData
  const tier = useSemanticZoom()

  const [file, setFile] = useState<BenchmarkFile | null>(null)
  const [hintDraft, setHintDraft] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const reload = useCallback(async () => {
    const loaded = await window.benchmark.load(benchmarkId)
    if (loaded) setFile(loaded)
  }, [benchmarkId])

  useEffect(() => {
    reload()
  }, [reload])

  useEffect(() => {
    const unsubs: Array<() => void> = []
    unsubs.push(
      window.benchmark.onBenchmarkUpdate(({ benchmarkId: id }) => {
        if (id === benchmarkId) reload()
      })
    )
    unsubs.push(
      window.benchmark.onBenchmarkStateChange(({ benchmarkId: id }) => {
        if (id === benchmarkId) reload()
      })
    )
    return () => {
      for (const u of unsubs) u()
    }
  }, [benchmarkId, reload])

  const runControl = useCallback(
    async (
      action: 'start' | 'pause' | 'resume' | 'stop' | 'unfreeze'
    ) => {
      setBusy(action)
      try {
        await window.benchmark.control(benchmarkId, action)
        await reload()
      } finally {
        setBusy(null)
      }
    },
    [benchmarkId, reload]
  )

  const submitHint = useCallback(async () => {
    if (!hintDraft.trim()) return
    setBusy('hint')
    try {
      await window.benchmark.setHint(benchmarkId, hintDraft.trim())
      setHintDraft('')
      await reload()
    } finally {
      setBusy(null)
    }
  }, [hintDraft, benchmarkId, reload])

  const handoff = useCallback(async () => {
    setBusy('handoff')
    try {
      await window.benchmark.handoffPlan(benchmarkId)
      await reload()
    } finally {
      setBusy(null)
    }
  }, [benchmarkId, reload])

  if (!file) {
    return (
      <div style={tileContainer(selected, '#6b7280')}>
        <Handle type="target" position={Position.Top} className="!bg-zinc-600" />
        <div style={{ padding: 16, color: '#9ca3af' }}>Loading benchmark…</div>
        <Handle type="source" position={Position.Bottom} className="!bg-zinc-600" />
      </div>
    )
  }

  const { meta, runtime, rows } = file
  const danger = runtime.frozen || runtime.heldOutDivergence
  const borderColor = danger ? '#ef4444' : ACCENT

  if (tier === 'badge') {
    return (
      <div style={{ ...tileContainer(selected, borderColor), padding: 0 }}>
        <Handle type="target" position={Position.Top} className="!bg-zinc-600" />
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: ACCENT,
            borderRadius: 6
          }}
        >
          <div
            style={{
              width: 14,
              height: 14,
              borderRadius: '50%',
              background: STATUS_COLOR[runtime.status],
              boxShadow: '0 0 0 2px rgba(0,0,0,0.4)'
            }}
          />
        </div>
        <Handle type="source" position={Position.Bottom} className="!bg-zinc-600" />
      </div>
    )
  }

  return (
    <div style={tileContainer(selected, borderColor)}>
      <NodeResizer minWidth={360} minHeight={260} isVisible={selected} />
      <Handle type="target" position={Position.Top} className="!bg-zinc-600" />
      <AccentStripe color={ACCENT} />

      <Header meta={meta} runtime={runtime} rows={rows} />
      <Leaderboard rows={rows} />
      <Footer
        meta={meta}
        runtime={runtime}
        hintDraft={hintDraft}
        setHintDraft={setHintDraft}
        onStart={() => runControl('start')}
        onPause={() => runControl('pause')}
        onResume={() => runControl('resume')}
        onStop={() => runControl('stop')}
        onUnfreeze={() => runControl('unfreeze')}
        onSubmitHint={submitHint}
        onHandoff={handoff}
        busy={busy}
      />

      <Handle type="source" position={Position.Bottom} className="!bg-zinc-600" />
    </div>
  )
}

// ── Header ──

function Header({
  meta,
  runtime,
  rows
}: {
  meta: BenchmarkMeta
  runtime: BenchmarkRuntimeState
  rows: BenchmarkResultsRow[]
}): JSX.Element {
  const iterPerHour = useMemo(() => {
    if (!runtime.startedAt || rows.length === 0) return 0
    const elapsedHours = (Date.now() - runtime.startedAt) / 3_600_000
    if (elapsedHours <= 0) return 0
    return rows.length / elapsedHours
  }, [runtime.startedAt, rows.length])

  const elapsed = useMemo(() => {
    if (!runtime.startedAt) return 'not started'
    return formatElapsed(Date.now() - runtime.startedAt)
  }, [runtime.startedAt, runtime.lastIterationAt, rows.length])

  return (
    <div
      style={{
        padding: '10px 12px 8px 14px',
        borderBottom: '1px solid #2a2b32',
        display: 'flex',
        flexDirection: 'column',
        gap: 6
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#e6e7ea', flex: 1 }}>
          {meta.label}
        </span>
        <StatusDot status={runtime.status} />
        <span
          style={{
            fontSize: 10,
            color: STATUS_COLOR[runtime.status],
            textTransform: 'uppercase',
            letterSpacing: 0.5
          }}
        >
          {runtime.status}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 12, fontSize: 11, color: '#9ca3af', flexWrap: 'wrap' }}>
        <Metric label="iters/hr" value={iterPerHour.toFixed(1)} />
        <Metric label="best" value={fmtScore(runtime.bestScore)} />
        <Metric label="elapsed" value={elapsed} />
        <Metric label="kept" value={String(runtime.keptCount)} />
        <Metric label="reverted" value={String(runtime.revertedCount)} />
        <Metric label="noise" value={meta.noiseClass} />
      </div>
      {runtime.frozen && (
        <div style={{ fontSize: 11, color: '#ef4444', marginTop: 2 }}>
          ⚠ FROZEN — {runtime.frozenReason ?? 'anomaly detected'}
        </div>
      )}
      {runtime.heldOutDivergence && (
        <div style={{ fontSize: 11, color: '#ef4444', marginTop: 2 }}>
          ⚠ Held-out regressed while primary improved — possible reward hacking
        </div>
      )}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <span>
      <span style={{ color: '#6b7280' }}>{label}: </span>
      <span style={{ color: '#e6e7ea' }}>{value}</span>
    </span>
  )
}

function StatusDot({ status }: { status: BenchmarkStatus }): JSX.Element {
  return (
    <span
      title={status}
      style={{
        width: 9,
        height: 9,
        borderRadius: '50%',
        background: STATUS_COLOR[status],
        boxShadow:
          status === 'running'
            ? '0 0 6px ' + STATUS_COLOR[status]
            : '0 0 0 1px rgba(0,0,0,0.4)'
      }}
    />
  )
}

// ── Leaderboard ──

function Leaderboard({ rows }: { rows: BenchmarkResultsRow[] }): JSX.Element {
  const sorted = useMemo(() => [...rows].reverse().slice(0, 50), [rows])
  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 8, fontSize: 11, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '48px 70px 50px 70px 70px 70px 1fr',
          columnGap: 8,
          fontSize: 10,
          color: '#6b7280',
          textTransform: 'uppercase',
          letterSpacing: 0.4,
          paddingBottom: 4,
          borderBottom: '1px solid #2a2b32'
        }}
      >
        <span>iter</span>
        <span style={{ textAlign: 'right' }}>score</span>
        <span style={{ textAlign: 'right' }}>Δ</span>
        <span style={{ textAlign: 'right' }}>runtime</span>
        <span style={{ textAlign: 'right' }}>temp</span>
        <span style={{ textAlign: 'center' }}>kept</span>
        <span>rationale</span>
      </div>
      {sorted.length === 0 ? (
        <div style={{ padding: 12, color: '#6b7280', textAlign: 'center' }}>
          No iterations yet.
        </div>
      ) : (
        sorted.map((r) => (
          <div
            key={r.iter}
            style={{
              display: 'grid',
              gridTemplateColumns: '48px 70px 50px 70px 70px 70px 1fr',
              columnGap: 8,
              padding: '3px 0',
              borderBottom: '1px solid #1a1b1f',
              color: r.accepted ? '#e6e7ea' : '#6b7280',
              opacity: r.accepted ? 1 : 0.75
            }}
          >
            <span>#{r.iter}</span>
            <span style={{ textAlign: 'right', color: '#e6e7ea' }}>{fmtScore(r.score)}</span>
            <span
              style={{
                textAlign: 'right',
                color: r.delta === null ? '#6b7280' : r.delta > 0 ? '#22c55e' : r.delta < 0 ? '#ef4444' : '#9ca3af'
              }}
            >
              {r.delta === null ? '—' : fmtDelta(r.delta)}
            </span>
            <span style={{ textAlign: 'right' }}>{fmtMs(r.runtimeMs)}</span>
            <span style={{ textAlign: 'right' }}>{r.temp.toFixed(2)}</span>
            <span
              style={{
                textAlign: 'center',
                fontSize: 9,
                fontWeight: 600,
                color: r.accepted ? '#22c55e' : '#9ca3af'
              }}
            >
              {r.accepted ? 'KEPT' : 'REV'}
            </span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {r.accepted ? r.rationale : r.rejectionReason || r.rationale}
            </span>
          </div>
        ))
      )}
    </div>
  )
}

// ── Footer ──

function Footer(props: {
  meta: BenchmarkMeta
  runtime: BenchmarkRuntimeState
  hintDraft: string
  setHintDraft: (s: string) => void
  onStart: () => void
  onPause: () => void
  onResume: () => void
  onStop: () => void
  onUnfreeze: () => void
  onSubmitHint: () => void
  onHandoff: () => void
  busy: string | null
}): JSX.Element {
  const {
    runtime,
    hintDraft,
    setHintDraft,
    onStart,
    onPause,
    onResume,
    onStop,
    onUnfreeze,
    onSubmitHint,
    onHandoff,
    busy
  } = props
  const stopped = runtime.status === 'stopped' || runtime.status === 'done'
  return (
    <div
      style={{
        borderTop: '1px solid #2a2b32',
        padding: 8,
        display: 'flex',
        flexDirection: 'column',
        gap: 6
      }}
    >
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {runtime.status === 'unstarted' && (
          <Button onClick={onStart} disabled={!!busy} accent="#22c55e">Start</Button>
        )}
        {runtime.status === 'running' && (
          <Button onClick={onPause} disabled={!!busy} accent="#eab308">Pause</Button>
        )}
        {runtime.status === 'paused' && (
          <Button onClick={onResume} disabled={!!busy} accent="#22c55e">Resume</Button>
        )}
        {runtime.frozen && (
          <Button onClick={onUnfreeze} disabled={!!busy} accent="#f97316">Unfreeze (human sign-off)</Button>
        )}
        {!stopped && !runtime.frozen && (
          <Button onClick={onStop} disabled={!!busy} accent="#ef4444">Stop</Button>
        )}
        <Button onClick={onHandoff} disabled={!!busy || runtime.iterationN === 0} accent="#14b8a6">
          Handoff → Plan Tile
        </Button>
      </div>

      {runtime.pendingHint && (
        <div style={{ fontSize: 10, color: '#f59e0b' }}>
          pending hint queued for next iteration: "{runtime.pendingHint}"
        </div>
      )}

      <div style={{ display: 'flex', gap: 6 }}>
        <input
          type="text"
          placeholder="Hint to next iteration (enter to submit)…"
          value={hintDraft}
          onChange={(e) => setHintDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSubmitHint()
          }}
          style={{
            flex: 1,
            background: '#0f0f12',
            color: '#e6e7ea',
            border: '1px solid #2a2b32',
            borderRadius: 4,
            padding: '4px 8px',
            fontSize: 12
          }}
        />
        <Button onClick={onSubmitHint} disabled={!!busy || !hintDraft.trim()}>
          Send hint
        </Button>
      </div>
    </div>
  )
}

// ── Building blocks ──

function tileContainer(selected: boolean | undefined, accent: string): React.CSSProperties {
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

function Button({
  children,
  onClick,
  disabled,
  accent
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  accent?: string
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '4px 10px',
        borderRadius: 4,
        background: accent ? `${accent}22` : 'transparent',
        border: `1px solid ${accent ?? '#3a3b42'}`,
        color: disabled ? '#6b7280' : accent ?? '#e6e7ea',
        fontSize: 11,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        whiteSpace: 'nowrap'
      }}
    >
      {children}
    </button>
  )
}

function fmtScore(v: number | null): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return 'n/a'
  if (Math.abs(v) >= 1000) return v.toFixed(0)
  if (Math.abs(v) >= 1) return v.toFixed(3)
  return v.toFixed(4)
}

function fmtDelta(v: number): string {
  const s = v > 0 ? '+' : ''
  return s + fmtScore(v)
}

function fmtMs(ms: number): string {
  if (!Number.isFinite(ms)) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60_000).toFixed(1)}m`
}

function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${sec}s`
  return `${sec}s`
}
