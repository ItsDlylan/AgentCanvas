// ── Dictation Stream Panel ───────────────────────────────
// Floating composer at bottom-center of canvas.
// Streams transcribed words during dictation, then switches
// to an editable textarea for corrections before sending.
// After send, shows what the LLM heard + its plan for confirmation.

import { useState, useEffect, useRef, useCallback } from 'react'
import { Panel } from '@xyflow/react'

interface DictationPanelProps {
  active: boolean
  streamingText: string
  isSpeaking: boolean
  isComplete: boolean
  // Confirmation state — set after LLM processes the text
  isConfirming: boolean
  confirmationMessage: string | null
  heardText: string | null
  onSend: (text: string) => void
  onCancel: () => void
  onStopDictation: () => void
  onConfirm: () => void
  onReject: () => void
}

export function DictationPanel({
  active,
  streamingText,
  isSpeaking,
  isComplete,
  isConfirming,
  confirmationMessage,
  heardText,
  onSend,
  onCancel,
  onStopDictation,
  onConfirm,
  onReject
}: DictationPanelProps) {
  const [editText, setEditText] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Sync streaming text into edit text when dictation completes
  useEffect(() => {
    if (isComplete && !isConfirming) {
      setEditText(streamingText)
    }
  }, [isComplete, isConfirming, streamingText])

  // Auto-focus textarea when entering edit mode
  useEffect(() => {
    if (isComplete && !isConfirming && textareaRef.current) {
      textareaRef.current.focus()
      const len = textareaRef.current.value.length
      textareaRef.current.setSelectionRange(len, len)
    }
  }, [isComplete, isConfirming])

  // Auto-scroll streaming text
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [streamingText])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      if (editText.trim()) {
        onSend(editText.trim())
      }
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    }
  }, [editText, onSend, onCancel])

  // Handle Y/N keyboard shortcuts in confirming mode
  const handleConfirmKeyDown = useCallback((e: KeyboardEvent) => {
    if (!isConfirming) return
    if (e.key === 'y' || e.key === 'Y' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
      e.preventDefault()
      onConfirm()
    }
    if (e.key === 'n' || e.key === 'N' || e.key === 'Escape') {
      e.preventDefault()
      onReject()
    }
  }, [isConfirming, onConfirm, onReject])

  useEffect(() => {
    if (isConfirming) {
      window.addEventListener('keydown', handleConfirmKeyDown)
      return () => window.removeEventListener('keydown', handleConfirmKeyDown)
    }
  }, [isConfirming, handleConfirmKeyDown])

  if (!active) return null

  // Determine border color based on state
  const borderColor = isConfirming ? '#f59e0b' : isComplete ? '#3b82f6' : '#10b981'

  return (
    <Panel position="bottom-center">
      <div
        style={{
          marginBottom: 16,
          maxWidth: 640,
          width: '80vw',
          background: 'rgba(24, 24, 27, 0.95)',
          borderRadius: 12,
          border: '1px solid rgba(39, 39, 42, 0.8)',
          borderLeft: `3px solid ${borderColor}`,
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
          backdropFilter: 'blur(12px)',
          overflow: 'hidden',
          transition: 'border-color 0.2s'
        }}
      >
        {isConfirming ? (
          // ── Confirming state ──
          <>
            <div className="px-3 py-2" style={{ borderBottom: '1px solid rgba(39, 39, 42, 0.5)' }}>
              <span className="text-xs text-amber-400">Confirm action</span>
            </div>

            {/* What the AI heard */}
            {heardText && (
              <div className="px-3 pt-2">
                <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">You said</div>
                <div
                  className="mt-1 text-sm text-zinc-400"
                  style={{ lineHeight: 1.5, maxHeight: 80, overflowY: 'auto' }}
                >
                  {heardText}
                </div>
              </div>
            )}

            {/* What the LLM plans to do */}
            {confirmationMessage && (
              <div className="px-3 pt-2">
                <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">Plan</div>
                <div
                  className="mt-1 text-sm text-zinc-200"
                  style={{ lineHeight: 1.5, maxHeight: 120, overflowY: 'auto' }}
                >
                  {confirmationMessage}
                </div>
              </div>
            )}

            {/* Yes / No */}
            <div
              className="flex items-center justify-end gap-2 px-3 py-2"
              style={{ borderTop: '1px solid rgba(39, 39, 42, 0.5)', marginTop: 8 }}
            >
              <button
                onClick={onReject}
                className="rounded px-3 py-1 text-xs text-zinc-400 transition-colors hover:bg-zinc-700/50 hover:text-zinc-200"
              >
                No
                <kbd className="ml-1 rounded bg-zinc-700/50 px-1 py-0.5 text-[10px] text-zinc-500">N</kbd>
              </button>
              <button
                onClick={onConfirm}
                className="flex items-center gap-1 rounded px-3 py-1 text-xs font-medium text-emerald-400 transition-colors hover:bg-emerald-900/30"
              >
                Yes
                <kbd className="rounded bg-zinc-700/50 px-1 py-0.5 text-[10px] text-zinc-500">Y</kbd>
              </button>
            </div>
          </>
        ) : (
          // ── Streaming / Editing states ──
          <>
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: '1px solid rgba(39, 39, 42, 0.5)' }}>
              <div className="flex items-center gap-2">
                {!isComplete ? (
                  <>
                    <div
                      className="h-2 w-2 rounded-full"
                      style={{
                        backgroundColor: isSpeaking ? '#10b981' : '#52525b',
                        animation: isSpeaking ? 'pulse 1.5s ease-in-out infinite' : 'none',
                        boxShadow: isSpeaking ? '0 0 6px #10b98180' : 'none',
                        transition: 'background-color 0.2s, box-shadow 0.2s'
                      }}
                    />
                    <span className="text-xs text-zinc-400">Dictating...</span>
                  </>
                ) : (
                  <span className="text-xs text-zinc-400">Edit &amp; send</span>
                )}
              </div>

              {!isComplete ? (
                <button
                  onClick={onStopDictation}
                  className="rounded px-2 py-0.5 text-xs text-zinc-400 transition-colors hover:bg-zinc-700/50 hover:text-zinc-200"
                >
                  Stop
                </button>
              ) : null}
            </div>

            {/* Content */}
            {!isComplete ? (
              // Streaming mode — read-only text display
              <div
                ref={scrollRef}
                className="px-3 py-2 text-sm text-zinc-200"
                style={{
                  maxHeight: 192,
                  minHeight: 48,
                  overflowY: 'auto',
                  lineHeight: 1.6,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word'
                }}
              >
                {streamingText || (
                  <span className="italic text-zinc-500">Speak now...</span>
                )}
              </div>
            ) : (
              // Editing mode — editable textarea + action buttons
              <>
                <textarea
                  ref={textareaRef}
                  value={editText}
                  onChange={e => setEditText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="w-full resize-none bg-transparent px-3 py-2 text-sm text-zinc-200 outline-none placeholder:text-zinc-500"
                  style={{
                    maxHeight: 192,
                    minHeight: 80,
                    lineHeight: 1.6
                  }}
                  rows={4}
                  placeholder="Nothing transcribed. Type your command..."
                />
                <div
                  className="flex items-center justify-end gap-2 px-3 py-2"
                  style={{ borderTop: '1px solid rgba(39, 39, 42, 0.5)' }}
                >
                  <button
                    onClick={onCancel}
                    className="rounded px-3 py-1 text-xs text-zinc-400 transition-colors hover:bg-zinc-700/50 hover:text-zinc-200"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => editText.trim() && onSend(editText.trim())}
                    disabled={!editText.trim()}
                    className="flex items-center gap-1.5 rounded px-3 py-1 text-xs font-medium text-emerald-400 transition-colors hover:bg-emerald-900/30 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Send
                    <kbd className="rounded bg-zinc-700/50 px-1 py-0.5 text-[10px] text-zinc-500">
                      {navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}↵
                    </kbd>
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </Panel>
  )
}
