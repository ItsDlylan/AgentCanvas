import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'

interface Workspace {
  id: string
  name: string
  path: string | null
  defaultUrl: string | null
  isDefault: boolean
  createdAt: number
}

interface WorkspaceData {
  workspaces: Workspace[]
  activeWorkspaceId: string
}

const DEFAULT_DATA: WorkspaceData = {
  workspaces: [
    { id: 'default', name: 'AgentCanvas', path: null, defaultUrl: null, isDefault: true, createdAt: 0 }
  ],
  activeWorkspaceId: 'default'
}

function getStorePath(): string {
  const dir = join(app.getPath('userData'), 'agentcanvas')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'workspaces.json')
}

export function loadWorkspaces(): WorkspaceData {
  const filePath = getStorePath()
  try {
    const raw = readFileSync(filePath, 'utf-8')
    const data = JSON.parse(raw) as WorkspaceData
    // Ensure default workspace always exists
    if (!data.workspaces.some((w) => w.isDefault)) {
      data.workspaces.unshift(DEFAULT_DATA.workspaces[0])
    }
    return data
  } catch {
    // File doesn't exist or is corrupted — return defaults
    writeFileSync(filePath, JSON.stringify(DEFAULT_DATA, null, 2))
    return DEFAULT_DATA
  }
}

export function saveWorkspaces(data: WorkspaceData): void {
  const filePath = getStorePath()
  writeFileSync(filePath, JSON.stringify(data, null, 2))
}
