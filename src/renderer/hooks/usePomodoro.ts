import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import type { PomodoroData, PomodoroTask, PomodoroPhase, TimerState } from '@/types/pomodoro'
import { DEFAULT_POMODORO_DATA } from '@/types/pomodoro'
import { v4 as uuid } from 'uuid'

function getPhaseDurationMs(data: PomodoroData): number {
  switch (data.currentPhase) {
    case 'focus': return data.focusDurationMin * 60 * 1000
    case 'shortBreak': return data.shortBreakMin * 60 * 1000
    case 'longBreak': return data.longBreakMin * 60 * 1000
  }
}

function getNextPhase(data: PomodoroData): { phase: PomodoroPhase; completedSessions: number } {
  if (data.currentPhase === 'focus') {
    const next = data.completedSessions + 1
    if (next >= data.sessionsBeforeLongBreak) {
      return { phase: 'longBreak', completedSessions: next }
    }
    return { phase: 'shortBreak', completedSessions: next }
  }
  // After any break, go back to focus
  const sessions = data.currentPhase === 'longBreak' ? 0 : data.completedSessions
  return { phase: 'focus', completedSessions: sessions }
}

// Simple chime using Web Audio API
function playChime(): void {
  try {
    const ctx = new AudioContext()
    const now = ctx.currentTime

    // Two-tone chime
    const frequencies = [880, 1108.73] // A5, C#6
    for (let i = 0; i < frequencies.length; i++) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = frequencies[i]
      gain.gain.setValueAtTime(0.3, now + i * 0.15)
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.15 + 0.5)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(now + i * 0.15)
      osc.stop(now + i * 0.15 + 0.5)
    }

    // Clean up context after sounds finish
    setTimeout(() => ctx.close(), 1500)
  } catch {
    // Audio not available
  }
}

// Sync a task's checked state back to its source note
async function syncTaskToNote(noteId: string, taskText: string, checked: boolean): Promise<void> {
  try {
    const noteFile = await window.note.load(noteId)
    if (!noteFile?.content) return

    const content = noteFile.content as { type?: string; content?: Array<Record<string, unknown>> }
    if (!content.content) return

    let modified = false
    for (const node of content.content) {
      if ((node as { type?: string }).type !== 'taskList') continue
      const items = (node as { content?: Array<Record<string, unknown>> }).content
      if (!items) continue
      for (const item of items) {
        if ((item as { type?: string }).type !== 'taskItem') continue
        // Extract text from taskItem → paragraph → text nodes
        const itemContent = (item as { content?: Array<Record<string, unknown>> }).content
        const text = (itemContent ?? [])
          .flatMap((p) => ((p as { content?: Array<Record<string, unknown>> }).content ?? []))
          .filter((n) => (n as { type?: string }).type === 'text')
          .map((n) => (n as { text?: string }).text ?? '')
          .join('')
        if (text.trim() === taskText) {
          const attrs = (item as { attrs?: Record<string, unknown> }).attrs
          if (attrs) {
            attrs.checked = checked
            modified = true
          }
          break
        }
      }
      if (modified) break
    }

    if (modified) {
      await window.note.save(noteId, {}, content as Record<string, unknown>)
      // Notify mounted editors to refresh
      window.dispatchEvent(new CustomEvent('pomodoro:note-updated', { detail: { noteId } }))
    }
  } catch {
    // Note may have been deleted
  }
}

export interface UsePomodoroReturn {
  timerState: TimerState
  currentPhase: PomodoroPhase
  remainingMs: number
  completedSessions: number
  totalCompletedSessions: number
  tasks: PomodoroTask[]
  focusDurationMin: number
  shortBreakMin: number
  longBreakMin: number
  sessionsBeforeLongBreak: number
  totalMs: number
  progressPercent: number
  isComplete: boolean
  soundEnabled: boolean
  start: () => void
  pause: () => void
  reset: () => void
  resetAll: () => void
  skip: () => void
  toggleSound: () => void
  addTask: (text: string, source?: { noteId: string; noteLabel: string }) => void
  toggleTask: (taskId: string) => void
  removeTask: (taskId: string) => void
  editTask: (taskId: string, text: string) => void
  clearCompleted: () => void
  setDuration: (phase: PomodoroPhase, minutes: number) => void
}

