import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'

export interface PersistedBrowser {
  sessionId: string
  label: string
  url: string
  position: { x: number; y: number }
  width: number
  height: number
  workspaceId: string
  linkedTerminalId?: string
  initialPreset?: { name: string; width: number; height: number; mobile: boolean; dpr: number }
  createdAt: number
}

interface BrowserStoreData {
  version: 1
  browsers: PersistedBrowser[]
}

const DEFAULT_DATA: BrowserStoreData = {
  version: 1,
  browsers: []
}

function getStorePath(): string {
  const dir = join(app.getPath('userData'), 'agentcanvas')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'browsers.json')
}

export function loadBrowsers(): BrowserStoreData {
  const filePath = getStorePath()
  try {
    const raw = readFileSync(filePath, 'utf-8')
    return JSON.parse(raw) as BrowserStoreData
  } catch {
    return DEFAULT_DATA
  }
}

export function saveBrowsers(data: BrowserStoreData): void {
  const filePath = getStorePath()
  writeFileSync(filePath, JSON.stringify(data, null, 2))
}
