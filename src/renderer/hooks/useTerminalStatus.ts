import { useSyncExternalStore } from 'react'

export type TerminalStatus = 'idle' | 'running' | 'waiting'

export interface TerminalStatusInfo {
  status: TerminalStatus
  cwd: string
  foregroundProcess: string
}

type Listener = () => void

/**
 * Global store for terminal status updates.
 * Each IPC update creates a new Map reference so React detects the change.
 */
let statusMap = new Map<string, TerminalStatusInfo>()
const listeners = new Set<Listener>()
let subscribed = false

function notify(): void {
  listeners.forEach((l) => l())
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener)

  if (!subscribed) {
    subscribed = true
    window.terminal.onStatus((id, info) => {
      // Create a new Map so the reference changes and React re-renders
      const next = new Map(statusMap)
      next.set(id, info)
      statusMap = next
      notify()
    })
  }

  return () => listeners.delete(listener)
}

function getSnapshot(): Map<string, TerminalStatusInfo> {
  return statusMap
}

export function useTerminalStatus(sessionId: string): TerminalStatusInfo | undefined {
  const store = useSyncExternalStore(subscribe, getSnapshot)
  return store.get(sessionId)
}

export function useAllTerminalStatuses(): Map<string, TerminalStatusInfo> {
  return useSyncExternalStore(subscribe, getSnapshot)
}
