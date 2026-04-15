// ── Ambient Visual Monitoring ────────────────────────────
// Watches terminal status changes, exits, and notifications.
// Fires events for the VoiceIndicator to flash based on user settings.
// No TTS — all feedback is visual.

import type { VoiceSettings } from './types'
import { useCanvasStore } from '@/store/canvas-store'
import type { TerminalStatusInfo } from '@/hooks/useTerminalStatus'

export interface AmbientEvent {
  type: 'waiting' | 'error' | 'exit' | 'notification'
  label: string
  message: string
}

export interface AmbientMonitor {
  destroy: () => void
}

export function createAmbientMonitor(
  settings: VoiceSettings['ambientMonitoring'],
  onEvent: (event: AmbientEvent) => void
): AmbientMonitor {
  const cleanups: Array<() => void> = []

  // Track previous status per terminal for transition detection
  const prevStatus = new Map<string, string>()

  // ── Terminal status changes ──
  if (settings.onWaiting) {
    const unsub = window.terminal.onStatus((id: string, info: TerminalStatusInfo) => {
      const prev = prevStatus.get(id)
      prevStatus.set(id, info.status)

      // Detect transition to 'waiting'
      if (info.status === 'waiting' && prev && prev !== 'waiting') {
        const label = getTileLabel(id)
        onEvent({
          type: 'waiting',
          label,
          message: `${label} is waiting for input`
        })
      }
    })
    cleanups.push(unsub)
  }

  // ── Terminal exits ──
  if (settings.onExit) {
    const unsub = window.terminal.onExit((id: string, exitCode: number) => {
      const label = getTileLabel(id)
      onEvent({
        type: 'exit',
        label,
        message: `${label} exited (${exitCode})`
      })
    })
    cleanups.push(unsub)
  }

  // ── Notifications ──
  if (settings.onError || settings.onNotification) {
    const unsub = window.notify.onNotify((n) => {
      // Error notifications
      if (settings.onError && n.level === 'error') {
        onEvent({
          type: 'error',
          label: n.title ?? 'Error',
          message: n.body
        })
        return
      }

      // All notifications
      if (settings.onNotification) {
        onEvent({
          type: 'notification',
          label: n.title ?? 'Notification',
          message: n.body
        })
      }
    })
    cleanups.push(unsub)
  }

  return {
    destroy: () => {
      for (const fn of cleanups) fn()
      cleanups.length = 0
      prevStatus.clear()
    }
  }
}

function getTileLabel(sessionId: string): string {
  const store = useCanvasStore.getState()
  const node = store.allNodes.find(
    (n) => (n.data as Record<string, unknown>).sessionId === sessionId
  )
  return node ? ((node.data as Record<string, unknown>).label as string) ?? sessionId.slice(0, 8) : sessionId.slice(0, 8)
}
