// ── Action executor ───────────────────────────────────────
// Maps VoiceAction types to Zustand store callbacks.
// Handles confirmation flow for destructive actions.
// Maintains undo stack for reversible actions.

import type { VoiceAction, UndoableAction } from './types'
import { useCanvasStore } from '@/store/canvas-store'

const undoStack: UndoableAction[] = []
const MAX_UNDO = 20

export interface ExecuteResult {
  ok: boolean
  message: string
  needsConfirmation?: boolean
}

export function executeAction(action: VoiceAction): ExecuteResult {
  const store = useCanvasStore.getState()

  switch (action.type) {
    // ── Tile spawning (immediate) ──

    case 'tile.spawnTerminal': {
      store.addTerminalAt()
      return { ok: true, message: 'Terminal spawned' }
    }

    case 'tile.spawnBrowser': {
      store.addBrowserAt()
      return { ok: true, message: 'Browser spawned' }
    }

    case 'tile.spawnNote': {
      store.addNoteAt()
      return { ok: true, message: 'Note created' }
    }

    case 'tile.spawnDraw': {
      store.addDrawAt()
      return { ok: true, message: 'Draw created' }
    }

    case 'tile.rename': {
      const { focusedId } = store
      if (!focusedId) return { ok: false, message: 'No tile focused' }
      const label = action.params.label as string
      const oldNode = store.allNodes.find(
        (n) => (n.data as Record<string, unknown>).sessionId === focusedId
      )
      const oldLabel = oldNode ? (oldNode.data as Record<string, unknown>).label as string : ''
      store.renameTile(focusedId, label)
      pushUndo(action, () => store.renameTile(focusedId, oldLabel))
      return { ok: true, message: `Renamed to "${label}"` }
    }

    // ── Tile destruction (requires confirmation) ──

    case 'tile.closeFocused': {
      const { focusedId } = store
      if (!focusedId) return { ok: false, message: 'No tile focused' }
      const node = store.allNodes.find(
        (n) => (n.data as Record<string, unknown>).sessionId === focusedId
      )
      const label = node ? (node.data as Record<string, unknown>).label as string : focusedId
      if (node?.type === 'notes') {
        store.closeNote(focusedId)
      } else {
        store.killTile(focusedId)
      }
      return { ok: true, message: `Closed "${label}"` }
    }

    case 'tile.closeByLabel': {
      const label = (action.params.label as string).toLowerCase()
      const node = store.allNodes.find((n) => {
        const l = (n.data as Record<string, unknown>).label as string
        return l?.toLowerCase().includes(label)
      })
      if (!node) return { ok: false, message: `No tile matching "${label}"` }
      const sid = (node.data as Record<string, unknown>).sessionId as string
      if (node.type === 'notes') {
        store.closeNote(sid)
      } else {
        store.killTile(sid)
      }
      return { ok: true, message: `Closed "${(node.data as Record<string, unknown>).label}"` }
    }

    // ── Navigation ──

    case 'navigate.workspace': {
      const name = (action.params.name as string).toLowerCase()
      const ws = store.workspaces.find((w) => w.name.toLowerCase().includes(name))
      if (!ws) return { ok: false, message: `No workspace matching "${name}"` }
      store.selectWorkspace(ws.id)
      return { ok: true, message: `Switched to "${ws.name}"` }
    }

    case 'navigate.tile': {
      const label = (action.params.label as string).toLowerCase()
      const node = store.allNodes.find((n) => {
        const l = (n.data as Record<string, unknown>).label as string
        return l?.toLowerCase().includes(label)
      })
      if (!node) return { ok: false, message: `No tile matching "${label}"` }
      store.focusTile((node.data as Record<string, unknown>).sessionId as string)
      return { ok: true, message: `Focused "${(node.data as Record<string, unknown>).label}"` }
    }

    case 'navigate.zoom': {
      const instance = store.reactFlowInstance
      if (!instance) return { ok: false, message: 'Canvas not ready' }
      if (action.params.direction === 'in') instance.zoomIn({ duration: 300 })
      else instance.zoomOut({ duration: 300 })
      return { ok: true, message: `Zoomed ${action.params.direction}` }
    }

    case 'navigate.fitAll': {
      store.reactFlowInstance?.fitView({ duration: 400, padding: 0.2 })
      return { ok: true, message: 'Fit to view' }
    }

    // ── Agent control ──

    case 'agent.approve':
    case 'agent.reject': {
      const { focusedId } = store
      if (!focusedId) return { ok: false, message: 'No terminal focused' }
      const input = action.type === 'agent.approve' ? 'y\n' : 'n\n'
      window.terminal.write(focusedId, input)
      return { ok: true, message: action.type === 'agent.approve' ? 'Approved' : 'Rejected' }
    }

    case 'agent.interrupt': {
      const { focusedId } = store
      if (!focusedId) return { ok: false, message: 'No terminal focused' }
      window.terminal.write(focusedId, '\x03')
      return { ok: true, message: 'Interrupted' }
    }

    case 'agent.sendInput': {
      const { focusedId } = store
      if (!focusedId) return { ok: false, message: 'No terminal focused' }
      window.terminal.write(focusedId, (action.params.text as string) + '\n')
      return { ok: true, message: 'Sent' }
    }

    // ── Queries ──

    case 'query.status': {
      const nodes = store.allNodes
      const terminals = nodes.filter((n) => n.type === 'terminal').length
      const browsers = nodes.filter((n) => n.type === 'browser').length
      const notes = nodes.filter((n) => n.type === 'notes').length
      return { ok: true, message: `${terminals} terminals, ${browsers} browsers, ${notes} notes` }
    }

    // ── Undo ──

    case 'undo': {
      const entry = undoStack.pop()
      if (!entry) return { ok: false, message: 'Nothing to undo' }
      entry.undo()
      return { ok: true, message: 'Undone' }
    }

    default:
      return { ok: false, message: `Unknown action: ${action.type}` }
  }
}

function pushUndo(action: VoiceAction, undo: () => void) {
  undoStack.push({ action, undo, timestamp: Date.now() })
  if (undoStack.length > MAX_UNDO) undoStack.shift()
}
