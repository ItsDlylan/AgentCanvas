// ── Voice Grid Overlay ───────────────────────────────────
// 3x3 numbered grid over the viewport for spatial navigation.
// "Show grid" activates, saying a number pans to that region.

import { useEffect } from 'react'
import { useReactFlow } from '@xyflow/react'

interface VoiceGridOverlayProps {
  active: boolean
  onSelect: (region: number) => void
  onDismiss: () => void
}

// Grid layout:
// 1 | 2 | 3
// 4 | 5 | 6
// 7 | 8 | 9

export function VoiceGridOverlay({ active, onSelect, onDismiss }: VoiceGridOverlayProps) {
  // Auto-dismiss after 10s
  useEffect(() => {
    if (!active) return
    const timer = setTimeout(onDismiss, 10000)
    return () => clearTimeout(timer)
  }, [active, onDismiss])

  if (!active) return null

  return (
    <div
      className="pointer-events-none absolute inset-0"
      style={{ zIndex: 50 }}
    >
      <div
        className="absolute inset-0 grid grid-cols-3 grid-rows-3"
        style={{ gap: 1 }}
      >
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
          <div
            key={n}
            className="flex items-center justify-center"
            style={{
              border: '1px solid rgba(59, 130, 246, 0.25)',
              background: 'rgba(59, 130, 246, 0.04)'
            }}
          >
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: '50%',
                background: 'rgba(59, 130, 246, 0.15)',
                border: '2px solid rgba(59, 130, 246, 0.4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 16,
                fontWeight: 700,
                color: 'rgba(147, 197, 253, 0.9)'
              }}
            >
              {n}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Given a grid region (1-9) and the current viewport dimensions,
 * returns the flow-coordinate center point to pan to.
 */
export function getGridRegionCenter(
  region: number,
  viewportWidth: number,
  viewportHeight: number,
  currentViewport: { x: number; y: number; zoom: number }
): { x: number; y: number } {
  const col = ((region - 1) % 3)      // 0, 1, 2
  const row = Math.floor((region - 1) / 3)  // 0, 1, 2

  // The viewport shows a window into flow space.
  // Current visible area in flow coords:
  const visibleWidth = viewportWidth / currentViewport.zoom
  const visibleHeight = viewportHeight / currentViewport.zoom
  const flowLeft = -currentViewport.x / currentViewport.zoom
  const flowTop = -currentViewport.y / currentViewport.zoom

  // Divide visible area into 3x3 grid and find center of selected cell
  const cellWidth = visibleWidth / 3
  const cellHeight = visibleHeight / 3

  return {
    x: flowLeft + cellWidth * col + cellWidth / 2,
    y: flowTop + cellHeight * row + cellHeight / 2
  }
}
