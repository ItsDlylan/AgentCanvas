import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useSettings } from '../hooks/useSettings'
import { markTerminalRead } from '../hooks/useNotifications'
import type { CanvasNotification } from '../../preload/index'

interface ToastItem extends CanvasNotification {
  exiting?: boolean
}

interface NotificationToastProps {
  onFocusTerminal: (sessionId: string) => void
}

const MAX_VISIBLE = 5

const LEVEL_COLORS: Record<string, string> = {
  info: '#3b82f6',
  success: '#22c55e',
  warning: '#eab308',
  error: '#ef4444'
}

const PRIORITY_RANK: Record<string, number> = {
  critical: 3,
  high: 2,
  normal: 1,
  low: 0
}

function priorityOf(toast: ToastItem): number {
  return PRIORITY_RANK[toast.priority || 'normal'] ?? 1
}

function playNotificationSound(level: string): void {
  try {
    const ctx = new AudioContext()
    const now = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = level === 'error' ? 330 : 523
    gain.gain.setValueAtTime(0.25, now)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(now)
    osc.stop(now + 0.3)
    setTimeout(() => ctx.close(), 500)
  } catch {
    // Audio not available
  }
}

function LevelIcon({ level }: { level: string }) {
  const color = LEVEL_COLORS[level] || LEVEL_COLORS.info
  if (level === 'success') {
    return (
      <svg className="h-4 w-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    )
  }
  if (level === 'warning') {
    return (
      <svg className="h-4 w-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
      </svg>
    )
  }
  if (level === 'error') {
    return (
      <svg className="h-4 w-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    )
  }
  // info
  return (
    <svg className="h-4 w-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
    </svg>
  )
}

export function NotificationToast({ onFocusTerminal }: NotificationToastProps) {
  const { settings } = useSettings()
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const timersRef = useRef<Map<string, NodeJS.Timeout>>(new Map())

  const dismiss = useCallback((id: string) => {
    // Clear any existing timer
    const timer = timersRef.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timersRef.current.delete(id)
    }
    // Start exit animation
    setToasts(prev => prev.map(t => t.id === id ? { ...t, exiting: true } : t))
    // Remove after animation
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 300)
  }, [])

  // Subscribe to notification events
  useEffect(() => {
    const unsub = window.notify.onNotify((notification) => {
      if (!settings.notifications?.enabled) return

      setToasts(prev => {
        const next = [...prev, notification]
        // If over max, dismiss the lowest-priority non-exiting toast
        // (ties broken by oldest-first via timestamp)
        if (next.length > MAX_VISIBLE) {
          const candidates = next.filter(t => !t.exiting)
          if (candidates.length > 0) {
            const victim = candidates.reduce((lowest, t) => {
              const lp = priorityOf(lowest)
              const tp = priorityOf(t)
              if (tp < lp) return t
              if (tp === lp && t.timestamp < lowest.timestamp) return t
              return lowest
            })
            // Only dismiss if the incoming toast outranks the victim, otherwise
            // drop the incoming one instead (prevents critical from being evicted)
            if (priorityOf(victim) <= priorityOf(notification)) {
              setTimeout(() => dismiss(victim.id), 0)
            } else {
              setTimeout(() => dismiss(notification.id), 0)
            }
          }
        }
        return next
      })

      // Play sound if enabled
      if (notification.sound && settings.notifications?.soundEnabled) {
        playNotificationSound(notification.level)
      }

      // Auto-dismiss if duration > 0
      if (notification.duration > 0) {
        const timer = setTimeout(() => {
          dismiss(notification.id)
          timersRef.current.delete(notification.id)
        }, notification.duration)
        timersRef.current.set(notification.id, timer)
      }
    })

    return () => {
      unsub()
      // Clean up all timers
      timersRef.current.forEach(t => clearTimeout(t))
      timersRef.current.clear()
    }
  }, [settings.notifications?.enabled, settings.notifications?.soundEnabled, dismiss])

  if (toasts.length === 0) return null

  // Sort by priority (low first; column-reverse puts highest visually on top)
  // Ties broken by arrival order (older first in array → older visually lower).
  const sortedToasts = [...toasts].sort((a, b) => {
    const diff = priorityOf(a) - priorityOf(b)
    if (diff !== 0) return diff
    return a.timestamp - b.timestamp
  })

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        bottom: 16,
        right: 16,
        zIndex: 9998,
        display: 'flex',
        flexDirection: 'column-reverse',
        gap: 8,
        pointerEvents: 'none',
        maxWidth: 360
      }}
    >
      {sortedToasts.map(toast => (
        <div
          key={toast.id}
          role="alert"
          onClick={() => {
            if (toast.terminalId) {
              onFocusTerminal(toast.terminalId)
              markTerminalRead(toast.terminalId)
            }
            dismiss(toast.id)
          }}
          style={{
            pointerEvents: 'auto',
            animation: toast.exiting ? 'toast-exit 0.3s ease-in forwards' : 'toast-enter 0.3s ease-out',
            background: '#18181b',
            border: '1px solid #27272a',
            borderLeft: `3px solid ${LEVEL_COLORS[toast.level] || LEVEL_COLORS.info}`,
            borderRadius: 8,
            padding: '10px 12px',
            cursor: toast.terminalId ? 'pointer' : 'default',
            fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace",
            fontSize: 12,
            color: '#d4d4d8',
            maxWidth: 360,
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8
          }}
        >
          <LevelIcon level={toast.level} />
          <div style={{ flex: 1, minWidth: 0 }}>
            {toast.title && (
              <div style={{ fontWeight: 600, color: '#e4e4e7', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {toast.title}
              </div>
            )}
            <div style={{ color: '#a1a1aa', lineHeight: 1.4, wordBreak: 'break-word' }}>
              {toast.body}
            </div>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation()
              dismiss(toast.id)
            }}
            aria-label="Dismiss notification"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 2,
              color: '#52525b',
              flexShrink: 0,
              lineHeight: 1
            }}
            onMouseEnter={(e) => { (e.target as HTMLElement).style.color = '#a1a1aa' }}
            onMouseLeave={(e) => { (e.target as HTMLElement).style.color = '#52525b' }}
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  )
}
