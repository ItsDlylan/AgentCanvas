import { useEffect } from 'react'
import { useFlowMuteStore } from '../store/flow-mute-store'

/**
 * Global keydown/click listener that pings the flow-mute store.
 *
 * The store decides whether the activity counts — it checks focusedId, mode,
 * and the enabled setting. Pan/zoom on the canvas background naturally doesn't
 * count because onPaneClick sets focusedId to null, which transitions the
 * store out of any armed/active state.
 *
 * Mount once at the top of Canvas.
 */
export function useActivityTracker(): void {
  useEffect(() => {
    const onKey = () => {
      useFlowMuteStore.getState().onActivity()
    }
    const onClick = () => {
      useFlowMuteStore.getState().onActivity()
    }
    const onBlur = () => {
      useFlowMuteStore.getState().onWindowBlur()
    }
    const onFocus = () => {
      useFlowMuteStore.getState().onWindowFocus()
    }

    window.addEventListener('keydown', onKey, true)
    window.addEventListener('click', onClick, true)
    window.addEventListener('blur', onBlur)
    window.addEventListener('focus', onFocus)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('click', onClick, true)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('focus', onFocus)
    }
  }, [])
}
