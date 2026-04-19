import { create } from 'zustand'
import { v4 as uuid } from 'uuid'
import type { CanvasNotification } from '../../preload/index'
import type { FlowMuteSettings } from '@/types/settings'
import { useCanvasStore } from './canvas-store'

// ── Constants ────────────────────────────────────────────

const ACTIVITY_WINDOW_MS = 60_000
const COOLDOWN_MS = 2 * 60_000

// ── Types ────────────────────────────────────────────────

export type FlowMuteMode = 'off' | 'armed' | 'active'

export interface FlowMuteStore {
  // ── State ──
  mode: FlowMuteMode
  targetId: string | null
  lastFocusedAt: number | null
  lastActivityAt: number | null
  flowStartedAt: number | null
  blurStartAt: number | null
  blurredMs: number
  suppressedQueue: CanvasNotification[]
  cooldownUntil: number | null
  cooldownTargetId: string | null
  settings: FlowMuteSettings

  // ── Setters ──
  setSettings: (s: FlowMuteSettings) => void

  // ── Signals ──
  setFocus: (id: string | null, now?: number) => void
  onActivity: (now?: number) => void
  onWindowBlur: (now?: number) => void
  onWindowFocus: (now?: number) => void

  // ── Transitions ──
  enterFlow: (id: string, opts?: { manual?: boolean }) => void
  exitFlow: (opts: { reason: 'focus-switch' | 'idle' | 'manual' | 'disabled' | 'tile-killed'; replay: boolean }) => void

  // ── Queue ──
  enqueue: (n: CanvasNotification) => void

  // ── Tick ──
  tick: (now?: number) => void

  // ── Predicates ──
  shouldSuppress: (n: CanvasNotification) => boolean
  isInFlowGroup: (tileId: string) => boolean
}

// ── Defaults ──────────────────────────────────────────────

const DEFAULT_SETTINGS: FlowMuteSettings = {
  enabled: true,
  idleTimeoutMs: 300_000,
  entryThresholdMs: 180_000,
  suppressNative: true,
  muteSounds: true,
  showRing: true
}

// ── Helpers ───────────────────────────────────────────────

/**
 * Compute X's flow group: X itself + any tile directly linked to X via
 * a canvas edge. Single hop, any direction.
 */
function computeFlowGroup(targetId: string): Set<string> {
  const group = new Set<string>([targetId])
  const edges = useCanvasStore.getState().allEdges
  for (const e of edges) {
    if (e.source === targetId) group.add(e.target)
    else if (e.target === targetId) group.add(e.source)
  }
  return group
}

function tileLabelFor(id: string): string {
  const node = useCanvasStore.getState().allNodes.find(
    (n) => (n.data as Record<string, unknown>).sessionId === id
  )
  return (node?.data as Record<string, unknown> | undefined)?.label as string || 'tile'
}

/**
 * Emit a rollup notification summarizing suppressed events.
 * Bypasses the renderer's normal notify path; goes straight to Toast via the
 * window.notify preload bridge. The rollup carries a special metadata flag so
 * the Toast can render it as the grouped variant.
 */
function emitRollup(target: string | null, queue: CanvasNotification[]): void {
  if (queue.length === 0) return

  // Group by source tile
  const byTile = new Map<string, CanvasNotification[]>()
  for (const n of queue) {
    const key = n.terminalId || '__unknown__'
    const arr = byTile.get(key) || []
    arr.push(n)
    byTile.set(key, arr)
  }

  const targetLabel = target ? tileLabelFor(target) : 'a tile'
  const rollup: CanvasNotification & { __rollup__?: unknown } = {
    id: `rollup-${uuid()}`,
    title: `While focused on ${targetLabel}`,
    body: `${byTile.size} ${byTile.size === 1 ? 'tile' : 'tiles'} · ${queue.length} ${queue.length === 1 ? 'event' : 'events'}`,
    level: 'info',
    priority: 'normal',
    duration: 0, // sticky — user clicks to expand/dismiss
    sound: false,
    timestamp: Date.now(),
    __rollup__: Array.from(byTile.entries()).map(([tileId, events]) => ({
      tileId,
      tileLabel: tileId === '__unknown__' ? 'Unknown' : tileLabelFor(tileId),
      events
    }))
  }

  // Dispatch a DOM event the Toast component listens for. Doing it this way
  // avoids routing through window.notify (which would go through main→renderer
  // IPC unnecessarily since we're already in the renderer).
  window.dispatchEvent(new CustomEvent('flow-mute:rollup', { detail: rollup }))
}

// ── Store ──────────────────────────────────────────────────

