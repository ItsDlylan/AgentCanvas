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
import { TileContextMenu, type TileContextMenuItem } from './TileContextMenu'

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
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)

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

  const launchRunner = useCallback(async () => {
    setBusy('launch')
    try {
      await window.benchmark.launchRunner(benchmarkId)
      await reload()
    } finally {
      setBusy(null)
    }
  }, [benchmarkId, reload])

  const closeTile = useCallback(async () => {
    await window.benchmark.close(benchmarkId)
  }, [benchmarkId])

  const deletePermanently = useCallback(async () => {
    if (!window.confirm('Delete this benchmark tile and its .benchmark-tile/ state? This cannot be undone.')) return
    await window.benchmark.delete(benchmarkId)
  }, [benchmarkId])

  const contextMenuItems: TileContextMenuItem[] = useMemo(() => {
    const items: TileContextMenuItem[] = []
    if (file?.runtime.status === 'running' || file?.runtime.status === 'paused') {
      items.push({
        label: file.runtime.status === 'running' ? 'Pause' : 'Resume',
        onClick: () => runControl(file.runtime.status === 'running' ? 'pause' : 'resume')
      })
      items.push({ label: 'Stop', onClick: () => runControl('stop'), danger: true })
    } else if (file?.runtime.status === 'unstarted' || file?.runtime.status === 'stopped' || file?.runtime.status === 'done') {
      items.push({ label: 'Launch runner', onClick: launchRunner })
    }
    if (file?.runtime.frozen) {
      items.push({ label: 'Unfreeze (human sign-off)', onClick: () => runControl('unfreeze') })
    }
    if (file?.runtime.iterationN && file.runtime.iterationN > 0) {
      items.push({ label: 'Handoff → Plan Tile', onClick: handoff })
    }
    items.push({ label: '', separator: true, onClick: () => undefined })
    items.push({ label: 'Close (soft delete)', onClick: closeTile })
    items.push({ label: 'Delete permanently', onClick: deletePermanently, danger: true })
    return items
  }, [file, runControl, launchRunner, handoff, closeTile, deletePermanently])

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
    <div
      style={tileContainer(selected, borderColor)}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setContextMenu({ x: e.clientX, y: e.clientY })
      }}
    >
      <NodeResizer minWidth={380} minHeight={320} isVisible={selected} />
      <Handle type="target" position={Position.Top} className="!bg-zinc-600" />
      <AccentStripe color={ACCENT} />

      <Header meta={meta} runtime={runtime} rows={rows} onClose={closeTile} />
      <GoalBlock meta={meta} runtime={runtime} />
      <SparklineGraph meta={meta} rows={rows} />
      <Leaderboard rows={rows} />
      <Footer
        meta={meta}
        runtime={runtime}
        hintDraft={hintDraft}
        setHintDraft={setHintDraft}
        onLaunch={launchRunner}
        onPause={() => runControl('pause')}
        onResume={() => runControl('resume')}
        onStop={() => runControl('stop')}
        onUnfreeze={() => runControl('unfreeze')}
        onSubmitHint={submitHint}
        onHandoff={handoff}
        busy={busy}
      />

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

// ── Header ──

