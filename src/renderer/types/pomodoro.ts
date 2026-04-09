// ── Pomodoro Types ──────────────────────────────────────
// Shared between renderer and main process.

export type PomodoroPhase = 'focus' | 'shortBreak' | 'longBreak'
export type TimerState = 'idle' | 'running' | 'paused'

export interface PomodoroTask {
  id: string
  text: string
  completed: boolean
  createdAt: number
  sourceNoteId?: string
  sourceNoteLabel?: string
}

export interface PomodoroData {
  timerState: TimerState
  currentPhase: PomodoroPhase
  remainingMs: number
  lastTickAt: number | null
  completedSessions: number
  totalCompletedSessions: number
  focusDurationMin: number
  shortBreakMin: number
  longBreakMin: number
  sessionsBeforeLongBreak: number
  soundEnabled: boolean
  tasks: PomodoroTask[]
}

export const DEFAULT_POMODORO_DATA: PomodoroData = {
  timerState: 'idle',
  currentPhase: 'focus',
  remainingMs: 25 * 60 * 1000,
  lastTickAt: null,
  completedSessions: 0,
  totalCompletedSessions: 0,
  focusDurationMin: 25,
  shortBreakMin: 5,
  longBreakMin: 15,
  sessionsBeforeLongBreak: 4,
  soundEnabled: true,
  tasks: []
}
