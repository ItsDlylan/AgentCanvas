import { useSyncExternalStore } from 'react'

export type TerminalStatus = 'idle' | 'running' | 'waiting'

export interface TerminalStatusInfo {
  status: TerminalStatus
  cwd: string
  foregroundProcess: string
  metadata?: Record<string, unknown>
}

type Listener = () => void

/**
 * Global store for terminal status updates.
 *
 * Per-session subscribers (useTerminalStatus) are notified immediately so
 * individual TerminalTile components stay responsive.
 *
 * Bulk subscribers (useAllTerminalStatuses) are batched/throttled to at most
 * once per 300ms to avoid expensive re-renders of ProcessPanel and
 * OffscreenIndicators on every status IPC event.
 */
let statusMap = new Map<string, TerminalStatusInfo>()
const immediateListeners = new Set<Listener>()
const batchListeners = new Set<Listener>()
let subscribed = false
let batchTimer: ReturnType<typeof setTimeout> | null = null
let batchedSnapshot = statusMap

function notifyImmediate(): void {
  immediateListeners.forEach((l) => l())
}

function scheduleBatchNotify(): void {
  if (batchTimer) return
  batchTimer = setTimeout(() => {
    batchTimer = null
    batchedSnapshot = statusMap
    batchListeners.forEach((l) => l())
  }, 300)
}

function ensureSubscribed(): void {
  if (subscribed) return
  subscribed = true
  window.terminal.onStatus((id, info) => {
    // New Map reference so React detects the change for immediate subscribers
    const next = new Map(statusMap)
    next.set(id, info)
    statusMap = next
    notifyImmediate()
    scheduleBatchNotify()
  })
}

function subscribeImmediate(listener: Listener): () => void {
  immediateListeners.add(listener)
  ensureSubscribed()
  return () => immediateListeners.delete(listener)
}

function subscribeBatch(listener: Listener): () => void {
  batchListeners.add(listener)
  ensureSubscribed()
  return () => batchListeners.delete(listener)
}

function getSnapshot(): Map<string, TerminalStatusInfo> {
  return statusMap
}

function getBatchedSnapshot(): Map<string, TerminalStatusInfo> {
  return batchedSnapshot
}

/** Per-session status — only the affected TerminalTile re-renders */
export function useTerminalStatus(sessionId: string): TerminalStatusInfo | undefined {
  const store = useSyncExternalStore(subscribeImmediate, getSnapshot)
  return store.get(sessionId)
}

/** All statuses — batched to avoid re-rendering ProcessPanel/OffscreenIndicators on every update */
export function useAllTerminalStatuses(): Map<string, TerminalStatusInfo> {
  return useSyncExternalStore(subscribeBatch, getBatchedSnapshot)
}
