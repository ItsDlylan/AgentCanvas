import { useState, useEffect, useCallback } from 'react'
import { useCanvasStore } from '@/store/canvas-store'
import type { WorkspaceTemplate } from '@/types/settings'

export interface ResolvedTemplate extends WorkspaceTemplate {
  scope: 'global' | 'project'
}

const PROJECT_TEMPLATES_CHANGED = 'project-templates-changed'

export function useResolvedTemplates(globalTemplates: WorkspaceTemplate[]) {
  const activeWorkspaceId = useCanvasStore((s) => s.activeWorkspaceId)
  const workspaces = useCanvasStore((s) => s.workspaces)
  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId)
  const isProjectScope = !!activeWorkspace?.path

  const [projectTemplates, setProjectTemplates] = useState<WorkspaceTemplate[]>([])

  // Load project templates when workspace changes
  useEffect(() => {
    if (!isProjectScope) {
      setProjectTemplates([])
      return
    }
    window.templates.loadProject(activeWorkspaceId).then(setProjectTemplates)
  }, [activeWorkspaceId, isProjectScope])

  // Reload when any hook instance saves (broadcasts the event)
  useEffect(() => {
    const handler = () => {
      if (!isProjectScope) return
      window.templates.loadProject(activeWorkspaceId).then(setProjectTemplates)
    }
    window.addEventListener(PROJECT_TEMPLATES_CHANGED, handler)
    return () => window.removeEventListener(PROJECT_TEMPLATES_CHANGED, handler)
  }, [activeWorkspaceId, isProjectScope])

  // Merge: project templates win on name conflict (case-insensitive)
  const resolvedTemplates: ResolvedTemplate[] = (() => {
    const result: ResolvedTemplate[] = projectTemplates.map((t) => ({ ...t, scope: 'project' as const }))
    const projectNames = new Set(projectTemplates.map((t) => t.name.toLowerCase()))
    for (const t of globalTemplates) {
      if (!projectNames.has(t.name.toLowerCase())) {
        result.push({ ...t, scope: 'global' as const })
      }
    }
    return result
  })()

  const saveProjectTemplates = useCallback(
    async (templates: WorkspaceTemplate[]) => {
      if (!isProjectScope) return
      await window.templates.saveProject(activeWorkspaceId, templates)
      setProjectTemplates(templates)
      // Notify all other hook instances to reload
      window.dispatchEvent(new Event(PROJECT_TEMPLATES_CHANGED))
    },
    [activeWorkspaceId, isProjectScope]
  )

  const reloadProjectTemplates = useCallback(async () => {
    if (!isProjectScope) return
    const loaded = await window.templates.loadProject(activeWorkspaceId)
    setProjectTemplates(loaded)
  }, [activeWorkspaceId, isProjectScope])

  return {
    resolvedTemplates,
    projectTemplates,
    saveProjectTemplates,
    reloadProjectTemplates,
    isProjectScope
  }
}
