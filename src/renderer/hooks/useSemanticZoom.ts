import { useEffect, useState } from 'react'
import { useReactFlow, useStore } from '@xyflow/react'

export type ZoomTier = 'full' | 'compact' | 'badge'

export interface ZoomThresholds {
  compact: number
  badge: number
}

const DEFAULT_THRESHOLDS: ZoomThresholds = {
  compact: 0.6,
  badge: 0.3
}

function tierFor(zoom: number, thresholds: ZoomThresholds): ZoomTier {
  if (zoom < thresholds.badge) return 'badge'
  if (zoom < thresholds.compact) return 'compact'
  return 'full'
}

/**
 * Semantic zoom hook. Returns the current display tier for a tile based on
 * the ReactFlow viewport zoom. Tiles that opt in can render a different
 * representation per tier (full editor → compact summary → single-color badge).
 *
 * Must be called inside a ReactFlow provider (which tile components already are).
 */
export function useSemanticZoom(thresholds: ZoomThresholds = DEFAULT_THRESHOLDS): ZoomTier {
  const reactFlow = useReactFlow()
  const [tier, setTier] = useState<ZoomTier>(() => tierFor(reactFlow.getZoom(), thresholds))

  // Subscribe to transform changes via the internal ReactFlow store.
  const transform = useStore((s) => s.transform)

  useEffect(() => {
    const zoom = transform?.[2] ?? reactFlow.getZoom()
    setTier(tierFor(zoom, thresholds))
  }, [transform, reactFlow, thresholds])

  return tier
}
