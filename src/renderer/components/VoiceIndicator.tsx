import { useEffect, useRef } from 'react'
import { Panel } from '@xyflow/react'
import type { VoiceMode } from '@/voice/types'

interface VoiceIndicatorProps {
  mode: VoiceMode
  transcript: string | null
  error: string | null
  listeningSecondsLeft?: number | null
  onConfirm?: () => void
  onCancel?: () => void
}

export function VoiceIndicator({ mode, transcript, error, listeningSecondsLeft, onConfirm, onCancel }: VoiceIndicatorProps) {
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showTranscript = useRef(false)

  // Auto-dismiss transcript after 3s
  useEffect(() => {
    if (mode === 'idle' && transcript) {
      showTranscript.current = true
      dismissTimer.current = setTimeout(() => {
        showTranscript.current = false
      }, 3000)
    }
    return () => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current)
    }
  }, [mode, transcript])

  // Don't render when idle with nothing to show
  if (mode === 'idle' && !transcript && !error) return null

  return (
    <Panel position="top-center">
      <div
        className="flex items-center gap-2 rounded-full border px-3 py-1.5 shadow-lg backdrop-blur-sm"
        style={{
          marginTop: 8,
          background: 'rgba(24, 24, 27, 0.9)',
          borderColor: borderColor(mode, error),
          minWidth: 120,
          transition: 'border-color 0.2s, box-shadow 0.2s',
          boxShadow: mode === 'listening' ? `0 0 12px ${borderColor(mode, error)}40` : undefined
        }}
      >
        {/* Status icon */}
        <div className="flex-shrink-0">{statusIcon(mode, error)}</div>

        {/* Text */}
        <span className="text-xs text-zinc-300" style={{ maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {statusText(mode, transcript, error, listeningSecondsLeft)}
        </span>

        {/* Confirm/Cancel for confirming mode */}
        {mode === 'confirming' && (
          <div className="ml-2 flex items-center gap-1">
            <button
              onClick={onConfirm}
              className="rounded px-2 py-0.5 text-[10px] font-medium text-green-400 hover:bg-green-900/30"
            >
              Yes
            </button>
            <button
              onClick={onCancel}
              className="rounded px-2 py-0.5 text-[10px] font-medium text-red-400 hover:bg-red-900/30"
            >
              No
            </button>
          </div>
        )}
      </div>
    </Panel>
  )
}

function borderColor(mode: VoiceMode, error: string | null): string {
  if (error) return '#ef4444'
  switch (mode) {
    case 'listening': return '#3b82f6'
    case 'processing': return '#a855f7'
    case 'confirming': return '#f59e0b'
    case 'dictating': return '#10b981'
    case 'dictationStream': return '#10b981'
    default: return '#27272a'
  }
}

function statusIcon(mode: VoiceMode, error: string | null) {
  if (error) {
    return (
      <svg className="h-3.5 w-3.5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    )
  }

  switch (mode) {
    case 'listening':
      return (
        <div className="relative flex h-3.5 w-3.5 items-center justify-center">
          <div className="absolute h-3.5 w-3.5 animate-ping rounded-full bg-blue-500 opacity-30" />
          <div className="h-2 w-2 rounded-full bg-blue-500" />
        </div>
      )
    case 'processing':
      return (
        <svg className="h-3.5 w-3.5 animate-spin text-purple-400" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      )
    case 'confirming':
      return (
        <svg className="h-3.5 w-3.5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
        </svg>
      )
    case 'dictating':
    case 'dictationStream':
      return (
        <div className="h-2 w-2 rounded-full bg-emerald-500" />
      )
    default:
      // idle with transcript = success
      return (
        <svg className="h-3.5 w-3.5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
        </svg>
      )
  }
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function statusText(mode: VoiceMode, transcript: string | null, error: string | null, secondsLeft?: number | null): string {
  if (error) return error
  switch (mode) {
    case 'listening': {
      const timer = secondsLeft != null ? ` (${formatTime(secondsLeft)})` : ''
      return `Listening...${timer}`
    }
    case 'processing': return 'Transcribing...'
    case 'confirming': return transcript ?? 'Confirm action?'
    case 'dictating': return 'Dictating...'
    case 'dictationStream': return 'Dictation stream'
    default: return transcript ?? ''
  }
}
