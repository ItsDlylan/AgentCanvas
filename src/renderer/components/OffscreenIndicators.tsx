import { memo, useMemo } from 'react'
import { useReactFlow, useViewport, type Node } from '@xyflow/react'
import { useAllTerminalStatuses, type TerminalStatus } from '@/hooks/useTerminalStatus'

interface OffscreenIndicatorsProps {
  nodes: Node[]
  focusedId: string | null
  onFocus: (sessionId: string) => void
}

const TILE_W = 640
const TILE_H = 400
const INDICATOR_SIZE = 12
const EDGE_PADDING = 24

const STATUS_COLORS: Record<TerminalStatus, string> = {
  idle: '#71717a',     // zinc-500
  running: '#22c55e',  // green-500
  waiting: '#fbbf24'   // amber-400
}

/**
 * Renders small status dots on the viewport edge for terminals
 * that are currently off-screen. Clicking a dot pans to that terminal.
 */
function OffscreenIndicatorsComponent({ nodes, focusedId, onFocus }: OffscreenIndicatorsProps) {
  const { x: vx, y: vy, zoom } = useViewport()
  const { getViewportForBounds } = useReactFlow()
  const statuses = useAllTerminalStatuses()

  const indicators = useMemo(() => {
    // Get the viewport dimensions from the React Flow container
    const container = document.querySelector('.react-flow') as HTMLElement | null
    if (!container) return []

    const containerW = container.clientWidth
    const containerH = container.clientHeight

    // Viewport bounds in flow coordinates
    const viewLeft = -vx / zoom
    const viewTop = -vy / zoom
    const viewRight = viewLeft + containerW / zoom
    const viewBottom = viewTop + containerH / zoom

    const results: Array<{
      sessionId: string
      label: string
      status: TerminalStatus
      screenX: number
      screenY: number
      isFocused: boolean
    }> = []

    for (const node of nodes) {
      if (node.type !== 'terminal') continue

      const data = node.data as Record<string, unknown>
      const sessionId = data.sessionId as string
      const label = data.label as string

      // Center of the tile in flow coordinates
      const tileCx = node.position.x + TILE_W / 2
      const tileCy = node.position.y + TILE_H / 2

      // Check if the tile center is within the viewport (with some margin)
      const margin = 50 / zoom
      if (
        tileCx >= viewLeft - margin &&
        tileCx <= viewRight + margin &&
        tileCy >= viewTop - margin &&
        tileCy <= viewBottom + margin
      ) {
        continue // On-screen, skip
      }

      // Viewport center in flow coordinates
      const vcx = (viewLeft + viewRight) / 2
      const vcy = (viewTop + viewBottom) / 2

      // Direction from viewport center to tile center
      const dx = tileCx - vcx
      const dy = tileCy - vcy

      // Find intersection with viewport edge
      // Scale factor to reach each edge
      const halfW = (containerW / 2) - EDGE_PADDING
      const halfH = (containerH / 2) - EDGE_PADDING

      const scaleX = dx !== 0 ? Math.abs(halfW / dx) : Infinity
      const scaleY = dy !== 0 ? Math.abs(halfH / dy) : Infinity
      const scale = Math.min(scaleX, scaleY)

      // Screen position (relative to container)
      const screenX = Math.max(EDGE_PADDING, Math.min(containerW - EDGE_PADDING, containerW / 2 + dx * scale))
      const screenY = Math.max(EDGE_PADDING, Math.min(containerH - EDGE_PADDING, containerH / 2 + dy * scale))

      const info = statuses.get(sessionId)
      const status: TerminalStatus = info?.status ?? 'running'

      results.push({
        sessionId,
        label,
        status,
        screenX,
        screenY,
        isFocused: focusedId === sessionId
      })
    }

    return results
  }, [nodes, vx, vy, zoom, focusedId, statuses])

  if (indicators.length === 0) return null

  return (
    <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
      {indicators.map((ind) => {
        const color = ind.isFocused ? '#60a5fa' : STATUS_COLORS[ind.status]
        const isWaiting = ind.status === 'waiting'

        return (
          <button
            key={ind.sessionId}
            onClick={() => onFocus(ind.sessionId)}
            className="pointer-events-auto absolute flex items-center gap-1.5 transition-transform hover:scale-125"
            style={{
              left: ind.screenX,
              top: ind.screenY,
              transform: 'translate(-50%, -50%)'
            }}
            title={`${ind.label} — ${ind.status}`}
          >
            {/* Glow */}
            <span
              className="absolute rounded-full blur-sm"
              style={{
                width: INDICATOR_SIZE + 6,
                height: INDICATOR_SIZE + 6,
                backgroundColor: color,
                opacity: 0.3
              }}
            />
            {/* Dot */}
            <span
              className={`relative rounded-full border border-zinc-900/50 ${isWaiting ? 'animate-pulse' : ''}`}
              style={{
                width: INDICATOR_SIZE,
                height: INDICATOR_SIZE,
                backgroundColor: color,
                boxShadow: `0 0 8px ${color}80`
              }}
            />
          </button>
        )
      })}
    </div>
  )
}

export const OffscreenIndicators = memo(OffscreenIndicatorsComponent)
