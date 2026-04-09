import React, { memo, useEffect, useRef, useState, useCallback } from 'react'
import type { UsePomodoroReturn } from '@/hooks/usePomodoro'
import { usePomodoroContext } from '@/hooks/usePomodoro'
import type { PomodoroPhase } from '@/types/pomodoro'

interface PomodoroWidgetProps {
  pomodoro: UsePomodoroReturn
  expanded: boolean
  onToggle: () => void
}

const PHASE_COLORS: Record<PomodoroPhase, string> = {
  focus: '#3b82f6',       // blue-500
  shortBreak: '#22c55e',  // green-500
  longBreak: '#f59e0b'    // amber-500
}

const PHASE_LABELS: Record<PomodoroPhase, string> = {
  focus: 'Focus',
  shortBreak: 'Short Break',
  longBreak: 'Long Break'
}

function formatTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

// ── Circular Progress Ring ──────────────────────────────

function ProgressRing({ percent, color, size, strokeWidth }: {
  percent: number; color: string; size: number; strokeWidth: number
}) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (percent / 100) * circumference
  return (
    <svg width={size} height={size} className="-rotate-90">
      <circle
        cx={size / 2} cy={size / 2} r={radius}
        fill="none" stroke="#27272a" strokeWidth={strokeWidth}
      />
      <circle
        cx={size / 2} cy={size / 2} r={radius}
        fill="none" stroke={color} strokeWidth={strokeWidth}
        strokeDasharray={circumference} strokeDashoffset={offset}
        strokeLinecap="round"
        className="transition-all duration-1000"
      />
    </svg>
  )
}

// ── Compact Badge (titlebar) ────────────────────────────

