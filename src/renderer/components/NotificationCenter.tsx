import { memo, useEffect, useRef, useState } from 'react'
import {
  useNotifications,
  markAllRead,
  markTerminalRead,
  clearAllNotifications,
  removeNotification,
  type StoredNotification
} from '../hooks/useNotifications'

interface NotificationCenterProps {
  onFocusTerminal: (sessionId: string) => void
}

const LEVEL_COLORS: Record<string, string> = {
  info: '#3b82f6',
  success: '#22c55e',
  warning: '#eab308',
  error: '#ef4444'
}

function relativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function LevelIcon({ level }: { level: string }) {
  const color = LEVEL_COLORS[level] || LEVEL_COLORS.info
  if (level === 'success') {
    return (
      <svg className="h-3.5 w-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    )
  }
  if (level === 'warning') {
    return (
      <svg className="h-3.5 w-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
      </svg>
    )
  }
  if (level === 'error') {
    return (
      <svg className="h-3.5 w-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    )
  }
  return (
    <svg className="h-3.5 w-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
    </svg>
  )
}

function NotificationItem({
  notification,
  onActivate
}: {
  notification: StoredNotification
  onActivate: (n: StoredNotification) => void
}) {
  const accent = LEVEL_COLORS[notification.level] || LEVEL_COLORS.info
  return (
    <div
      className={`group flex cursor-pointer items-start gap-2 border-l-2 px-3 py-2 transition-colors hover:bg-zinc-800/60 ${
        notification.read ? 'opacity-60' : ''
      }`}
      style={{ borderLeftColor: accent }}
      onClick={() => onActivate(notification)}
    >
      <div className="mt-0.5">
        <LevelIcon level={notification.level} />
      </div>
      <div className="min-w-0 flex-1">
        {notification.title && (
          <div className="truncate text-xs font-semibold text-zinc-200">{notification.title}</div>
        )}
        <div className="text-[11px] leading-snug text-zinc-400 break-words">{notification.body}</div>
        <div className="mt-1 flex items-center gap-2 text-[10px] text-zinc-600">
          <span>{relativeTime(notification.timestamp)}</span>
          {notification.terminalId && <span className="truncate">· tap to focus</span>}
        </div>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation()
          removeNotification(notification.id)
        }}
        className="mt-0.5 shrink-0 rounded p-0.5 text-zinc-600 opacity-0 transition-opacity hover:bg-zinc-700 hover:text-zinc-300 group-hover:opacity-100"
        aria-label="Remove notification"
      >
        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}

export const NotificationCenter = memo(function NotificationCenter({
  onFocusTerminal
}: NotificationCenterProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const { notifications, unreadCount } = useNotifications()

  // Click outside to close
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as HTMLElement)) {
        setOpen(false)
      }
    }
    const timer = setTimeout(() => document.addEventListener('mousedown', handler), 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handler)
    }
  }, [open])

  // Escape to close
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  // Force re-render once a minute so relative timestamps stay fresh while open
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!open) return
    const t = setInterval(() => setTick((v) => v + 1), 30_000)
    return () => clearInterval(t)
  }, [open])

  const handleActivate = (n: StoredNotification): void => {
    if (n.terminalId) {
      onFocusTerminal(n.terminalId)
      markTerminalRead(n.terminalId)
    }
    setOpen(false)
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`relative rounded p-1.5 transition-colors hover:bg-zinc-800 ${
          unreadCount > 0 ? 'text-zinc-200' : 'text-zinc-500 hover:text-zinc-200'
        }`}
        title={unreadCount > 0 ? `${unreadCount} unread notification${unreadCount === 1 ? '' : 's'}` : 'Notifications'}
        aria-label="Notifications"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
          />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold leading-none text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 top-full z-50 mt-2 flex max-h-[480px] w-96 flex-col overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
            <span className="text-xs font-semibold text-zinc-200">
              Notifications {unreadCount > 0 && <span className="text-zinc-500">({unreadCount} unread)</span>}
            </span>
            {notifications.length > 0 && (
              <div className="flex gap-2">
                {unreadCount > 0 && (
                  <button
                    onClick={markAllRead}
                    className="text-[10px] text-zinc-400 transition-colors hover:text-zinc-200"
                  >
                    Mark all read
                  </button>
                )}
                <button
                  onClick={clearAllNotifications}
                  className="text-[10px] text-zinc-400 transition-colors hover:text-zinc-200"
                >
                  Clear
                </button>
              </div>
            )}
          </div>
          <div className="flex-1 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-zinc-500">
                No notifications yet.
                <div className="mt-1 text-[10px] text-zinc-600">
                  Agents in terminal tiles can post toasts here via{' '}
                  <code className="text-zinc-500">$AGENT_CANVAS_API/api/notify</code>
                </div>
              </div>
            ) : (
              notifications.map((n) => (
                <NotificationItem key={n.id} notification={n} onActivate={handleActivate} />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
})
