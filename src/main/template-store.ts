import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'fs'
import type { WorkspaceTemplate } from './settings-store'

function getTemplateDir(): string {
  const dir = join(app.getPath('userData'), 'agentcanvas', 'templates')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function getTemplatePath(workspaceId: string): string {
  return join(getTemplateDir(), workspaceId + '.json')
}

export function loadProjectTemplates(workspaceId: string): WorkspaceTemplate[] {
  const filePath = getTemplatePath(workspaceId)
  try {
    const raw = readFileSync(filePath, 'utf-8')
    return JSON.parse(raw) as WorkspaceTemplate[]
  } catch {
    return []
  }
}

export function saveProjectTemplates(workspaceId: string, templates: WorkspaceTemplate[]): void {
  const filePath = getTemplatePath(workspaceId)
  writeFileSync(filePath, JSON.stringify(templates, null, 2))
}

export function deleteProjectTemplates(workspaceId: string): void {
  const filePath = getTemplatePath(workspaceId)
  try {
    unlinkSync(filePath)
  } catch {
    // File doesn't exist — nothing to delete
  }
}