function CompactBadge({ pomodoro, isComplete, onClick }: {
  pomodoro: UsePomodoroReturn; isComplete: boolean; onClick: () => void
}) {
  const color = PHASE_COLORS[pomodoro.currentPhase]
  const isRunning = pomodoro.timerState === 'running'
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-all
        hover:bg-zinc-800 ${isComplete ? 'animate-pulse' : ''}`}
      style={isComplete ? { boxShadow: `0 0 12px ${color}40` } : undefined}
      title="Pomodoro Timer"
    >
      {/* Tiny progress ring */}
      <div className="relative flex items-center justify-center">
        <ProgressRing percent={pomodoro.progressPercent} color={color} size={16} strokeWidth={2} />
        <div
          className="absolute h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: isRunning ? color : '#71717a' }}
        />
      </div>
      <span className="tabular-nums text-zinc-300">{formatTime(pomodoro.remainingMs)}</span>
    </button>
  )
}

// ── Expanded Popover ────────────────────────────────────

function ExpandedPopover({ pomodoro, onClose }: { pomodoro: UsePomodoroReturn; onClose: () => void }) {
  const { navigateToNote } = usePomodoroContext()
  const [newTask, setNewTask] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const color = PHASE_COLORS[pomodoro.currentPhase]

  const handleAddTask = useCallback(() => {
    if (newTask.trim()) {
      pomodoro.addTask(newTask)
      setNewTask('')
      inputRef.current?.focus()
    }
  }, [newTask, pomodoro])

  const hasCompleted = pomodoro.tasks.some((t) => t.completed)

  return (
    <div
      className="absolute right-0 top-full z-50 mt-2 w-80 rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Timer display */}
      <div className="flex flex-col items-center gap-3 px-6 pt-5 pb-4">
        <div className="relative flex items-center justify-center">
          <ProgressRing percent={pomodoro.progressPercent} color={color} size={120} strokeWidth={4} />
          <div className="absolute flex flex-col items-center">
            <span className="text-3xl font-semibold tabular-nums text-zinc-100">
              {formatTime(pomodoro.remainingMs)}
            </span>
            <span className="text-xs text-zinc-500">{PHASE_LABELS[pomodoro.currentPhase]}</span>
          </div>
        </div>

        {/* Session dots */}
        <div className="flex items-center gap-1.5">
          {Array.from({ length: pomodoro.sessionsBeforeLongBreak }).map((_, i) => (
            <div
              key={i}
              className="h-2 w-2 rounded-full"
              style={{
                backgroundColor: i < pomodoro.completedSessions ? color : '#3f3f46'
              }}
            />
          ))}
          <span className="ml-1.5 text-[10px] text-zinc-600">
            {pomodoro.totalCompletedSessions} total
          </span>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2">
          {/* Play / Pause */}
          <button
            onClick={pomodoro.timerState === 'running' ? pomodoro.pause : pomodoro.start}
            className="rounded-lg p-2 text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
            title={pomodoro.timerState === 'running' ? 'Pause' : 'Start'}
          >
            {pomodoro.timerState === 'running' ? (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 9v6m4-6v6" />
              </svg>
            ) : (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 010 1.972l-11.54 6.347c-.75.412-1.667-.13-1.667-.986V5.653z" />
              </svg>
            )}
          </button>

          {/* Reset */}
          <button
            onClick={pomodoro.reset}
            className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            title="Reset"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.992 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
            </svg>
          </button>

          {/* Skip */}
          <button
            onClick={pomodoro.skip}
            className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            title="Skip to next phase"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 8.689c0-.864.933-1.406 1.683-.977l7.108 4.061a1.125 1.125 0 010 1.954l-7.108 4.061A1.125 1.125 0 013 16.811V8.689zM12.75 8.689c0-.864.933-1.406 1.683-.977l7.108 4.061a1.125 1.125 0 010 1.954l-7.108 4.061a1.125 1.125 0 01-1.683-.977V8.689z" />
            </svg>
          </button>

          <div className="mx-1 h-4 w-px bg-zinc-700" />

          {/* Sound toggle */}
          <button
            onClick={pomodoro.toggleSound}
            className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            title={pomodoro.soundEnabled ? 'Mute' : 'Unmute'}
          >
            {pomodoro.soundEnabled ? (
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
              </svg>
            ) : (
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 9.75L19.5 12m0 0l2.25 2.25M19.5 12l2.25-2.25M19.5 12l-2.25 2.25m-10.5-6l4.72-4.72a.75.75 0 011.28.531v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
              </svg>
            )}
          </button>

          {/* Settings toggle */}
          <button
            onClick={() => setShowSettings((s) => !s)}
            className={`rounded-lg p-2 transition-colors hover:bg-zinc-800 ${showSettings ? 'text-zinc-200' : 'text-zinc-400 hover:text-zinc-200'}`}
            title="Duration settings"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
            </svg>
          </button>
        </div>

        {/* Duration settings (collapsible) */}
        {showSettings && (
          <div className="flex w-full flex-col gap-2 rounded-md border border-zinc-800 bg-zinc-950 p-3">
            <DurationSetting label="Focus" value={pomodoro.focusDurationMin} onChange={(v) => pomodoro.setDuration('focus', v)} />
            <DurationSetting label="Short break" value={pomodoro.shortBreakMin} onChange={(v) => pomodoro.setDuration('shortBreak', v)} />
            <DurationSetting label="Long break" value={pomodoro.longBreakMin} onChange={(v) => pomodoro.setDuration('longBreak', v)} />
            <div className="mt-1 border-t border-zinc-800 pt-2">
              <button
                onClick={pomodoro.resetAll}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-[11px] text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
                </svg>
                Start fresh day
              </button>
              <p className="mt-1 px-2 text-[10px] text-zinc-600">Resets timer, phase, sessions, and unchecks all tasks</p>
            </div>
          </div>
        )}
      </div>

      {/* Divider */}
      <div className="h-px bg-zinc-800" />

      {/* Task list */}
      <div className="flex flex-col px-3 py-3">
        {/* Add task input */}
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={newTask}
            onChange={(e) => setNewTask(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAddTask() }}
            placeholder="Add a task..."
            className="flex-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-zinc-600"
          />
          <button
            onClick={handleAddTask}
            className="rounded px-2 py-1.5 text-xs text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
          </button>
        </div>

        {/* Tasks */}
        {pomodoro.tasks.length > 0 && (
          <div className="mt-2 flex max-h-48 flex-col gap-0.5 overflow-y-auto">
            {pomodoro.tasks.map((task) => (
              <div
                key={task.id}
                className="group flex items-center gap-2 rounded px-1 py-1 hover:bg-zinc-800/50"
              >
                <button
                  onClick={() => pomodoro.toggleTask(task.id)}
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                    task.completed
                      ? 'border-blue-500 bg-blue-500'
                      : 'border-zinc-600 hover:border-zinc-400'
                  }`}
                >
                  {task.completed && (
                    <svg className="h-2.5 w-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  )}
                </button>
                <div className="flex flex-1 flex-col min-w-0">
                  <span className={`text-xs ${task.completed ? 'text-zinc-600 line-through' : 'text-zinc-300'}`}>
                    {task.text}
                  </span>
                  {task.sourceNoteLabel && task.sourceNoteId && (
                    <button
                      className="text-left text-[10px] text-amber-500/60 truncate hover:text-amber-400 transition-colors"
                      onClick={() => {
                        navigateToNote(task.sourceNoteId!)
                        onClose()
                      }}
                      title={`Go to ${task.sourceNoteLabel}`}
                    >
                      {task.sourceNoteLabel}
                    </button>
                  )}
                </div>
                <button
                  onClick={() => pomodoro.removeTask(task.id)}
                  className="shrink-0 text-zinc-600 opacity-0 transition-opacity hover:text-zinc-400 group-hover:opacity-100"
                >
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Clear completed */}
        {hasCompleted && (
          <button
            onClick={pomodoro.clearCompleted}
            className="mt-2 self-start text-[10px] text-zinc-600 transition-colors hover:text-zinc-400"
          >
            Clear completed
          </button>
        )}
      </div>
    </div>
  )
}

// ── Duration Setting Row ────────────────────────────────

function DurationSetting({ label, value, onChange }: {
  label: string; value: number; onChange: (v: number) => void
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px] text-zinc-400">{label}</span>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onChange(value - 5)}
          className="rounded px-1 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
        >-</button>
        <span className="w-8 text-center text-[11px] tabular-nums text-zinc-300">{value}m</span>
        <button
          onClick={() => onChange(value + 5)}
          className="rounded px-1 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
        >+</button>
      </div>
    </div>
  )
}

// ── Main Component ──────────────────────────────────────

export const PomodoroWidget = memo(function PomodoroWidget({
  pomodoro, expanded, onToggle
}: PomodoroWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  // Click outside to close
  useEffect(() => {
    if (!expanded) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as HTMLElement)) {
        onToggle()
      }
    }
    // Delay to avoid the triggering click
    const timer = setTimeout(() => document.addEventListener('mousedown', handler), 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handler)
    }
  }, [expanded, onToggle])

  // Escape to close
  useEffect(() => {
    if (!expanded) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onToggle()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [expanded, onToggle])

  return (
    <div ref={containerRef} className="relative">
      <CompactBadge pomodoro={pomodoro} isComplete={pomodoro.isComplete} onClick={onToggle} />
      {expanded && <ExpandedPopover pomodoro={pomodoro} onClose={onToggle} />}
    </div>
  )
})
