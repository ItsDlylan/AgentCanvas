import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'

export interface PersistedTerminal {
  sessionId: string
  label: string
  cwd: string
  position: { x: number; y: number }
  width: number
  height: number
  workspaceId: string
  metadata: Record<string, unknown>
  createdAt: number
  scrollback?: string
  command?: string
}

interface TerminalStoreData {
  version: 1
  terminals: PersistedTerminal[]
}

const DEFAULT_DATA: TerminalStoreData = {
  version: 1,
  terminals: []
}

function getStorePath(): string {
  const dir = join(app.getPath('userData'), 'agentcanvas')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'terminals.json')
}

export function loadTerminals(): TerminalStoreData {
  const filePath = getStorePath()
  try {
    const raw = readFileSync(filePath, 'utf-8')
    return JSON.parse(raw) as TerminalStoreData
  } catch {
    return DEFAULT_DATA
  }
}

export function saveTerminals(data: TerminalStoreData): void {
  const filePath = getStorePath()
  writeFileSync(filePath, JSON.stringify(data, null, 2))
}
