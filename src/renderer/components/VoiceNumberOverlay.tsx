// ── Voice Number Overlay ─────────────────────────────────
// Renders numbered badges on visible tiles for voice targeting.
// "Show numbers" activates, "focus 3" targets tile 3, auto-dismisses after 10s.

import { useEffect } from 'react'
import { useReactFlow, useStore } from '@xyflow/react'

export interface NumberedTile {
  number: number
  sessionId: string
  label: string
  /** Position in flow coordinates */
  position: { x: number; y: number }
  width: number
  height: number
}

interface VoiceNumberOverlayProps {
  active: boolean
  tiles: NumberedTile[]
  onDismiss: () => void
}

export function VoiceNumberOverlay({ active, tiles, onDismiss }: VoiceNumberOverlayProps) {
  const { getViewport } = useReactFlow()
  const transform = useStore((s) => s.transform)

  // Auto-dismiss after 10s
  useEffect(() => {
    if (!active) return
    const timer = setTimeout(onDismiss, 10000)
    return () => clearTimeout(timer)
  }, [active, onDismiss])

  if (!active || tiles.length === 0) return null

  const [tx, ty, zoom] = transform

  return (
    <div
      className="pointer-events-none absolute inset-0"
      style={{ zIndex: 50 }}
    >
      {tiles.map((tile) => {
        // Convert flow coords to screen coords
        const screenX = tile.position.x * zoom + tx
        const screenY = tile.position.y * zoom + ty

        return (
          <div
            key={tile.sessionId}
            className="pointer-events-none absolute flex items-center justify-center"
            style={{
              left: screenX - 12,
              top: screenY - 12,
              width: 28,
              height: 28,
              borderRadius: '50%',
              background: '#3b82f6',
              border: '2px solid #1d4ed8',
              boxShadow: '0 2px 8px rgba(59, 130, 246, 0.5)',
              fontSize: 13,
              fontWeight: 700,
              color: '#fff',
              lineHeight: 1,
              zIndex: 51
            }}
          >
            {tile.number}
          </div>
        )
      })}
    </div>
  )
}