export const useFlowMuteStore = create<FlowMuteStore>((set, get) => ({
  mode: 'off',
  targetId: null,
  lastFocusedAt: null,
  lastActivityAt: null,
  flowStartedAt: null,
  blurStartAt: null,
  blurredMs: 0,
  suppressedQueue: [],
  cooldownUntil: null,
  cooldownTargetId: null,
  settings: DEFAULT_SETTINGS,

  setSettings: (s) => {
    const prev = get().settings
    set({ settings: s })
    // If toggled off mid-flow, exit cleanly
    if (prev.enabled && !s.enabled && get().mode !== 'off') {
      get().exitFlow({ reason: 'disabled', replay: true })
    }
  },

  setFocus: (id, now = Date.now()) => {
    const s = get()
    if (!s.settings.enabled) return

    if (id === null) {
      // Pane click / focus lost.
      if (s.mode === 'active') {
        get().exitFlow({ reason: 'focus-switch', replay: true })
      } else if (s.mode === 'armed') {
        set({ mode: 'off', targetId: null, lastFocusedAt: null, lastActivityAt: null, blurStartAt: null, blurredMs: 0 })
      }
      return
    }

    if (s.mode === 'off') {
      // Cooldown fast-path: refocusing same target within 2 min → immediate active
      if (s.cooldownUntil && now < s.cooldownUntil && s.cooldownTargetId === id) {
        set({ mode: 'active', targetId: id, flowStartedAt: now, lastFocusedAt: now, lastActivityAt: now, blurStartAt: null, blurredMs: 0, suppressedQueue: [], cooldownUntil: null, cooldownTargetId: null })
        return
      }
      set({ mode: 'armed', targetId: id, lastFocusedAt: now, lastActivityAt: null, blurStartAt: null, blurredMs: 0 })
    } else if (s.mode === 'armed') {
      if (id !== s.targetId) {
        set({ targetId: id, lastFocusedAt: now, lastActivityAt: null, blurStartAt: null, blurredMs: 0 })
      }
    } else {
      // mode === 'active'
      if (id === s.targetId) return
      if (s.targetId && computeFlowGroup(s.targetId).has(id)) return // linked tile — stay in flow
      // Unlinked switch → exit, then arm for new target
      get().exitFlow({ reason: 'focus-switch', replay: true })
      set({ mode: 'armed', targetId: id, lastFocusedAt: now, lastActivityAt: null, blurStartAt: null, blurredMs: 0 })
    }
  },

  onActivity: (now = Date.now()) => {
    const s = get()
    if (!s.settings.enabled) return
    if (s.mode === 'off') return
    set({ lastActivityAt: now })
  },

  onWindowBlur: (now = Date.now()) => {
    const s = get()
    if (s.mode !== 'armed') return // only freeze entry clock while armed
    if (s.blurStartAt !== null) return
    set({ blurStartAt: now })
  },

  onWindowFocus: (now = Date.now()) => {
    const s = get()
    if (s.blurStartAt === null) return
    set({ blurredMs: s.blurredMs + (now - s.blurStartAt), blurStartAt: null })
  },

  enterFlow: (id, opts = {}) => {
    const now = Date.now()
    set({
      mode: 'active',
      targetId: id,
      flowStartedAt: now,
      lastFocusedAt: now,
      lastActivityAt: now, // count the entry itself as activity so idle-timeout doesn't fire immediately
      blurStartAt: null,
      blurredMs: 0,
      suppressedQueue: [],
      cooldownUntil: null,
      cooldownTargetId: null
    })
    void opts // manual flag reserved for future telemetry
  },

  exitFlow: ({ reason, replay }) => {
    const s = get()
    if (s.mode === 'off') return
    const prevTarget = s.targetId
    const queue = s.suppressedQueue
    const now = Date.now()

    set({
      mode: 'off',
      targetId: null,
      flowStartedAt: null,
      lastFocusedAt: null,
      lastActivityAt: null,
      blurStartAt: null,
      blurredMs: 0,
      suppressedQueue: [],
      cooldownUntil: reason === 'disabled' ? null : now + COOLDOWN_MS,
      cooldownTargetId: reason === 'disabled' ? null : prevTarget
    })

    if (replay && queue.length > 0) {
      emitRollup(prevTarget, queue)
    }
  },

  enqueue: (n) => {
    const s = get()
    if (s.mode !== 'active') return
    set({ suppressedQueue: [...s.suppressedQueue, n] })
  },

  tick: (now = Date.now()) => {
    const s = get()
    if (!s.settings.enabled) return
    const frozen = s.blurStartAt !== null ? now - s.blurStartAt : 0

    if (s.mode === 'armed') {
      if (s.lastFocusedAt === null) return
      const focusedFor = now - s.lastFocusedAt - s.blurredMs - frozen
      if (focusedFor < s.settings.entryThresholdMs) return
      if (s.lastActivityAt === null) return
      const sinceActivity = now - s.lastActivityAt - s.blurredMs - frozen
      if (sinceActivity > ACTIVITY_WINDOW_MS) return
      if (!s.targetId) return
      get().enterFlow(s.targetId)
    } else if (s.mode === 'active') {
      if (s.lastActivityAt === null) return
      const idleFor = now - s.lastActivityAt
      if (idleFor > s.settings.idleTimeoutMs) {
        get().exitFlow({ reason: 'idle', replay: true })
      }
    }
  },

  shouldSuppress: (n) => {
    const s = get()
    if (!s.settings.enabled) return false
    if (s.mode !== 'active') return false
    if (n.priority === 'critical') return false
    if (n.level === 'error') return false
    if (n.terminalId && get().isInFlowGroup(n.terminalId)) return false
    return true
  },

  isInFlowGroup: (tileId) => {
    const { targetId } = get()
    if (!targetId) return false
    if (tileId === targetId) return true
    return computeFlowGroup(targetId).has(tileId)
  }
}))
