import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import type { PomodoroData } from '../renderer/types/pomodoro'
import { DEFAULT_POMODORO_DATA } from '../renderer/types/pomodoro'

function getStorePath(): string {
  const dir = join(app.getPath('userData'), 'agentcanvas')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'pomodoro.json')
}

export function loadPomodoro(): PomodoroData {
  const filePath = getStorePath()
  try {
    const raw = readFileSync(filePath, 'utf-8')
    const data = JSON.parse(raw) as Partial<PomodoroData>
    return { ...DEFAULT_POMODORO_DATA, ...data }
  } catch {
    writeFileSync(filePath, JSON.stringify(DEFAULT_POMODORO_DATA, null, 2))
    return DEFAULT_POMODORO_DATA
  }
}

export function savePomodoro(data: PomodoroData): void {
  const filePath = getStorePath()
  writeFileSync(filePath, JSON.stringify(data, null, 2))
}