export function usePomodoro(): UsePomodoroReturn {
  const [data, setData] = useState<PomodoroData>(DEFAULT_POMODORO_DATA)
  const [isComplete, setIsComplete] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const dataRef = useRef(data)
  dataRef.current = data
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Persist with debounce
  const persist = useCallback((d: PomodoroData) => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    saveTimeoutRef.current = setTimeout(() => {
      window.pomodoro.save(d)
    }, 500)
  }, [])

  // Immediate persist (for state transitions)
  const persistNow = useCallback((d: PomodoroData) => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    window.pomodoro.save(d)
  }, [])

  // Load on mount
  useEffect(() => {
    window.pomodoro.load().then((saved) => {
      // If timer was running, compute elapsed time since last tick
      if (saved.timerState === 'running' && saved.lastTickAt) {
        const elapsed = Date.now() - saved.lastTickAt
        const remaining = Math.max(0, saved.remainingMs - elapsed)
        saved = { ...saved, remainingMs: remaining, lastTickAt: Date.now() }
      }
      setData(saved)
      setLoaded(true)
    })
  }, [])

  // Timer tick
  useEffect(() => {
    if (!loaded || data.timerState !== 'running') return

    const interval = setInterval(() => {
      setData((prev) => {
        const now = Date.now()
        const elapsed = prev.lastTickAt ? now - prev.lastTickAt : 1000
        const remaining = Math.max(0, prev.remainingMs - elapsed)

        if (remaining <= 0) {
          // Phase complete
          if (prev.soundEnabled) playChime()
          setIsComplete(true)
          setTimeout(() => setIsComplete(false), 3000)

          const { phase: nextPhase, completedSessions } = getNextPhase(prev)
          const totalCompleted = prev.currentPhase === 'focus'
            ? prev.totalCompletedSessions + 1
            : prev.totalCompletedSessions

          const next: PomodoroData = {
            ...prev,
            timerState: 'idle',
            currentPhase: nextPhase,
            remainingMs: nextPhase === 'focus'
              ? prev.focusDurationMin * 60 * 1000
              : nextPhase === 'shortBreak'
                ? prev.shortBreakMin * 60 * 1000
                : prev.longBreakMin * 60 * 1000,
            lastTickAt: null,
            completedSessions,
            totalCompletedSessions: totalCompleted
          }
          persistNow(next)
          return next
        }

        const next = { ...prev, remainingMs: remaining, lastTickAt: now }
        return next
      })
    }, 1000)

    return () => clearInterval(interval)
  }, [loaded, data.timerState, persistNow])

  // Periodic save while running (every 30s)
  useEffect(() => {
    if (!loaded || data.timerState !== 'running') return
    const interval = setInterval(() => {
      persist(dataRef.current)
    }, 30000)
    return () => clearInterval(interval)
  }, [loaded, data.timerState, persist])

  const totalMs = getPhaseDurationMs(data)
  const progressPercent = totalMs > 0 ? ((totalMs - data.remainingMs) / totalMs) * 100 : 0

  const start = useCallback(() => {
    setData((prev) => {
      const next = { ...prev, timerState: 'running' as TimerState, lastTickAt: Date.now() }
      persistNow(next)
      return next
    })
  }, [persistNow])

  const pause = useCallback(() => {
    setData((prev) => {
      const next = { ...prev, timerState: 'paused' as TimerState, lastTickAt: null }
      persistNow(next)
      return next
    })
  }, [persistNow])

  const reset = useCallback(() => {
    setData((prev) => {
      const next: PomodoroData = {
        ...prev,
        timerState: 'idle',
        remainingMs: getPhaseDurationMs(prev),
        lastTickAt: null
      }
      persistNow(next)
      return next
    })
  }, [persistNow])

  const resetAll = useCallback(() => {
    setData((prev) => {
      const next: PomodoroData = {
        ...prev,
        timerState: 'idle',
        currentPhase: 'focus',
        remainingMs: prev.focusDurationMin * 60 * 1000,
        lastTickAt: null,
        completedSessions: 0,
        tasks: prev.tasks.map((t) => ({ ...t, completed: false }))
      }
      persistNow(next)
      return next
    })
  }, [persistNow])

  const skip = useCallback(() => {
    setData((prev) => {
      const { phase: nextPhase, completedSessions } = getNextPhase(prev)
      const totalCompleted = prev.currentPhase === 'focus'
        ? prev.totalCompletedSessions + 1
        : prev.totalCompletedSessions
      const next: PomodoroData = {
        ...prev,
        timerState: 'idle',
        currentPhase: nextPhase,
        remainingMs: nextPhase === 'focus'
          ? prev.focusDurationMin * 60 * 1000
          : nextPhase === 'shortBreak'
            ? prev.shortBreakMin * 60 * 1000
            : prev.longBreakMin * 60 * 1000,
        lastTickAt: null,
        completedSessions,
        totalCompletedSessions: totalCompleted
      }
      persistNow(next)
      return next
    })
  }, [persistNow])

  const toggleSound = useCallback(() => {
    setData((prev) => {
      const next = { ...prev, soundEnabled: !prev.soundEnabled }
      persistNow(next)
      return next
    })
  }, [persistNow])

  const addTask = useCallback((text: string, source?: { noteId: string; noteLabel: string }) => {
    if (!text.trim()) return
    setData((prev) => {
      const task: PomodoroTask = {
        id: uuid(),
        text: text.trim(),
        completed: false,
        createdAt: Date.now(),
        ...(source && { sourceNoteId: source.noteId, sourceNoteLabel: source.noteLabel })
      }
      const next = { ...prev, tasks: [...prev.tasks, task] }
      persist(next)
      return next
    })
  }, [persist])

  const toggleTask = useCallback((taskId: string) => {
    setData((prev) => {
      const task = prev.tasks.find((t) => t.id === taskId)
      if (!task) return prev
      const newCompleted = !task.completed
      const next = {
        ...prev,
        tasks: prev.tasks.map((t) => t.id === taskId ? { ...t, completed: newCompleted } : t)
      }
      persist(next)

      // Sync check state back to the source note
      if (task.sourceNoteId) {
        syncTaskToNote(task.sourceNoteId, task.text, newCompleted)
      }

      return next
    })
  }, [persist])

  const removeTask = useCallback((taskId: string) => {
    setData((prev) => {
      const next = { ...prev, tasks: prev.tasks.filter((t) => t.id !== taskId) }
      persist(next)
      return next
    })
  }, [persist])

  const editTask = useCallback((taskId: string, text: string) => {
    setData((prev) => {
      const next = {
        ...prev,
        tasks: prev.tasks.map((t) => t.id === taskId ? { ...t, text } : t)
      }
      persist(next)
      return next
    })
  }, [persist])

  const clearCompleted = useCallback(() => {
    setData((prev) => {
      const next = { ...prev, tasks: prev.tasks.filter((t) => !t.completed) }
      persist(next)
      return next
    })
  }, [persist])

  const setDuration = useCallback((phase: PomodoroPhase, minutes: number) => {
    const clamped = Math.max(1, Math.min(120, minutes))
    setData((prev) => {
      const key = phase === 'focus' ? 'focusDurationMin'
        : phase === 'shortBreak' ? 'shortBreakMin' : 'longBreakMin'
      const next = { ...prev, [key]: clamped }
      // If currently idle on this phase, update remaining time too
      if (prev.timerState === 'idle' && prev.currentPhase === phase) {
        next.remainingMs = clamped * 60 * 1000
      }
      persistNow(next)
      return next
    })
  }, [persistNow])

  return {
    timerState: data.timerState,
    currentPhase: data.currentPhase,
    remainingMs: data.remainingMs,
    completedSessions: data.completedSessions,
    totalCompletedSessions: data.totalCompletedSessions,
    tasks: data.tasks,
    focusDurationMin: data.focusDurationMin,
    shortBreakMin: data.shortBreakMin,
    longBreakMin: data.longBreakMin,
    sessionsBeforeLongBreak: data.sessionsBeforeLongBreak,
    totalMs,
    progressPercent,
    isComplete,
    soundEnabled: data.soundEnabled,
    start,
    pause,
    reset,
    resetAll,
    skip,
    toggleSound,
    addTask,
    toggleTask,
    removeTask,
    editTask,
    clearCompleted,
    setDuration
  }
}

// ── Context ─────────────────────────────────────────────
// Allows NotesTile (and other components) to add tasks to the Pomodoro.

interface PomodoroContextValue {
  addTask: (text: string, source?: { noteId: string; noteLabel: string }) => void
  tasks: PomodoroTask[]
  navigateToNote: (noteId: string) => void
}

export const PomodoroContext = createContext<PomodoroContextValue>({
  addTask: () => {},
  tasks: [],
  navigateToNote: () => {}
})

export function usePomodoroContext(): PomodoroContextValue {
  return useContext(PomodoroContext)
}
