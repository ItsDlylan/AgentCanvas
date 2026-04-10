import { useSyncExternalStore } from 'react'
import type { CanvasNotification } from '../../preload/index'

/**
 * Global store for canvas notifications.
 *
 * Subscribes to window.notify.onNotify once (lazily) and maintains:
 *   - A history of the last 100 notifications (newest first)
 *   - A per-terminal unread counter
 *   - A total unread counter
 *
 * Per-tile subscribers (useUnreadForTile) get immediate updates so badges
 * react instantly. Bulk subscribers (useAllUnread, useNotifications) are
 * batched at 200ms to avoid re-rendering large panels for every event.
 */

export type StoredNotification = CanvasNotification & {
  read: boolean
}

interface NotificationSnapshot {
  notifications: StoredNotification[]
  unreadByTerminal: Map<string, number>
  unreadTotal: number
}

const MAX_HISTORY = 100
const BATCH_INTERVAL_MS = 200

let snapshot: NotificationSnapshot = {
  notifications: [],
  unreadByTerminal: new Map(),
  unreadTotal: 0
}
let batchedSnapshot: NotificationSnapshot = snapshot

type Listener = () => void

const immediateListeners = new Set<Listener>()
const batchListeners = new Set<Listener>()
let batchTimer: ReturnType<typeof setTimeout> | null = null
let subscribed = false

function notifyImmediate(): void {
  immediateListeners.forEach((l) => l())
}

function scheduleBatchNotify(): void {
  if (batchTimer) return
  batchTimer = setTimeout(() => {
    batchTimer = null
    batchedSnapshot = snapshot
    batchListeners.forEach((l) => l())
  }, BATCH_INTERVAL_MS)
}

function ensureSubscribed(): void {
  if (subscribed) return
  subscribed = true
  window.notify.onNotify((n) => addNotification(n))
}

// ── Mutators ─────────────────────────────────────────────

function addNotification(n: CanvasNotification): void {
  const stored: StoredNotification = { ...n, read: false }
  const newNotifications = [stored, ...snapshot.notifications].slice(0, MAX_HISTORY)

  let newUnreadMap = snapshot.unreadByTerminal
  if (n.terminalId) {
    newUnreadMap = new Map(newUnreadMap)
    newUnreadMap.set(n.terminalId, (newUnreadMap.get(n.terminalId) || 0) + 1)
  }

  snapshot = {
    notifications: newNotifications,
    unreadByTerminal: newUnreadMap,
    unreadTotal: snapshot.unreadTotal + 1
  }

  notifyImmediate()
  scheduleBatchNotify()
}

export function markTerminalRead(terminalId: string): void {
  const count = snapshot.unreadByTerminal.get(terminalId) || 0
  if (count === 0) return

  const newUnreadMap = new Map(snapshot.unreadByTerminal)
  newUnreadMap.delete(terminalId)

  const newNotifications = snapshot.notifications.map((n) =>
    n.terminalId === terminalId && !n.read ? { ...n, read: true } : n
  )

  snapshot = {
    notifications: newNotifications,
    unreadByTerminal: newUnreadMap,
    unreadTotal: Math.max(0, snapshot.unreadTotal - count)
  }

  notifyImmediate()
  scheduleBatchNotify()
}

export function markAllRead(): void {
  if (snapshot.unreadTotal === 0) return
  snapshot = {
    notifications: snapshot.notifications.map((n) => (n.read ? n : { ...n, read: true })),
    unreadByTerminal: new Map(),
    unreadTotal: 0
  }
  notifyImmediate()
  scheduleBatchNotify()
}

export function clearAllNotifications(): void {
  snapshot = {
    notifications: [],
    unreadByTerminal: new Map(),
    unreadTotal: 0
  }
  notifyImmediate()
  scheduleBatchNotify()
}

export function removeNotification(id: string): void {
  const removed = snapshot.notifications.find((n) => n.id === id)
  if (!removed) return

  const newNotifications = snapshot.notifications.filter((n) => n.id !== id)
  let newUnreadMap = snapshot.unreadByTerminal
  let newTotal = snapshot.unreadTotal

  if (!removed.read) {
    newTotal = Math.max(0, newTotal - 1)
    if (removed.terminalId) {
      const count = newUnreadMap.get(removed.terminalId) || 0
      newUnreadMap = new Map(newUnreadMap)
      if (count > 1) {
        newUnreadMap.set(removed.terminalId, count - 1)
      } else {
        newUnreadMap.delete(removed.terminalId)
      }
    }
  }

  snapshot = {
    notifications: newNotifications,
    unreadByTerminal: newUnreadMap,
    unreadTotal: newTotal
  }

  notifyImmediate()
  scheduleBatchNotify()
}

// ── Subscription plumbing ────────────────────────────────

function subscribeImmediate(listener: Listener): () => void {
  immediateListeners.add(listener)
  ensureSubscribed()
  return () => {
    immediateListeners.delete(listener)
  }
}

function subscribeBatch(listener: Listener): () => void {
  batchListeners.add(listener)
  ensureSubscribed()
  return () => {
    batchListeners.delete(listener)
  }
}

function getSnapshot(): NotificationSnapshot {
  return snapshot
}

function getBatchedSnapshot(): NotificationSnapshot {
  return batchedSnapshot
}

// ── Hooks ────────────────────────────────────────────────

/** Per-tile unread count. Reactive immediately so badges flash on arrival. */
export function useUnreadForTile(sessionId: string): number {
  const s = useSyncExternalStore(subscribeImmediate, getSnapshot)
  return s.unreadByTerminal.get(sessionId) || 0
}

/** Bulk unread map for panels that look up many tiles inline. Batched. */
export function useAllUnread(): Map<string, number> {
  const s = useSyncExternalStore(subscribeBatch, getBatchedSnapshot)
  return s.unreadByTerminal
}

/** Notification history + total unread count, for the notification center. */
export function useNotifications(): { notifications: StoredNotification[]; unreadCount: number } {
  const s = useSyncExternalStore(subscribeImmediate, getSnapshot)
  return { notifications: s.notifications, unreadCount: s.unreadTotal }
}
