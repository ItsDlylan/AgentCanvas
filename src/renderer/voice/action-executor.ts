// ── Action executor ───────────────────────────────────────
// Maps VoiceAction types to Zustand store callbacks.
// Handles confirmation flow for destructive actions.
// Maintains undo stack for reversible actions.
// Uses pre-resolved sessionIds from context when available.

import type { VoiceAction, UndoableAction } from './types'
import { useCanvasStore } from '@/store/canvas-store'
import { routeToAgent, broadcastToAgents } from './multi-agent'

const undoStack: UndoableAction[] = []
const MAX_UNDO = 20

export interface ExecuteResult {
  ok: boolean
  message: string
  needsConfirmation?: boolean
  /** Signals that an overlay should be activated */
  overlay?: 'numbers' | 'grid'
  /** For overlay.focusNumber — the selected number */
  selectedNumber?: number
}

export function executeAction(action: VoiceAction): ExecuteResult {
  const store = useCanvasStore.getState()

  // If context resolution found ambiguity, report it
  if (action.params.ambiguous && action.params.candidates) {
    const candidates = action.params.candidates as Array<{ label: string; type: string }>
    const list = candidates.map((c) => `${c.label} (${c.type})`).join(', ')
    return { ok: false, message: `Which one? ${list}` }
  }

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
      const targetId = (action.params.sessionId as string) ?? store.focusedId
      if (!targetId) return { ok: false, message: 'No tile focused' }
      const label = action.params.label as string
      const oldNode = store.allNodes.find(
        (n) => (n.data as Record<string, unknown>).sessionId === targetId
      )
      const oldLabel = oldNode ? (oldNode.data as Record<string, unknown>).label as string : ''
      store.renameTile(targetId, label)
      pushUndo(action, () => store.renameTile(targetId, oldLabel))
      return { ok: true, message: `Renamed to "${label}"` }
    }

    // ── Tile destruction (requires confirmation) ──

    case 'tile.closeFocused': {
      const targetId = (action.params.sessionId as string) ?? store.focusedId
      if (!targetId) return { ok: false, message: 'No tile focused' }
      const node = store.allNodes.find(
        (n) => (n.data as Record<string, unknown>).sessionId === targetId
      )
      const label = node ? (node.data as Record<string, unknown>).label as string : targetId
      if (node?.type === 'notes') {
        store.closeNote(targetId)
      } else {
        store.killTile(targetId)
      }
      return { ok: true, message: `Closed "${label}"` }
    }

    case 'tile.closeByLabel': {
      // Use pre-resolved sessionId if available
      if (action.params.sessionId) {
        const sid = action.params.sessionId as string
        const node = store.allNodes.find(
          (n) => (n.data as Record<string, unknown>).sessionId === sid
        )
        if (!node) return { ok: false, message: 'Tile not found' }
        const label = (node.data as Record<string, unknown>).label as string
        if (node.type === 'notes') {
          store.closeNote(sid)
        } else {
          store.killTile(sid)
        }
        return { ok: true, message: `Closed "${label}"` }
      }

      // Fallback: search by label text
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
      // Use pre-resolved sessionId if available
      if (action.params.sessionId) {
        const sid = action.params.sessionId as string
        const resolvedLabel = (action.params.resolvedLabel as string) ?? sid
        store.focusTile(sid)
        return { ok: true, message: `Focused "${resolvedLabel}"` }
      }

      // Fallback: search by label text
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
      const targetId = (action.params.sessionId as string) ?? store.focusedId
      if (!targetId) return { ok: false, message: 'No terminal focused' }
      const input = action.type === 'agent.approve' ? 'y\r' : 'n\r'
      window.terminal.write(targetId, input)
      return { ok: true, message: action.type === 'agent.approve' ? 'Approved' : 'Rejected' }
    }

    case 'agent.interrupt': {
      const targetId = (action.params.sessionId as string) ?? store.focusedId
      if (!targetId) return { ok: false, message: 'No terminal focused' }
      window.terminal.write(targetId, '\x03')
      return { ok: true, message: 'Interrupted' }
    }

    case 'agent.sendInput': {
      const targetId = (action.params.sessionId as string) ?? store.focusedId
      if (!targetId) return { ok: false, message: 'No terminal focused' }
      window.terminal.write(targetId, (action.params.text as string) + '\r')
      return { ok: true, message: 'Sent' }
    }

    case 'agent.tellTo': {
      // Target resolved by agent-resolver via context
      const targetId = action.params.sessionId as string
      if (!targetId) return { ok: false, message: 'Could not find that agent' }
      const message = action.params.message as string
      routeToAgent(targetId, message)
      const label = (action.params.resolvedLabel as string) ?? targetId
      return { ok: true, message: `Sent to "${label}"` }
    }

    case 'agent.sendTo': {
      // "send X to Y" — resolved target
      const targetId = action.params.sessionId as string
      if (!targetId) return { ok: false, message: 'Could not find that terminal' }
      const text = action.params.text as string
      routeToAgent(targetId, text)
      const label = (action.params.resolvedLabel as string) ?? targetId
      return { ok: true, message: `Sent "${text}" to "${label}"` }
    }

    case 'agent.broadcastTo': {
      // "tell all X to Y" — resolved to multiple targets
      const targets = action.targets
      if (!targets || targets.length === 0) return { ok: false, message: 'No matching agents found' }
      const message = action.params.message as string
      const count = broadcastToAgents(targets, message)
      return { ok: true, message: `Sent to ${count} terminal${count !== 1 ? 's' : ''}` }
    }

    // ── Queries ──

    case 'query.status': {
      const nodes = store.allNodes
      const terminals = nodes.filter((n) => n.type === 'terminal').length
      const browsers = nodes.filter((n) => n.type === 'browser').length
      const notes = nodes.filter((n) => n.type === 'notes').length
      return { ok: true, message: `${terminals} terminals, ${browsers} browsers, ${notes} notes` }
    }

    // ── Overlays ──

    case 'overlay.showNumbers': {
      return { ok: true, message: 'Showing numbers', overlay: 'numbers' }
    }

    case 'overlay.showGrid': {
      return { ok: true, message: 'Showing grid', overlay: 'grid' }
    }

    case 'overlay.focusNumber': {
      const num = action.params.number as number
      return { ok: true, message: `Selected ${num}`, selectedNumber: num }
    }

    // ── Multi-step plan (Tier 3 LLM) ──

    case '__plan': {
      const plan = action.params.plan as { steps: VoiceAction[] }
      const results: string[] = []
      for (const step of plan.steps) {
        const stepResult = executeAction(step)
        results.push(stepResult.message)
      }
      return { ok: true, message: results.join(', ') }
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
