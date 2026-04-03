import { useCallback, useEffect, useState } from 'react'
import { useOnViewportChange } from '@xyflow/react'

type Listener = (panning: boolean) => void

/**
 * Tracks whether the canvas is actively being panned/zoomed.
 * Broadcasts to subscribers so terminal tiles can disable
 * pointer-events during pan (Collaborator's key perf pattern).
 */
const listeners = new Set<Listener>()
let currentlyPanning = false
let panEndTimer: ReturnType<typeof setTimeout> | null = null

function setPanning(val: boolean): void {
  if (val === currentlyPanning) return
  currentlyPanning = val
  listeners.forEach((fn) => fn(val))
}

/**
 * Mount inside ReactFlow to detect pan start/end.
 */
export function usePanDetector(): void {
  useOnViewportChange({
    onStart: useCallback(() => {
      if (panEndTimer) clearTimeout(panEndTimer)
      setPanning(true)
    }, []),
    onEnd: useCallback(() => {
      if (panEndTimer) clearTimeout(panEndTimer)
      panEndTimer = setTimeout(() => setPanning(false), 80)
    }, [])
  })
}

/**
 * Returns true while canvas is being panned/zoomed.
 */
export function useIsPanning(): boolean {
  const [panning, setPanningLocal] = useState(false)

  useEffect(() => {
    listeners.add(setPanningLocal)
    return () => { listeners.delete(setPanningLocal) }
  }, [])

  return panning
}
