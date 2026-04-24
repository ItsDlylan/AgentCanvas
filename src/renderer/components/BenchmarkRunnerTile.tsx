import { useEffect, useRef, useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import { NodeResizer, Handle, Position } from '@xyflow/react'

/**
 * Status-only tile that surfaces live stderr + lifecycle from a benchmark
 * runner child process. The runner is forked and managed by the main
 * process (see benchmark-runner-manager.ts); this tile just listens for
 * canvas:runner-stderr / canvas:runner-exit broadcasts and renders them.
 *
 * Unlike TerminalTile, there is no PTY here — the child's stdio is piped
 * straight to the main process and forwarded via IPC.
 */
interface RunnerTileData {
  runnerTileId: string
  benchmarkId: string
  label: string
  worktreePath: string
  pid: number
}

const ACCENT = '#8b5cf6' // purple — runner tiles share the agent-worker palette
const MAX_LINES = 500

export function BenchmarkRunnerTile({ data, selected }: NodeProps): JSX.Element {
  const { runnerTileId, benchmarkId, label, worktreePath, pid } =
    data as unknown as RunnerTileData

  const [lines, setLines] = useState<string[]>([])
  const [exitCode, setExitCode] = useState<number | null | 'alive'>('alive')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const append = (chunk: string): void => {
      setLines((prev) => {
        const merged = (prev.length > 0 ? prev[prev.length - 1] : '') + chunk
        const split = merged.split('\n')
        const head = prev.slice(0, -1).concat(split.slice(0, -1))
        const tail = split[split.length - 1]
        const next = head.concat([tail])
        return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next
      })
    }

    const unsubStderr = window.benchmark.onRunnerStderr((info) => {
      if (info.benchmarkId === benchmarkId) append(info.chunk)
    })
    const unsubStdout = window.benchmark.onRunnerStdout((info) => {
      if (info.benchmarkId === benchmarkId) append(info.chunk)
    })
    const unsubExit = window.benchmark.onRunnerExit((info) => {
      if (info.benchmarkId === benchmarkId) setExitCode(info.code)
    })
    return () => {
      unsubStderr()
      unsubStdout()
      unsubExit()
    }
  }, [benchmarkId])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines])

  const statusLabel =
    exitCode === 'alive' ? `pid ${pid}` : exitCode === 2 ? 'frozen' : exitCode === 0 ? 'exited' : `exit ${exitCode}`
  const statusColor = exitCode === 'alive' ? '#22c55e' : exitCode === 2 ? '#ef4444' : '#9ca3af'

  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={360}
        minHeight={220}
        lineStyle={{ borderColor: ACCENT }}
        handleStyle={{ borderColor: ACCENT, backgroundColor: ACCENT }}
      />
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      <div
        data-tile-id={runnerTileId}
        style={{
          width: '100%',
          height: '100%',
          background: '#0f0f12',
          border: `1px solid ${selected ? ACCENT : '#2a2b32'}`,
          borderRadius: 8,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          fontFamily: 'ui-monospace, SF Mono, Menlo, monospace',
          color: '#e6e7ea'
        }}
      >
        <header
          className="runner-tile-header"
          style={{
            padding: '8px 10px',
            borderBottom: '1px solid #2a2b32',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            cursor: 'grab',
            background: '#14141a',
            flexShrink: 0
          }}
        >
          <div style={{ fontSize: 10, color: '#9ca3af', letterSpacing: 0.4, textTransform: 'uppercase' }}>
            Runner
          </div>
          <div style={{ fontSize: 12, fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {label}
          </div>
          <span
            style={{
              fontSize: 10,
              padding: '2px 6px',
              borderRadius: 3,
              background: `${statusColor}22`,
              color: statusColor,
              border: `1px solid ${statusColor}`,
              fontFamily: 'system-ui, -apple-system, sans-serif'
            }}
          >
            {statusLabel}
          </span>
        </header>
        <div
          ref={scrollRef}
          style={{
            flex: 1,
            overflow: 'auto',
            padding: '8px 10px',
            fontSize: 11,
            lineHeight: 1.4,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word'
          }}
        >
          {lines.length === 0 ? (
            <div style={{ color: '#6b7280' }}>(waiting for runner output…)</div>
          ) : (
            lines.map((line, i) => <div key={i}>{line}</div>)
          )}
        </div>
        <footer
          style={{
            padding: '6px 10px',
            borderTop: '1px solid #2a2b32',
            fontSize: 10,
            color: '#6b7280',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            display: 'flex',
            gap: 10,
            flexShrink: 0
          }}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
            {worktreePath}
          </span>
          <span>bench: {benchmarkId.slice(0, 8)}</span>
        </footer>
      </div>
    </>
  )
}
