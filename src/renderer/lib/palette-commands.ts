import { useMemo } from 'react'
import { useCanvasStore } from '@/store/canvas-store'
import { useResolvedTemplates } from '@/hooks/useResolvedTemplates'
import { useSettings } from '@/hooks/useSettings'
import type { WorkspaceTemplate } from '@/types/settings'
import { DEFAULT_HOTKEYS, formatHotkey } from '@/hooks/useHotkeys'

export type PaletteCommandSection = 'template' | 'workspace' | 'toggle' | 'canvas'

export interface PaletteCommand {
  id: string
  label: string
  keywords: string[]
  section: PaletteCommandSection
  hotkey?: string
  run: (ctx: { workspaceId?: string }) => void
}

/**
 * Event name dispatched for UI-level actions (toggles, open settings) that live
 * in Canvas.tsx local state. Canvas.tsx listens and maps to its hotkey actions.
 * Commands registry emits these events — Canvas.tsx owns the real handlers.
 */
export const PALETTE_ACTION_EVENT = 'palette:action'

export type PaletteUiAction =
  | 'toggleMinimap'
  | 'toggleProcessPanel'
  | 'toggleWorkspacePanel'
  | 'openSettings'
  | 'killFocused'
  | 'zoomToFocused'
  | 'cycleFocusForward'
  | 'cycleFocusBackward'

function dispatchUiAction(action: PaletteUiAction): void {
  window.dispatchEvent(new CustomEvent(PALETTE_ACTION_EVENT, { detail: { action } }))
}

function hotkeyFor(action: keyof typeof DEFAULT_HOTKEYS): string {
  return formatHotkey(DEFAULT_HOTKEYS[action])
}

function fixedCommands(): PaletteCommand[] {
  return [
    {
      id: 'toggle-minimap',
      label: 'Toggle minimap',
      keywords: ['minimap', 'toggle', 'mini', 'map', 'overview'],
      section: 'toggle',
      hotkey: hotkeyFor('toggleMinimap'),
      run: () => dispatchUiAction('toggleMinimap')
    },
    {
      id: 'toggle-process-panel',
      label: 'Toggle process panel',
      keywords: ['process', 'panel', 'toggle', 'processes'],
      section: 'toggle',
      hotkey: hotkeyFor('toggleProcessPanel'),
      run: () => dispatchUiAction('toggleProcessPanel')
    },
    {
      id: 'toggle-workspace-panel',
      label: 'Toggle workspace panel',
      keywords: ['workspace', 'panel', 'toggle', 'workspaces'],
      section: 'toggle',
      hotkey: hotkeyFor('toggleWorkspacePanel'),
      run: () => dispatchUiAction('toggleWorkspacePanel')
    },
    {
      id: 'toggle-settings',
      label: 'Toggle settings',
      keywords: ['settings', 'preferences', 'config', 'open'],
      section: 'toggle',
      hotkey: hotkeyFor('openSettings'),
      run: () => dispatchUiAction('openSettings')
    },
    {
      id: 'kill-focused',
      label: 'Kill focused tile',
      keywords: ['kill', 'close', 'focused', 'destroy', 'remove'],
      section: 'canvas',
      hotkey: hotkeyFor('killFocused'),
      run: () => dispatchUiAction('killFocused')
    },
    {
      id: 'zoom-to-focused',
      label: 'Zoom to focused tile',
      keywords: ['zoom', 'focus', 'center', 'focused'],
      section: 'canvas',
      hotkey: hotkeyFor('zoomToFocused'),
      run: () => useCanvasStore.getState().zoomToFocused()
    },
    {
      id: 'cycle-focus-forward',
      label: 'Cycle focus forward',
      keywords: ['cycle', 'focus', 'next', 'forward'],
      section: 'canvas',
      hotkey: hotkeyFor('cycleFocusForward'),
      run: () => dispatchUiAction('cycleFocusForward')
    },
    {
      id: 'cycle-focus-backward',
      label: 'Cycle focus backward',
      keywords: ['cycle', 'focus', 'previous', 'backward', 'back'],
      section: 'canvas',
      hotkey: hotkeyFor('cycleFocusBackward'),
      run: () => dispatchUiAction('cycleFocusBackward')
    },
    {
      id: 'new-terminal',
      label: 'New terminal',
      keywords: ['new', 'terminal', 'spawn', 'create', 'shell'],
      section: 'canvas',
      hotkey: hotkeyFor('newTerminal'),
      run: () => useCanvasStore.getState().addTerminalAt()
    },
    {
      id: 'new-browser',
      label: 'New browser',
      keywords: ['new', 'browser', 'spawn', 'create', 'web'],
      section: 'canvas',
      hotkey: hotkeyFor('newBrowser'),
      run: () => useCanvasStore.getState().addBrowserAt()
    },
    {
      id: 'new-note',
      label: 'New note',
      keywords: ['new', 'note', 'spawn', 'create', 'notes'],
      section: 'canvas',
      hotkey: hotkeyFor('newNote'),
      run: () => useCanvasStore.getState().addNoteAt()
    }
  ]
}

function workspaceCommands(
  workspaces: Array<{ id: string; name: string }>
): PaletteCommand[] {
  return workspaces.map((ws) => ({
    id: `switch-workspace-${ws.id}`,
    label: `Switch to ${ws.name}`,
    keywords: ['switch', 'workspace', ws.name.toLowerCase()],
    section: 'workspace',
    run: () => useCanvasStore.getState().selectWorkspace(ws.id)
  }))
}

function templateCommands(templates: WorkspaceTemplate[]): PaletteCommand[] {
  return templates.map((tpl) => ({
    id: `spawn-template-${tpl.id}`,
    label: `Spawn: ${tpl.name}`,
    keywords: ['spawn', 'template', tpl.name.toLowerCase()],
    section: 'template',
    run: (ctx) => {
      const store = useCanvasStore.getState()
      if (ctx.workspaceId) {
        store.spawnTemplateInWorkspace(tpl, ctx.workspaceId)
      } else {
        store.spawnTemplate(tpl)
      }
    }
  }))
}

/**
 * Returns the full command set: fixed commands + one command per workspace +
 * one command per resolved template. Recomputes when workspaces or templates change.
 */
export function useCommands(): PaletteCommand[] {
  const workspaces = useCanvasStore((s) => s.workspaces)
  const { settings } = useSettings()
  const { resolvedTemplates } = useResolvedTemplates(settings.templates)

  return useMemo(() => {
    return [
      ...fixedCommands(),
      ...workspaceCommands(workspaces),
      ...templateCommands(resolvedTemplates)
    ]
  }, [workspaces, resolvedTemplates])
}
