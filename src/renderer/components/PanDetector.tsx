import { usePanDetector } from '@/hooks/usePanState'

/** Invisible component — mount inside <ReactFlow> to track pan state */
export function PanDetector() {
  usePanDetector()
  return null
}
