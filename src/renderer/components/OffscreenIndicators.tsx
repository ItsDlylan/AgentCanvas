import { memo, useState, useEffect, useRef } from 'react'
import { useOnViewportChange, type Node, type Viewport } from '@xyflow/react'
import { useAllTerminalStatuses, type TerminalStatus } from '@/hooks/useTerminalStatus'

interface OffscreenIndicatorsProps {
  nodes: Node[]
  focusedId: string | null
  onFocus: (sessionId: string) => void
}

const TERMINAL_W = 640
const TERMINAL_H = 400
const BROWSER_W = 800
const BROWSER_H = 600
const INDICATOR_SIZE = 12
const EDGE_PADDING = 24

const STATUS_COLORS: Record<TerminalStatus | 'browser', string> = {
  idle: '#71717a',
  running: '#22c55e',
  waiting: '#fbbf24',
  browser: '#10b981'
}

interface Indicator {
  sessionId: string
  label: string
  status: TerminalStatus | 'browser'
  screenX: number
  screenY: number
  isFocused: boolean
}

function compute(
  nodes: Node[],
  vx: number,
  vy: number,
  zoom: number,
  focusedId: string | null,
  statuses: Map<string, { status: TerminalStatus }>
): Indicator[] {
  const container = document.querySelector('.react-flow') as HTMLElement | null
  if (!container) return []

  const cw = container.clientWidth
  const ch = container.clientHeight
  const vl = -vx / zoom
  const vt = -vy / zoom
  const vr = vl + cw / zoom
  const vb = vt + ch / zoom
  const results: Indicator[] = []

  for (const node of nodes) {
    if (node.type !== 'terminal' && node.type !== 'browser') continue
    const data = node.data as Record<string, unknown>
    const sessionId = data.sessionId as string
    const label = data.label as string
    const tileW = node.type === 'browser' ? BROWSER_W : TERMINAL_W
    const tileH = node.type === 'browser' ? BROWSER_H : TERMINAL_H
    const cx = node.position.x + tileW / 2
    const cy = node.position.y + tileH / 2
    const m = 50 / zoom

    if (cx >= vl - m && cx <= vr + m && cy >= vt - m && cy <= vb + m) continue

    const vcx = (vl + vr) / 2
    const vcy = (vt + vb) / 2
    const dx = cx - vcx
    const dy = cy - vcy
    const hw = cw / 2 - EDGE_PADDING
    const hh = ch / 2 - EDGE_PADDING
    const sx = dx !== 0 ? Math.abs(hw / dx) : Infinity
    const sy = dy !== 0 ? Math.abs(hh / dy) : Infinity
    const s = Math.min(sx, sy)

    results.push({
      sessionId,
      label,
      status: node.type === 'browser' ? 'browser' : (statuses.get(sessionId)?.status ?? 'running'),
      screenX: Math.max(EDGE_PADDING, Math.min(cw - EDGE_PADDING, cw / 2 + dx * s)),
      screenY: Math.max(EDGE_PADDING, Math.min(ch - EDGE_PADDING, ch / 2 + dy * s)),
      isFocused: focusedId === sessionId
    })
  }

  return results
}

/**
 * Off-screen terminal indicators. Uses useOnViewportChange with
 * RAF throttling to avoid triggering React re-renders every frame.
 */
function OffscreenIndicatorsComponent({ nodes, focusedId, onFocus }: OffscreenIndicatorsProps) {
  const statuses = useAllTerminalStatuses()
  const [indicators, setIndicators] = useState<Indicator[]>([])
  const pendingRef = useRef<number | null>(null)
  const nodesRef = useRef(nodes)
  const focusedRef = useRef(focusedId)
  const statusesRef = useRef(statuses)

  nodesRef.current = nodes
  focusedRef.current = focusedId
  statusesRef.current = statuses

  // Update on viewport change, throttled to one rAF
  useOnViewportChange({
    onChange: (vp: Viewport) => {
      if (pendingRef.current) return
      pendingRef.current = requestAnimationFrame(() => {
        pendingRef.current = null
        setIndicators(
          compute(nodesRef.current, vp.x, vp.y, vp.zoom, focusedRef.current, statusesRef.current)
        )
      })
    }
  })

  // Also recompute when nodes/focus/statuses change (not viewport-driven)
  useEffect(() => {
    // Read viewport from the DOM transform
    const viewport = document.querySelector('.react-flow__viewport') as HTMLElement | null
    if (!viewport) return
    const style = getComputedStyle(viewport)
    const matrix = new DOMMatrix(style.transform)
    setIndicators(
      compute(nodes, matrix.e, matrix.f, matrix.a, focusedId, statuses)
    )
  }, [nodes, focusedId, statuses])

  useEffect(() => {
    return () => {
      if (pendingRef.current) cancelAnimationFrame(pendingRef.current)
    }
  }, [])

  if (indicators.length === 0) return null

  return (
    <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
      {indicators.map((ind) => {
        const color = ind.isFocused ? '#60a5fa' : STATUS_COLORS[ind.status]

        return (
          <button
            key={ind.sessionId}
            onClick={() => onFocus(ind.sessionId)}
            className="pointer-events-auto absolute hover:scale-125"
            style={{
              left: ind.screenX,
              top: ind.screenY,
              transform: 'translate(-50%, -50%)',
              willChange: 'transform'
            }}
            title={`${ind.label} — ${ind.status}`}
          >
            <span
              className="block rounded-full"
              style={{
                width: INDICATOR_SIZE,
                height: INDICATOR_SIZE,
                backgroundColor: color,
                boxShadow: `0 0 6px 2px ${color}60`
              }}
            />
          </button>
        )
      })}
    </div>
  )
}

export const OffscreenIndicators = memo(OffscreenIndicatorsComponent)