function Header({
  meta,
  runtime,
  rows,
  onClose
}: {
  meta: BenchmarkMeta
  runtime: BenchmarkRuntimeState
  rows: BenchmarkResultsRow[]
  onClose: () => void
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
        <button
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
          title="Close benchmark tile (soft delete)"
          style={{
            marginLeft: 4,
            background: 'transparent',
            border: 'none',
            color: '#6b7280',
            cursor: 'pointer',
            padding: 2,
            lineHeight: 1,
            fontSize: 14
          }}
          onMouseEnter={(e) => ((e.target as HTMLButtonElement).style.color = '#e6e7ea')}
          onMouseLeave={(e) => ((e.target as HTMLButtonElement).style.color = '#6b7280')}
        >
          ×
        </button>
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

// ── Goal block ──

function GoalBlock({
  meta,
  runtime
}: {
  meta: BenchmarkMeta
  runtime: BenchmarkRuntimeState
}): JSX.Element {
  const higher = meta.higherIsBetter !== false
  const target = useMemo(() => {
    if (meta.scoreTarget !== undefined && Number.isFinite(meta.scoreTarget)) return meta.scoreTarget
    if (
      meta.improvementPct !== undefined &&
      Number.isFinite(meta.improvementPct) &&
      Number.isFinite(meta.baselineScore)
    ) {
      const f = meta.improvementPct / 100
      return higher ? meta.baselineScore * (1 + f) : meta.baselineScore * (1 - f)
    }
    return null
  }, [meta.scoreTarget, meta.improvementPct, meta.baselineScore, higher])

  const goalMet =
    runtime.bestScore !== null &&
    target !== null &&
    (higher ? runtime.bestScore >= target : runtime.bestScore <= target)

  const progress = useMemo(() => {
    if (runtime.bestScore === null || target === null) return 0
    const range = target - meta.baselineScore
    if (range === 0) return goalMet ? 1 : 0
    const done = runtime.bestScore - meta.baselineScore
    const pct = done / range
    if (!Number.isFinite(pct)) return 0
    return Math.max(0, Math.min(1, pct))
  }, [runtime.bestScore, target, meta.baselineScore, goalMet])

  return (
    <div
      style={{
        padding: '8px 12px 10px 14px',
        borderBottom: '1px solid #2a2b32',
        background: '#141519',
        display: 'flex',
        flexDirection: 'column',
        gap: 6
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: '#9ca3af' }}>
        <span>Goal</span>
        {goalMet && (
          <span style={{ fontSize: 9, color: '#22c55e', fontWeight: 700 }}>✓ reached</span>
        )}
      </div>
      <div
        title={meta.acceptanceCriteria}
        style={{
          fontSize: 12,
          color: '#e6e7ea',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }}
      >
        {meta.acceptanceCriteria || <span style={{ color: '#ef4444' }}>⚠ missing — bench cannot shut off on success</span>}
      </div>
      <div style={{ display: 'flex', gap: 12, fontSize: 11, color: '#9ca3af' }}>
        <Metric label="baseline" value={fmtScore(meta.baselineScore)} />
        <Metric label="target" value={target === null ? 'n/a' : fmtScore(target)} />
        <Metric
          label="direction"
          value={higher ? '↑ higher better' : '↓ lower better'}
        />
        {meta.improvementPct !== undefined && (
          <Metric label="improve" value={`${meta.improvementPct}%`} />
        )}
      </div>
      {meta.worktreeBranch && (
        <div
          style={{ fontSize: 10, color: '#6b7280' }}
          title={`worktree: ${meta.worktreePath}`}
        >
          branch: <span style={{ color: '#9ca3af' }}>{meta.worktreeBranch}</span>
          {meta.autoCreatedWorktree ? ' (auto-worktree)' : ''}
        </div>
      )}
      <div
        style={{
          height: 4,
          borderRadius: 2,
          background: '#2a2b32',
          overflow: 'hidden'
        }}
      >
        <div
          style={{
            width: `${progress * 100}%`,
            height: '100%',
            background: goalMet ? '#22c55e' : '#3b82f6',
            transition: 'width 300ms ease'
          }}
        />
      </div>
    </div>
  )
}

// ── Sparkline graph ──
//
// Two layers:
//   - grey dots for every iteration (accepted + rejected) plotted at their raw score
//   - a green piecewise-linear "best-so-far" line through accepted iterations only
//   - horizontal guides: baseline (grey dashed) + target (blue dashed)
//
// Hovering a dot shows a tooltip with iteration, score, Δ, and rationale — so
// the user can read "what this iteration did that helped or hurt".

function SparklineGraph({
  meta,
  rows
}: {
  meta: BenchmarkMeta
  rows: BenchmarkResultsRow[]
}): JSX.Element {
  const higher = meta.higherIsBetter !== false
  const target = useMemo(() => {
    if (meta.scoreTarget !== undefined && Number.isFinite(meta.scoreTarget)) return meta.scoreTarget
    if (
      meta.improvementPct !== undefined &&
      Number.isFinite(meta.improvementPct) &&
      Number.isFinite(meta.baselineScore)
    ) {
      const f = meta.improvementPct / 100
      return higher ? meta.baselineScore * (1 + f) : meta.baselineScore * (1 - f)
    }
    return null
  }, [meta.scoreTarget, meta.improvementPct, meta.baselineScore, higher])

  const [hover, setHover] = useState<{ x: number; y: number; row: BenchmarkResultsRow } | null>(null)

  const width = 520
  const height = 96
  const padX = 28
  const padY = 10

  const { points, bestLine, yMin, yMax } = useMemo(() => {
    if (rows.length === 0) {
      const lo = Math.min(meta.baselineScore, target ?? meta.baselineScore)
      const hi = Math.max(meta.baselineScore, target ?? meta.baselineScore)
      return { points: [], bestLine: [], yMin: lo - 0.5, yMax: hi + 0.5 }
    }
    const scores = rows.map((r) => r.score)
    const allY = [...scores, meta.baselineScore]
    if (target !== null) allY.push(target)
    const lo = Math.min(...allY)
    const hi = Math.max(...allY)
    const pad = (hi - lo) * 0.1 || Math.max(Math.abs(hi), 0.001)

    // Compute best-so-far trajectory using accepted rows only (respecting direction).
    const best: Array<{ iter: number; score: number }> = []
    let current: number | null = null
    for (const r of rows) {
      if (!r.accepted) continue
      if (current === null) current = r.score
      else current = higher ? Math.max(current, r.score) : Math.min(current, r.score)
      best.push({ iter: r.iter, score: current })
    }
    return { points: rows, bestLine: best, yMin: lo - pad, yMax: hi + pad }
  }, [rows, meta.baselineScore, target, higher])

  const xForIter = useCallback(
    (iter: number) => {
      const maxIter = Math.max(rows.length, 1)
      return padX + ((iter - 1) / Math.max(maxIter - 1, 1)) * (width - padX - 6)
    },
    [rows.length]
  )
  const yForScore = useCallback(
    (score: number) => {
      if (yMax === yMin) return height / 2
      // When lower is better, invert so "good" sits at the top of the chart.
      const t = higher ? (score - yMin) / (yMax - yMin) : 1 - (score - yMin) / (yMax - yMin)
      return height - padY - t * (height - 2 * padY)
    },
    [yMin, yMax, higher]
  )

  const baselineY = yForScore(meta.baselineScore)
  const targetY = target === null ? null : yForScore(target)

  return (
    <div
      style={{
        position: 'relative',
        borderBottom: '1px solid #2a2b32',
        padding: '6px 8px',
        background: '#0f0f12'
      }}
    >
      <div
        style={{
          fontSize: 9,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          color: '#6b7280',
          marginBottom: 2,
          display: 'flex',
          justifyContent: 'space-between'
        }}
      >
        <span>Score over iterations</span>
        <span>{rows.length === 0 ? 'no data yet' : `${rows.length} iter · ${rows.filter((r) => r.accepted).length} kept`}</span>
      </div>
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        style={{ display: 'block', width: '100%' }}
      >
        {/* Baseline guide */}
        <line
          x1={padX}
          x2={width - 6}
          y1={baselineY}
          y2={baselineY}
          stroke="#6b7280"
          strokeDasharray="3 3"
          strokeWidth={1}
        />
        <text x={2} y={baselineY + 3} fontSize="9" fill="#6b7280">
          base
        </text>

        {/* Target guide */}
        {targetY !== null && (
          <>
            <line
              x1={padX}
              x2={width - 6}
              y1={targetY}
              y2={targetY}
              stroke="#3b82f6"
              strokeDasharray="4 3"
              strokeWidth={1}
            />
            <text x={2} y={targetY + 3} fontSize="9" fill="#3b82f6">
              goal
            </text>
          </>
        )}

        {/* Best-so-far line (only through accepted iterations) */}
        {bestLine.length > 1 && (
          <polyline
            fill="none"
            stroke="#22c55e"
            strokeWidth={1.5}
            points={bestLine.map((p) => `${xForIter(p.iter)},${yForScore(p.score)}`).join(' ')}
          />
        )}

        {/* All iteration dots */}
        {points.map((r) => {
          const cx = xForIter(r.iter)
          const cy = yForScore(r.score)
          const color = r.accepted
            ? r.delta === null
              ? '#6b7280'
              : (higher ? r.delta > 0 : r.delta < 0)
              ? '#22c55e'
              : '#eab308'
            : '#ef4444'
          return (
            <circle
              key={r.iter}
              cx={cx}
              cy={cy}
              r={r.accepted ? 3 : 2.2}
              fill={color}
              stroke={r.accepted ? '#0f0f12' : 'none'}
              strokeWidth={1}
              style={{ cursor: 'pointer' }}
              onMouseEnter={(e) =>
                setHover({ x: (e as unknown as MouseEvent).clientX, y: (e as unknown as MouseEvent).clientY, row: r })
              }
              onMouseLeave={() => setHover(null)}
            />
          )
        })}
      </svg>

      {hover && (
        <div
          style={{
            position: 'fixed',
            left: hover.x + 12,
            top: hover.y + 12,
            background: '#18191d',
            border: '1px solid #3a3b42',
            borderRadius: 4,
            padding: '6px 8px',
            fontSize: 11,
            color: '#e6e7ea',
            pointerEvents: 'none',
            zIndex: 1000,
            maxWidth: 320,
            boxShadow: '0 4px 12px rgba(0,0,0,0.6)'
          }}
        >
          <div style={{ fontWeight: 600 }}>
            iter {hover.row.iter}{' '}
            <span style={{ color: hover.row.accepted ? '#22c55e' : '#ef4444', fontSize: 10 }}>
              {hover.row.accepted ? 'KEPT' : 'REV'}
            </span>
          </div>
          <div style={{ color: '#9ca3af', fontSize: 10 }}>
            score={fmtScore(hover.row.score)} · Δ={hover.row.delta === null ? '—' : fmtDelta(hover.row.delta)} · temp={hover.row.temp.toFixed(2)}
          </div>
          <div style={{ marginTop: 4, color: '#e6e7ea', lineHeight: 1.3 }}>
            {hover.row.accepted
              ? hover.row.rationale || '(no rationale)'
              : hover.row.rejectionReason || hover.row.rationale || '(no detail)'}
          </div>
        </div>
      )}
    </div>
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
  onLaunch: () => void
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
    onLaunch,
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
        {(runtime.status === 'unstarted' || stopped) && (
          <Button onClick={onLaunch} disabled={!!busy} accent="#22c55e">
            ▶ Launch runner
          </Button>
        )}
        {runtime.status === 'running' && (
          <>
            <Button onClick={onPause} disabled={!!busy} accent="#eab308">Pause</Button>
            <Button onClick={onLaunch} disabled={!!busy} accent="#3b82f6">
              ↻ Relaunch runner terminal
            </Button>
          </>
        )}
        {runtime.status === 'paused' && (
          <Button onClick={onResume} disabled={!!busy} accent="#22c55e">Resume</Button>
        )}
        {runtime.frozen && (
          <Button onClick={onUnfreeze} disabled={!!busy} accent="#f97316">Unfreeze (human sign-off)</Button>
        )}
        {!stopped && !runtime.frozen && runtime.status !== 'unstarted' && (
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
