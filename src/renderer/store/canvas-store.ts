import { create } from 'zustand'
import type { Node, Edge, ReactFlowInstance, Viewport } from '@xyflow/react'
import { v4 as uuid } from 'uuid'
import type { Workspace } from '@/types/workspace'
import { DEFAULT_WORKSPACE } from '@/types/workspace'
import type { DevicePreset } from '@/constants/devicePresets'
import { BROWSER_CHROME_WIDTH, BROWSER_CHROME_HEIGHT } from '@/constants/devicePresets'
import { markTerminalRead } from '@/hooks/useNotifications'
import { navigateBrowser } from '@/hooks/useBrowserNavigation'

// ── Helper functions ──────────────────────────────────────

export function defaultTileWidth(type: string | undefined): number {
  return type === 'browser' ? 800 : type === 'notes' ? 400 : type === 'diffViewer' ? 700 : type === 'devTools' ? 900 : type === 'draw' ? 800 : type === 'image' ? 500 : 640
}

export function defaultTileHeight(type: string | undefined): number {
  return type === 'browser' ? 600 : type === 'notes' ? 400 : type === 'diffViewer' ? 500 : type === 'devTools' ? 500 : type === 'draw' ? 600 : type === 'image' ? 400 : 400
}

let tileCount = 0

export function findOpenPosition(
  existingNodes: Node[],
  width: number,
  height: number,
  colSpan: number,
  gap: number
): { x: number; y: number } {
  const stepX = width + gap
  const stepY = height + gap

  for (let slot = 0; slot < 200; slot++) {
    const candidate = {
      x: 100 + (slot % colSpan) * stepX,
      y: 100 + Math.floor(slot / colSpan) * stepY
    }
    const overlaps = existingNodes.some((n) => {
      const nw = (n.style?.width as number) ?? defaultTileWidth(n.type)
      const nh = (n.style?.height as number) ?? defaultTileHeight(n.type)
      return (
        candidate.x < n.position.x + nw &&
        candidate.x + width > n.position.x &&
        candidate.y < n.position.y + nh &&
        candidate.y + height > n.position.y
      )
    })
    if (!overlaps) return candidate
  }
  return { x: 100, y: 100 + existingNodes.length * stepY }
}

export function snapToGrid(
  click: { x: number; y: number },
  existingNodes: Node[],
  width: number,
  height: number,
  gap: number
): { x: number; y: number } {
  const stepX = width + gap
  const stepY = height + gap
  const centerCol = Math.round((click.x - 100) / stepX)
  const centerRow = Math.round((click.y - 100) / stepY)

  const isOccupied = (c: number, r: number) => {
    const pos = { x: 100 + c * stepX, y: 100 + r * stepY }
    return existingNodes.some((n) => {
      const nw = (n.style?.width as number) ?? defaultTileWidth(n.type)
      const nh = (n.style?.height as number) ?? defaultTileHeight(n.type)
      return (
        pos.x < n.position.x + nw &&
        pos.x + width > n.position.x &&
        pos.y < n.position.y + nh &&
        pos.y + height > n.position.y
      )
    })
  }

  const range = 10
  let best: { x: number; y: number } | null = null
  let bestDist = Infinity
  for (let r = centerRow - range; r <= centerRow + range; r++) {
    for (let c = centerCol - range; c <= centerCol + range; c++) {
      if (isOccupied(c, r)) continue
      const cellCenterX = 100 + c * stepX + width / 2
      const cellCenterY = 100 + r * stepY + height / 2
      const d = (click.x - cellCenterX) ** 2 + (click.y - cellCenterY) ** 2
      if (d < bestDist) {
        bestDist = d
        best = { x: 100 + c * stepX, y: 100 + r * stepY }
      }
    }
  }

  return best ?? { x: 100, y: 100 + existingNodes.length * stepY }
}

function radialPosition(
  source: { x: number; y: number; width: number; height: number },
  index: number,
  total: number,
  radius = 800
): { x: number; y: number } {
  const arcStart = -70 * (Math.PI / 180)
  const arcEnd = 70 * (Math.PI / 180)
  const angle = total <= 1
    ? 0
    : arcStart + (index / (total - 1)) * (arcEnd - arcStart)

  const centerX = source.x + source.width / 2
  const centerY = source.y + source.height / 2

  return {
    x: centerX + Math.cos(angle) * radius,
    y: centerY + Math.sin(angle) * radius
  }
}

// ── Types ─────────────────────────────────────────────────

type NodeUpdater = Node[] | ((prev: Node[]) => Node[])
type EdgeUpdater = Edge[] | ((prev: Edge[]) => Edge[])
type MapUpdater = Map<string, string> | ((prev: Map<string, string>) => Map<string, string>)
type WorkspaceUpdater = Workspace[] | ((prev: Workspace[]) => Workspace[])
type FlagsUpdater =
  | { notes: boolean; terminals: boolean; browsers: boolean; draws: boolean }
  | ((prev: { notes: boolean; terminals: boolean; browsers: boolean; draws: boolean }) =>
      { notes: boolean; terminals: boolean; browsers: boolean; draws: boolean })

export interface TerminalSpawnInfo {
  terminalId: string
  label?: string
  cwd?: string
  command?: string
  linkedTerminalId?: string
  width?: number
  height?: number
  metadata?: Record<string, unknown>
}

export interface TerminalTileRef {
  scrollToLine: (lineNo: number) => void
  highlightLine: (lineNo: number) => void
}

const RECENCY_CAP = 50
const RECENCY_STORAGE_KEY = 'agentcanvas.palette.recencyList'

function loadRecencyList(): string[] {
  try {
    const raw = localStorage.getItem(RECENCY_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string').slice(0, RECENCY_CAP) : []
  } catch {
    return []
  }
}

function saveRecencyList(list: string[]): void {
  try {
    localStorage.setItem(RECENCY_STORAGE_KEY, JSON.stringify(list))
  } catch {
    // ignore quota errors
  }
}

export interface CanvasStore {
  // ── Core state ──
  allNodes: Node[]
  allEdges: Edge[]
  focusedId: string | null
  preFocusViewport: { viewport: Viewport; tileId: string } | null
  tileWorkspaceMap: Map<string, string>
  activeWorkspaceId: string
  workspaces: Workspace[]
  nodesLoadedFlags: { notes: boolean; terminals: boolean; browsers: boolean; draws: boolean }

  // ── Config (set by Canvas on mount) ──
  reactFlowInstance: ReactFlowInstance | null
  tileGap: number
  viewportCache: Map<string, Viewport>
  browserDefaultUrl: string

  // ── State setters ──
  setReactFlowInstance: (instance: ReactFlowInstance) => void
  setTileGap: (gap: number) => void
  setBrowserDefaultUrl: (url: string) => void
  setAllNodes: (updater: NodeUpdater) => void
  setAllEdges: (updater: EdgeUpdater) => void
  setFocusedId: (id: string | null) => void
  setTileWorkspaceMap: (updater: MapUpdater) => void
  setActiveWorkspaceId: (id: string) => void
  setWorkspaces: (updater: WorkspaceUpdater) => void
  setNodesLoadedFlags: (updater: FlagsUpdater) => void

  // ── Computed ──
  getVisibleNodes: () => Node[]

  // ── Tile CRUD ──
  removeTileFromCanvas: (sessionId: string) => void
  killTile: (sessionId: string) => void
  addTerminalAt: (position?: { x: number; y: number }, width?: number, height?: number, command?: string, label?: string, cwdOverride?: string) => void
  addBrowserAt: (position?: { x: number; y: number }, preset?: DevicePreset) => void
  addNoteAt: (position?: { x: number; y: number }) => void
  addDrawAt: (position?: { x: number; y: number }, linkedTerminalId?: string) => string
  addBrowserForTerminal: (terminalId: string, url: string, reservationId?: string, tileWidth?: number, tileHeight?: number) => void
  addTerminalForTerminal: (info: TerminalSpawnInfo) => void
  addNoteForApi: (info: { noteId: string; label?: string; linkedTerminalId?: string; linkedNoteId?: string; position?: { x: number; y: number }; width?: number; height?: number }) => void
  focusTile: (sessionId: string) => void
  zoomToFocused: () => void
  renameTile: (sessionId: string, newLabel: string) => void

  // ── Note management ──
  getChildNoteIds: (parentId: string) => string[]
  closeNote: (sessionId: string) => void
  deleteNote: (sessionId: string) => void
  spawnLinkedNote: (sourceNoteId: string, taskId: string, taskText: string, onCreated: (newNoteId: string) => void) => void
  focusNoteOnCanvas: (noteId: string) => void

  // ── Image management ──
  addImageAt: (position: { x: number; y: number }, sourcePath: string) => Promise<void>
  deleteImage: (sessionId: string) => void

  // ── Draw management ──
  closeDraw: (sessionId: string) => void
  deleteDraw: (sessionId: string) => void

  // ── Diff/DevTools ──
  toggleDiffViewer: (terminalSessionId: string) => void
  hasDiffViewer: (terminalSessionId: string) => boolean
  toggleDevTools: (browserSessionId: string) => void
  hasDevTools: (browserSessionId: string) => boolean

  // ── Workspace management ──
  selectWorkspace: (id: string) => void
  addWorkspace: () => Promise<void>
  removeWorkspace: (id: string) => void
  renameWorkspace: (id: string, name: string) => void
  setWorkspacePath: (id: string) => Promise<void>
  setWorkspaceDefaultUrl: (id: string, url: string | null) => void
  focusProcess: (workspaceId: string, sessionId: string) => void

  // ── Template ──
  spawnTemplate: (template: { tiles: Array<{ type: string; relativePosition: { x: number; y: number }; width: number; height: number; command?: string; label?: string; cwd?: string }> }, origin?: { x: number; y: number }) => void
  spawnTemplateInWorkspace: (
    template: { tiles: Array<{ type: string; relativePosition: { x: number; y: number }; width: number; height: number; command?: string; label?: string; cwd?: string }> },
    workspaceId: string,
    origin?: { x: number; y: number }
  ) => void

  // ── Palette ──
  recencyList: string[]
  paletteOpen: boolean
  terminalRefs: Map<string, TerminalTileRef>
  openPalette: () => void
  closePalette: () => void
  togglePalette: () => void
  registerTerminalRef: (id: string, ref: TerminalTileRef) => void
  unregisterTerminalRef: (id: string) => void
  jumpToScrollbackMatch: (terminalId: string, lineNo: number) => void
}

// ── Store ──────────────────────────────────────────────────

export const useCanvasStore = create<CanvasStore>((set, get) => {
  // Internal helper: get sessionId from node data
  const sid = (n: Node): string => (n.data as Record<string, unknown>).sessionId as string

  // Internal helper: find node by sessionId
  const findNode = (sessionId: string): Node | undefined =>
    get().allNodes.find((n) => sid(n) === sessionId)

  // Internal helper: center viewport on position
  const centerOn = (x: number, y: number, zoom = 1, duration = 400) => {
    get().reactFlowInstance?.setCenter(x, y, { zoom, duration })
  }

  return {
    // ── Initial state ──
    allNodes: [],
    allEdges: [],
    focusedId: null,
    preFocusViewport: null,
    tileWorkspaceMap: new Map(),
    activeWorkspaceId: 'default',
    workspaces: [DEFAULT_WORKSPACE],
    nodesLoadedFlags: { notes: false, terminals: false, browsers: false, draws: false },
    reactFlowInstance: null,
    tileGap: 40,
    viewportCache: new Map(),
    browserDefaultUrl: 'https://google.com',
    recencyList: loadRecencyList(),
    paletteOpen: false,
    terminalRefs: new Map(),

    // ── Config setters ──
    setReactFlowInstance: (instance) => set({ reactFlowInstance: instance }),
    setTileGap: (gap) => set({ tileGap: gap }),
    setBrowserDefaultUrl: (url) => set({ browserDefaultUrl: url }),

    // ── State setters ──
    setAllNodes: (updater) =>
      set((s) => ({
        allNodes: typeof updater === 'function' ? updater(s.allNodes) : updater
      })),

    setAllEdges: (updater) =>
      set((s) => ({
        allEdges: typeof updater === 'function' ? updater(s.allEdges) : updater
      })),

    setFocusedId: (id) => { set({ focusedId: id }); if (id) markTerminalRead(id) },

    setTileWorkspaceMap: (updater) =>
      set((s) => ({
        tileWorkspaceMap: typeof updater === 'function' ? updater(s.tileWorkspaceMap) : updater
      })),

    setActiveWorkspaceId: (id) => set({ activeWorkspaceId: id }),

    setWorkspaces: (updater) =>
      set((s) => ({
        workspaces: typeof updater === 'function' ? updater(s.workspaces) : updater
      })),

    setNodesLoadedFlags: (updater) =>
      set((s) => ({
        nodesLoadedFlags: typeof updater === 'function' ? updater(s.nodesLoadedFlags) : updater
      })),

    // ── Computed ──
    getVisibleNodes: () => {
      const { allNodes, tileWorkspaceMap, activeWorkspaceId } = get()
      return allNodes.filter((n) => {
        const id = sid(n)
        return tileWorkspaceMap.get(id) === activeWorkspaceId || n.type === 'browser'
      })
    },

    // ── Tile CRUD ──

    removeTileFromCanvas: (sessionId) => {
      set((s) => {
        const nextRecency = s.recencyList.filter((id) => id !== sessionId)
        if (nextRecency.length !== s.recencyList.length) saveRecencyList(nextRecency)
        const nextRefs = new Map(s.terminalRefs)
        nextRefs.delete(sessionId)
        return {
          allNodes: s.allNodes.filter((n) => sid(n) !== sessionId),
          allEdges: s.allEdges.filter((e) => e.source !== sessionId && e.target !== sessionId),
          focusedId: s.focusedId === sessionId ? null : s.focusedId,
          tileWorkspaceMap: (() => {
            const next = new Map(s.tileWorkspaceMap)
            next.delete(sessionId)
            return next
          })(),
          recencyList: nextRecency,
          terminalRefs: nextRefs
        }
      })
    },

    killTile: (sessionId) => {
      const node = findNode(sessionId)
      const { removeTileFromCanvas } = get()

      if (node?.type === 'browser') {
        window.browser.destroy(sessionId)
        // Also remove linked DevTools
        const linkedDevTools = get().allNodes.find(
          (n) => n.type === 'devTools' && (n.data as Record<string, unknown>).linkedBrowserId === sessionId
        )
        if (linkedDevTools) {
          removeTileFromCanvas(sid(linkedDevTools))
        }
      } else if (node?.type === 'notes') {
        window.note.delete(sessionId)
      } else if (node?.type === 'draw') {
        window.draw.delete(sessionId)
      } else if (node?.type === 'image') {
        window.image.delete(sessionId)
      } else if (node?.type === 'diffViewer') {
        // Diff viewers just get removed
      } else {
        window.terminal.kill(sessionId)
        // Also remove linked diff viewer
        const linkedDiff = get().allNodes.find(
          (n) => n.type === 'diffViewer' && (n.data as Record<string, unknown>).linkedTerminalId === sessionId
        )
        if (linkedDiff) {
          removeTileFromCanvas(sid(linkedDiff))
        }
      }
      removeTileFromCanvas(sessionId)
    },

    addTerminalAt: (position, width = 640, height = 400, command, label, cwdOverride) => {
      tileCount++
      const sessionId = uuid()
      const { tileGap, activeWorkspaceId, workspaces } = get()
      const visible = get().getVisibleNodes()
      const pos = position ?? findOpenPosition(visible, width, height, 4, tileGap)

      const ws = workspaces.find((w) => w.id === activeWorkspaceId)
      const basePath = ws?.path ?? undefined
      const cwd = cwdOverride
        ? (cwdOverride.startsWith('/') ? cwdOverride : basePath ? basePath + '/' + cwdOverride : cwdOverride)
        : basePath

      const newNode: Node = {
        id: sessionId,
        type: 'terminal',
        position: pos,
        style: { width, height },
        data: { sessionId, label: label ? `${label} ${tileCount}` : `Terminal ${tileCount}`, cwd, command },
        dragHandle: '.terminal-tile-header'
      }

      set((s) => ({
        allNodes: [...s.allNodes, newNode],
        tileWorkspaceMap: new Map(s.tileWorkspaceMap).set(sessionId, activeWorkspaceId),
        focusedId: sessionId
      }))
      centerOn(pos.x + width / 2, pos.y + height / 2)
    },

    addBrowserAt: (position, preset) => {
      tileCount++
      const sessionId = uuid()
      const { tileGap, activeWorkspaceId, workspaces, browserDefaultUrl } = get()
      const tileW = preset ? preset.width + BROWSER_CHROME_WIDTH : 800
      const tileH = preset ? preset.height + BROWSER_CHROME_HEIGHT : 600
      const visible = get().getVisibleNodes()
      const pos = position ?? findOpenPosition(visible, tileW, tileH, 3, tileGap)

      const ws = workspaces.find((w) => w.id === activeWorkspaceId)
      const url = ws?.defaultUrl || browserDefaultUrl

      const newNode: Node = {
        id: sessionId,
        type: 'browser',
        position: pos,
        style: { width: tileW, height: tileH },
        data: {
          sessionId,
          label: `Browser ${tileCount}`,
          initialUrl: url,
          initialPreset: preset && (preset.mobile || preset.dpr > 1) ? preset : undefined
        },
        dragHandle: '.browser-tile-header'
      }

      set((s) => ({
        allNodes: [...s.allNodes, newNode],
        tileWorkspaceMap: new Map(s.tileWorkspaceMap).set(sessionId, activeWorkspaceId),
        focusedId: sessionId
      }))
      centerOn(pos.x + tileW / 2, pos.y + tileH / 2)
    },

    addNoteAt: (position) => {
      tileCount++
      const sessionId = uuid()
      const { tileGap, activeWorkspaceId } = get()
      const visible = get().getVisibleNodes()
      const pos = position ?? findOpenPosition(visible, 400, 400, 4, tileGap)
      const label = `Note ${tileCount}`

      const newNode: Node = {
        id: sessionId,
        type: 'notes',
        position: pos,
        style: { width: 400, height: 400 },
        data: { sessionId, label },
        dragHandle: '.notes-tile-header'
      }

      set((s) => ({
        allNodes: [...s.allNodes, newNode],
        tileWorkspaceMap: new Map(s.tileWorkspaceMap).set(sessionId, activeWorkspaceId),
        focusedId: sessionId
      }))
      centerOn(pos.x + 200, pos.y + 200)

      window.note.save(sessionId, {
        noteId: sessionId,
        label,
        workspaceId: activeWorkspaceId,
        isSoftDeleted: false,
        position: pos,
        width: 400,
        height: 400,
        createdAt: Date.now(),
        updatedAt: Date.now()
      })
    },

    addDrawAt: (position, linkedTerminalId) => {
      tileCount++
      const sessionId = uuid()
      const { tileGap, activeWorkspaceId } = get()
      const visible = get().getVisibleNodes()
      const pos = position ?? findOpenPosition(visible, 800, 600, 2, tileGap)
      const label = `Draw ${tileCount}`

      const newNode: Node = {
        id: sessionId,
        type: 'draw',
        position: pos,
        style: { width: 800, height: 600 },
        data: { sessionId, label, linkedTerminalId },
        dragHandle: '.draw-tile-header'
      }

      set((s) => {
        const update: Partial<CanvasStore> & { allNodes: Node[]; tileWorkspaceMap: Map<string, string>; focusedId: string } = {
          allNodes: [...s.allNodes, newNode],
          tileWorkspaceMap: new Map(s.tileWorkspaceMap).set(sessionId, activeWorkspaceId),
          focusedId: sessionId
        }

        if (linkedTerminalId) {
          (update as { allEdges: Edge[] }).allEdges = [
            ...s.allEdges,
            {
              id: `edge-${linkedTerminalId}-${sessionId}`,
              source: linkedTerminalId,
              target: sessionId,
              animated: true,
              style: { stroke: '#ec4899', strokeWidth: 2 }
            }
          ]
        }

        return update
      })

      centerOn(pos.x + 400, pos.y + 300)

      window.draw.save(sessionId, {
        drawId: sessionId,
        label,
        workspaceId: activeWorkspaceId,
        isSoftDeleted: false,
        position: pos,
        width: 800,
        height: 600,
        linkedTerminalId,
        createdAt: Date.now(),
        updatedAt: Date.now()
      })

      return sessionId
    },

    addBrowserForTerminal: (terminalId, url, reservationId, tileWidth, tileHeight) => {
      const isLinked = terminalId && terminalId !== 'api'

      // Reuse existing browser for this terminal
      if (isLinked) {
        const existing = get().allNodes.find(
          (n) => n.type === 'browser' && (n.data as Record<string, unknown>).linkedTerminalId === terminalId
        )
        if (existing) {
          const existingSessionId = sid(existing)
          navigateBrowser(existingSessionId, url)
          set({ focusedId: existingSessionId })
          return
        }
      }

      const terminalNode = findNode(terminalId)

      tileCount++
      const sessionId = uuid()
      const pos = terminalNode
        ? { x: terminalNode.position.x + 740, y: terminalNode.position.y }
        : { x: 100 + (tileCount % 3) * 880, y: 100 + Math.floor(tileCount / 3) * 680 }

      const newNode: Node = {
        id: sessionId,
        type: 'browser',
        position: pos,
        style: { width: tileWidth ?? 800, height: tileHeight ?? 600 },
        data: {
          sessionId,
          label: `Browser ${tileCount}`,
          initialUrl: url,
          linkedTerminalId: isLinked ? terminalId : undefined,
          reservationId
        },
        dragHandle: '.browser-tile-header'
      }

      const terminalWorkspace = isLinked
        ? get().tileWorkspaceMap.get(terminalId)
        : undefined

      set((s) => {
        const edges = terminalNode
          ? [
              ...s.allEdges,
              {
                id: `edge-${terminalId}-${sessionId}`,
                source: terminalId,
                target: sessionId,
                animated: true,
                style: { stroke: '#10b981', strokeWidth: 2 }
              }
            ]
          : s.allEdges

        return {
          allNodes: [...s.allNodes, newNode],
          allEdges: edges,
          tileWorkspaceMap: new Map(s.tileWorkspaceMap).set(
            sessionId,
            terminalWorkspace ?? s.activeWorkspaceId
          ),
          focusedId: sessionId
        }
      })
    },

    addTerminalForTerminal: (info) => {
      const {
        terminalId: sessionId,
        label,
        cwd,
        command,
        linkedTerminalId,
        width = 640,
        height = 400,
        metadata
      } = info

      const { allNodes, tileGap } = get()

      const sourceNode = linkedTerminalId
        ? allNodes.find((n) => sid(n) === linkedTerminalId)
        : undefined

      const existingLinked = linkedTerminalId
        ? allNodes.filter((n) => {
            const meta = (n.data as Record<string, unknown>).metadata as Record<string, unknown> | undefined
            const team = meta?.team as Record<string, unknown> | undefined
            return n.type === 'terminal' && team?.linkedTerminalId === linkedTerminalId
          })
        : []

      const workerIndex = existingLinked.length
      const totalWorkers = workerIndex + 1

      let pos: { x: number; y: number }
      if (sourceNode) {
        const srcW = (sourceNode.style?.width as number) ?? 640
        const srcH = (sourceNode.style?.height as number) ?? 400
        const src = { x: sourceNode.position.x, y: sourceNode.position.y, width: srcW, height: srcH }
        pos = radialPosition(src, workerIndex, totalWorkers)

        // Reposition existing workers for even spacing
        if (totalWorkers > 1) {
          set((s) => ({
            allNodes: s.allNodes.map((n) => {
              const idx = existingLinked.findIndex((e) => e.id === n.id)
              if (idx < 0) return n
              return { ...n, position: radialPosition(src, idx, totalWorkers) }
            })
          }))
        }
      } else {
        const visible = get().getVisibleNodes()
        pos = findOpenPosition(visible, width, height, 4, tileGap)
      }

      tileCount++
      const newNode: Node = {
        id: sessionId,
        type: 'terminal',
        position: pos,
        style: { width, height },
        data: {
          sessionId,
          label: label || `Worker ${tileCount}`,
          cwd: cwd || (sourceNode ? (sourceNode.data as Record<string, unknown>).cwd : undefined),
          metadata: {
            ...(metadata || {}),
            team: { ...((metadata?.team as Record<string, unknown>) || {}), linkedTerminalId }
          },
          command
        },
        dragHandle: '.terminal-tile-header'
      }

      const wsId = linkedTerminalId ? get().tileWorkspaceMap.get(linkedTerminalId) : undefined

      set((s) => {
        const edges = sourceNode && linkedTerminalId
          ? [
              ...s.allEdges,
              {
                id: `team-${linkedTerminalId}-${sessionId}`,
                source: linkedTerminalId,
                target: sessionId,
                animated: true,
                style: { stroke: '#8b5cf6', strokeWidth: 2 }
              }
            ]
          : s.allEdges

        return {
          allNodes: [...s.allNodes, newNode],
          allEdges: edges,
          tileWorkspaceMap: new Map(s.tileWorkspaceMap).set(sessionId, wsId ?? s.activeWorkspaceId),
          focusedId: sessionId
        }
      })
    },

    addNoteForApi: (info) => {
      const {
        noteId: sessionId,
        label,
        linkedTerminalId,
        linkedNoteId,
        position,
        width = 400,
        height = 400
      } = info

      const { allNodes, tileGap } = get()

      // Position: explicit > adjacent to linked terminal/note > findOpenPosition
      let pos: { x: number; y: number }
      if (position) {
        pos = position
      } else if (linkedTerminalId) {
        const sourceNode = allNodes.find((n) => sid(n) === linkedTerminalId)
        if (sourceNode) {
          const srcW = (sourceNode.style?.width as number) ?? 640
          pos = { x: sourceNode.position.x + srcW + tileGap, y: sourceNode.position.y }
        } else {
          pos = findOpenPosition(get().getVisibleNodes(), width, height, 4, tileGap)
        }
      } else if (linkedNoteId) {
        const sourceNode = allNodes.find((n) => sid(n) === linkedNoteId)
        if (sourceNode) {
          const srcW = (sourceNode.style?.width as number) ?? 400
          pos = { x: sourceNode.position.x + srcW + tileGap, y: sourceNode.position.y }
        } else {
          pos = findOpenPosition(get().getVisibleNodes(), width, height, 4, tileGap)
        }
      } else {
        pos = findOpenPosition(get().getVisibleNodes(), width, height, 4, tileGap)
      }

      tileCount++
      const newNode: Node = {
        id: sessionId,
        type: 'notes',
        position: pos,
        style: { width, height },
        data: { sessionId, label: label || `Note ${tileCount}`, linkedTerminalId, linkedNoteId },
        dragHandle: '.notes-tile-header'
      }

      // Inherit workspace from linked terminal/note, or use active
      const wsId = linkedTerminalId
        ? get().tileWorkspaceMap.get(linkedTerminalId)
        : linkedNoteId
          ? get().tileWorkspaceMap.get(linkedNoteId)
          : undefined

      set((s) => {
        const edges = [...s.allEdges]

        if (linkedTerminalId) {
          edges.push({
            id: `note-term-${linkedTerminalId}-${sessionId}`,
            source: linkedTerminalId,
            target: sessionId,
            animated: true,
            style: { stroke: '#22c55e', strokeWidth: 2 }
          })
        } else if (linkedNoteId) {
          edges.push({
            id: `note-note-${linkedNoteId}-${sessionId}`,
            source: linkedNoteId,
            target: sessionId,
            animated: true,
            style: { stroke: '#f59e0b', strokeWidth: 2 }
          })
        }

        return {
          allNodes: [...s.allNodes, newNode],
          allEdges: edges,
          tileWorkspaceMap: new Map(s.tileWorkspaceMap).set(sessionId, wsId ?? s.activeWorkspaceId),
          focusedId: sessionId
        }
      })

      // Update workspace in persisted note file
      const finalWsId = wsId ?? get().activeWorkspaceId
      window.note.save(sessionId, { position: pos, workspaceId: finalWsId })

      centerOn(pos.x + width / 2, pos.y + height / 2)
    },

    focusTile: (sessionId) => {
      set((s) => {
        const deduped = s.recencyList.filter((id) => id !== sessionId)
        const nextRecency = [sessionId, ...deduped].slice(0, RECENCY_CAP)
        saveRecencyList(nextRecency)
        return { focusedId: sessionId, recencyList: nextRecency }
      })
      markTerminalRead(sessionId)
      const node = findNode(sessionId)
      if (!node) return
      const w = defaultTileWidth(node.type)
      const h = defaultTileHeight(node.type)
      const cx = (node.measured?.width ?? (node.style?.width as number) ?? w) / 2
      const cy = (node.measured?.height ?? (node.style?.height as number) ?? h) / 2
      centerOn(node.position.x + cx, node.position.y + cy)
    },

    zoomToFocused: () => {
      const { focusedId, reactFlowInstance, preFocusViewport } = get()
      if (!focusedId || !reactFlowInstance) return

      if (preFocusViewport && preFocusViewport.tileId === focusedId) {
        reactFlowInstance.setViewport(preFocusViewport.viewport, { duration: 300 })
        set({ preFocusViewport: null })
        return
      }

      const node = findNode(focusedId)
      if (!node) return

      const snapshot = reactFlowInstance.getViewport()
      set({ preFocusViewport: { viewport: snapshot, tileId: focusedId } })

      reactFlowInstance.fitView({
        nodes: [{ id: node.id }],
        duration: 300,
        padding: 0.08,
        maxZoom: 1.5
      })
    },

    renameTile: (sessionId, newLabel) => {
      set((s) => ({
        allNodes: s.allNodes.map((n) =>
          sid(n) === sessionId ? { ...n, data: { ...n.data, label: newLabel } } : n
        )
      }))
      const node = findNode(sessionId)
      if (node?.type === 'terminal') {
        window.terminal.rename(sessionId, newLabel)
      } else if (node?.type === 'notes') {
        window.note.save(sessionId, { label: newLabel })
      } else if (node?.type === 'draw') {
        window.draw.save(sessionId, { label: newLabel })
      } else if (node?.type === 'image') {
        window.image.save(sessionId, { label: newLabel })
      }
    },

    // ── Note management ──

    getChildNoteIds: (parentId) => {
      const children: string[] = []
      for (const n of get().allNodes) {
        if (n.type !== 'notes') continue
        const data = n.data as Record<string, unknown>
        if (data.linkedNoteId === parentId) {
          const childId = data.sessionId as string
          children.push(childId, ...get().getChildNoteIds(childId))
        }
      }
      return children
    },

    closeNote: (sessionId) => {
      const { getChildNoteIds, removeTileFromCanvas } = get()
      for (const childId of getChildNoteIds(sessionId)) {
        window.note.save(childId, { isSoftDeleted: true })
        removeTileFromCanvas(childId)
        window.dispatchEvent(new CustomEvent('note:removed', { detail: { noteId: childId } }))
      }
      window.note.save(sessionId, { isSoftDeleted: true })
      removeTileFromCanvas(sessionId)
      window.dispatchEvent(new CustomEvent('note:removed', { detail: { noteId: sessionId } }))
    },

    deleteNote: (sessionId) => {
      const { getChildNoteIds, removeTileFromCanvas } = get()
      for (const childId of getChildNoteIds(sessionId)) {
        window.note.delete(childId)
        removeTileFromCanvas(childId)
        window.dispatchEvent(new CustomEvent('note:removed', { detail: { noteId: childId } }))
      }
      window.note.delete(sessionId)
      removeTileFromCanvas(sessionId)
      window.dispatchEvent(new CustomEvent('note:removed', { detail: { noteId: sessionId } }))
    },

    spawnLinkedNote: (sourceNoteId, taskId, taskText, onCreated) => {
      tileCount++
      const newNoteId = uuid()
      const { allNodes, tileGap, activeWorkspaceId } = get()

      const sourceNode = allNodes.find((n) => sid(n) === sourceNoteId)
      const sourceWidth = sourceNode?.measured?.width ?? (sourceNode?.style?.width as number) ?? 400
      const sourcePos = sourceNode?.position ?? { x: 100, y: 100 }

      const targetPos = { x: sourcePos.x + sourceWidth + tileGap, y: sourcePos.y }
      const pos = snapToGrid(targetPos, allNodes, 400, 400, tileGap)

      const label = taskText.length > 30 ? taskText.slice(0, 30) + '...' : taskText
      const wsId = activeWorkspaceId

      const newNode: Node = {
        id: newNoteId,
        type: 'notes',
        position: pos,
        style: { width: 400, height: 400 },
        data: { sessionId: newNoteId, label, linkedNoteId: sourceNoteId },
        dragHandle: '.notes-tile-header'
      }

      set((s) => ({
        allNodes: [...s.allNodes, newNode],
        allEdges: [
          ...s.allEdges,
          {
            id: `edge-task-${sourceNoteId}-${newNoteId}`,
            source: sourceNoteId,
            target: newNoteId,
            animated: true,
            style: { stroke: '#f59e0b', strokeWidth: 2 }
          }
        ],
        tileWorkspaceMap: new Map(s.tileWorkspaceMap).set(newNoteId, wsId),
        focusedId: newNoteId
      }))

      window.note.save(newNoteId, {
        noteId: newNoteId,
        label,
        workspaceId: wsId,
        isSoftDeleted: false,
        position: pos,
        width: 400,
        height: 400,
        linkedNoteId: sourceNoteId,
        parentTaskInfo: { noteId: sourceNoteId, taskId },
        createdAt: Date.now(),
        updatedAt: Date.now()
      })

      onCreated(newNoteId)
      centerOn(pos.x + 200, pos.y + 200)
    },

    focusNoteOnCanvas: (noteId) => {
      const node = findNode(noteId)
      if (!node) return
      const cx = (node.measured?.width ?? (node.style?.width as number) ?? 400) / 2
      const cy = (node.measured?.height ?? (node.style?.height as number) ?? 400) / 2
      set({ focusedId: noteId })
      centerOn(node.position.x + cx, node.position.y + cy)
    },

    // ── Image management ──

    addImageAt: async (position, sourcePath) => {
      tileCount++
      const sessionId = uuid()
      const { activeWorkspaceId } = get()
      const width = 500
      const height = 400

      // Store the image file and get the stored filename
      const storedFilename = await window.image.store(sourcePath)
      const filename = sourcePath.split('/').pop() || 'Image'
      const label = filename.replace(/\.[^.]+$/, '')

      const newNode: Node = {
        id: sessionId,
        type: 'image',
        position,
        style: { width, height },
        data: { sessionId, label, imagePath: storedFilename },
        dragHandle: '.image-tile-header'
      }

      set((s) => ({
        allNodes: [...s.allNodes, newNode],
        tileWorkspaceMap: new Map(s.tileWorkspaceMap).set(sessionId, activeWorkspaceId),
        focusedId: sessionId
      }))
      centerOn(position.x + width / 2, position.y + height / 2)

      window.image.save(sessionId, {
        imageId: sessionId,
        label,
        workspaceId: activeWorkspaceId,
        isSoftDeleted: false,
        position,
        width,
        height,
        sourcePath,
        storedFilename,
        createdAt: Date.now(),
        updatedAt: Date.now()
      })
    },

    deleteImage: (sessionId) => {
      window.image.delete(sessionId)
      get().removeTileFromCanvas(sessionId)
    },

    // ── Draw management ──

    closeDraw: (sessionId) => {
      window.draw.save(sessionId, { isSoftDeleted: true })
      get().removeTileFromCanvas(sessionId)
    },

    deleteDraw: (sessionId) => {
      window.draw.delete(sessionId)
      get().removeTileFromCanvas(sessionId)
    },

    // ── Diff/DevTools ──

    toggleDiffViewer: (terminalSessionId) => {
      const { allNodes, removeTileFromCanvas, tileGap, tileWorkspaceMap, activeWorkspaceId } = get()

      const existing = allNodes.find(
        (n) => n.type === 'diffViewer' && (n.data as Record<string, unknown>).linkedTerminalId === terminalSessionId
      )
      if (existing) {
        removeTileFromCanvas(sid(existing))
        return
      }

      const terminalNode = findNode(terminalSessionId)
      if (!terminalNode) return

      tileCount++
      const sessionId = uuid()
      const diffW = 700
      const diffH = 500
      const termH = terminalNode.measured?.height ?? (terminalNode.style?.height as number) ?? 400
      const pos = {
        x: terminalNode.position.x,
        y: terminalNode.position.y + termH + (tileGap || 40)
      }

      const newNode: Node = {
        id: sessionId,
        type: 'diffViewer',
        position: pos,
        style: { width: diffW, height: diffH },
        data: {
          sessionId,
          label: 'Diff Viewer',
          linkedTerminalId: terminalSessionId,
          cwd: (terminalNode.data as Record<string, unknown>).cwd || ''
        },
        dragHandle: '.diff-viewer-tile-header'
      }

      set((s) => ({
        allNodes: [...s.allNodes, newNode],
        allEdges: [
          ...s.allEdges,
          {
            id: `diff-edge-${terminalSessionId}-${sessionId}`,
            source: terminalSessionId,
            target: sessionId,
            sourceHandle: 'diff-source',
            targetHandle: 'diff-target',
            animated: true,
            style: { stroke: '#a855f7', strokeWidth: 2, strokeDasharray: '6 3' }
          }
        ],
        tileWorkspaceMap: new Map(s.tileWorkspaceMap).set(
          sessionId,
          tileWorkspaceMap.get(terminalSessionId) ?? activeWorkspaceId
        ),
        focusedId: sessionId
      }))
      centerOn(pos.x + diffW / 2, pos.y + diffH / 2)
    },

    hasDiffViewer: (terminalSessionId) =>
      get().allNodes.some(
        (n) => n.type === 'diffViewer' && (n.data as Record<string, unknown>).linkedTerminalId === terminalSessionId
      ),

    toggleDevTools: (browserSessionId) => {
      const { allNodes, removeTileFromCanvas, tileGap, tileWorkspaceMap, activeWorkspaceId } = get()

      const existing = allNodes.find(
        (n) => n.type === 'devTools' && (n.data as Record<string, unknown>).linkedBrowserId === browserSessionId
      )
      if (existing) {
        removeTileFromCanvas(sid(existing))
        return
      }

      const browserNode = findNode(browserSessionId)
      if (!browserNode) return

      tileCount++
      const sessionId = uuid()
      const dtW = 900
      const dtH = 500
      const browserW = browserNode.measured?.width ?? (browserNode.style?.width as number) ?? 800
      const pos = {
        x: browserNode.position.x + browserW + (tileGap || 40),
        y: browserNode.position.y
      }

      const newNode: Node = {
        id: sessionId,
        type: 'devTools',
        position: pos,
        style: { width: dtW, height: dtH },
        data: { sessionId, label: 'DevTools', linkedBrowserId: browserSessionId },
        dragHandle: '.devtools-tile-header'
      }

      set((s) => ({
        allNodes: [...s.allNodes, newNode],
        allEdges: [
          ...s.allEdges,
          {
            id: `devtools-edge-${browserSessionId}-${sessionId}`,
            source: browserSessionId,
            target: sessionId,
            sourceHandle: 'devtools-source',
            targetHandle: 'devtools-target',
            animated: true,
            style: { stroke: '#f97316', strokeWidth: 2, strokeDasharray: '6 3' }
          }
        ],
        tileWorkspaceMap: new Map(s.tileWorkspaceMap).set(
          sessionId,
          tileWorkspaceMap.get(browserSessionId) ?? activeWorkspaceId
        ),
        focusedId: sessionId
      }))
      centerOn(pos.x + dtW / 2, pos.y + dtH / 2)
    },

    hasDevTools: (browserSessionId) =>
      get().allNodes.some(
        (n) => n.type === 'devTools' && (n.data as Record<string, unknown>).linkedBrowserId === browserSessionId
      ),

    // ── Workspace management ──

    selectWorkspace: (id) => {
      const { activeWorkspaceId, viewportCache, reactFlowInstance } = get()
      if (id === activeWorkspaceId) return

      // Save current viewport
      if (reactFlowInstance) {
        viewportCache.set(activeWorkspaceId, reactFlowInstance.getViewport())
      }

      set({ activeWorkspaceId: id, focusedId: null })

      // Restore target viewport
      const saved = viewportCache.get(id)
      if (saved) {
        requestAnimationFrame(() => {
          reactFlowInstance?.setViewport(saved, { duration: 300 })
        })
      } else {
        requestAnimationFrame(() => {
          reactFlowInstance?.fitView({ duration: 300, padding: 0.2 })
        })
      }
    },

    addWorkspace: async () => {
      const dirPath = await window.workspace.pickDirectory()
      if (!dirPath) return

      const { workspaces, selectWorkspace } = get()
      const existing = workspaces.find((w) => w.path === dirPath)
      if (existing) {
        selectWorkspace(existing.id)
        return
      }

      const name = dirPath.split('/').pop() || dirPath
      const ws: Workspace = {
        id: uuid(),
        name,
        path: dirPath,
        defaultUrl: null,
        isDefault: false,
        createdAt: Date.now()
      }
      set((s) => ({ workspaces: [...s.workspaces, ws] }))
      selectWorkspace(ws.id)
    },

    removeWorkspace: (id) => {
      const { workspaces, activeWorkspaceId, tileWorkspaceMap, allNodes, reactFlowInstance, viewportCache } = get()
      const ws = workspaces.find((w) => w.id === id)
      if (!ws || ws.isDefault) return

      // Kill all tiles in this workspace
      const tilesToKill: string[] = []
      for (const [sessionId, wsId] of tileWorkspaceMap) {
        if (wsId === id) tilesToKill.push(sessionId)
      }

      for (const sessionId of tilesToKill) {
        const node = allNodes.find((n) => sid(n) === sessionId)
        if (node?.type === 'browser') {
          window.browser.destroy(sessionId)
        } else if (node?.type === 'notes') {
          window.note.delete(sessionId)
        } else if (node?.type === 'image') {
          window.image.delete(sessionId)
        } else if (node?.type === 'draw') {
          window.draw.delete(sessionId)
        } else {
          window.terminal.kill(sessionId)
        }
      }

      // Clean up project templates for this workspace
      window.templates.deleteProject(id)

      const killSet = new Set(tilesToKill)
      set((s) => {
        const nextMap = new Map(s.tileWorkspaceMap)
        for (const sid of tilesToKill) nextMap.delete(sid)
        const nextRecency = s.recencyList.filter((rid) => !killSet.has(rid))
        if (nextRecency.length !== s.recencyList.length) saveRecencyList(nextRecency)

        return {
          allNodes: s.allNodes.filter((n) => !killSet.has(sid(n))),
          allEdges: s.allEdges.filter((e) => !killSet.has(e.source) && !killSet.has(e.target)),
          tileWorkspaceMap: nextMap,
          workspaces: s.workspaces.filter((w) => w.id !== id),
          recencyList: nextRecency,
          ...(activeWorkspaceId === id
            ? { activeWorkspaceId: 'default', focusedId: null }
            : {})
        }
      })

      viewportCache.delete(id)

      if (activeWorkspaceId === id) {
        requestAnimationFrame(() => {
          reactFlowInstance?.fitView({ duration: 300, padding: 0.2 })
        })
      }
    },

    renameWorkspace: (id, name) => {
      set((s) => ({
        workspaces: s.workspaces.map((w) =>
          w.id === id && !w.isDefault ? { ...w, name } : w
        )
      }))
    },

    setWorkspacePath: async (id) => {
      const dirPath = await window.workspace.pickDirectory()
      if (!dirPath) return
      set((s) => ({
        workspaces: s.workspaces.map((w) => (w.id === id ? { ...w, path: dirPath } : w))
      }))
    },

    setWorkspaceDefaultUrl: (id, url) => {
      set((s) => ({
        workspaces: s.workspaces.map((w) => (w.id === id ? { ...w, defaultUrl: url } : w))
      }))
    },

    focusProcess: (workspaceId, sessionId) => {
      markTerminalRead(sessionId)
      const { activeWorkspaceId, reactFlowInstance, viewportCache, focusTile } = get()

      if (workspaceId !== activeWorkspaceId) {
        if (reactFlowInstance) {
          viewportCache.set(activeWorkspaceId, reactFlowInstance.getViewport())
        }
        set({ activeWorkspaceId: workspaceId })
        requestAnimationFrame(() => {
          set({ focusedId: sessionId })
          const node = findNode(sessionId)
          if (!node) return
          const dw = defaultTileWidth(node.type)
          const dh = defaultTileHeight(node.type)
          const cx = (node.measured?.width ?? (node.style?.width as number) ?? dw) / 2
          const cy = (node.measured?.height ?? (node.style?.height as number) ?? dh) / 2
          centerOn(node.position.x + cx, node.position.y + cy)
        })
      } else {
        focusTile(sessionId)
      }
    },

    // ── Template ──

    spawnTemplate: (template, origin) => {
      const { tileGap } = get()
      const visible = get().getVisibleNodes()

      let maxW = 0
      let maxH = 0
      for (const t of template.tiles) {
        maxW = Math.max(maxW, t.relativePosition.x + t.width)
        maxH = Math.max(maxH, t.relativePosition.y + t.height)
      }
      const basePos = origin ?? findOpenPosition(visible, maxW, maxH, 2, tileGap)

      const { addTerminalAt, addBrowserAt, addNoteAt, addDrawAt } = get()
      for (const tile of template.tiles) {
        const pos = {
          x: basePos.x + tile.relativePosition.x,
          y: basePos.y + tile.relativePosition.y
        }
        if (tile.type === 'terminal') addTerminalAt(pos, tile.width, tile.height, tile.command, tile.label, tile.cwd)
        else if (tile.type === 'browser') addBrowserAt(pos)
        else if (tile.type === 'notes') addNoteAt(pos)
        else if (tile.type === 'draw') addDrawAt(pos)
      }
    },

    spawnTemplateInWorkspace: (template, workspaceId, origin) => {
      const { activeWorkspaceId, selectWorkspace, spawnTemplate, focusedId } = get()
      const run = () => {
        const before = new Set(get().allNodes.map((n) => (n.data as Record<string, unknown>).sessionId as string))
        spawnTemplate(template, origin)
        // Focus the first newly-spawned tile
        const after = get().allNodes
        const firstNew = after.find((n) => !before.has((n.data as Record<string, unknown>).sessionId as string))
        if (firstNew) {
          const newId = (firstNew.data as Record<string, unknown>).sessionId as string
          if (newId !== focusedId) get().focusTile(newId)
        }
      }
      if (workspaceId !== activeWorkspaceId) {
        selectWorkspace(workspaceId)
        requestAnimationFrame(run)
      } else {
        run()
      }
    },

    // ── Palette ──

    openPalette: () => set({ paletteOpen: true }),
    closePalette: () => set({ paletteOpen: false }),
    togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen })),

    registerTerminalRef: (id, ref) => {
      set((s) => {
        const next = new Map(s.terminalRefs)
        next.set(id, ref)
        return { terminalRefs: next }
      })
    },

    unregisterTerminalRef: (id) => {
      set((s) => {
        if (!s.terminalRefs.has(id)) return {}
        const next = new Map(s.terminalRefs)
        next.delete(id)
        return { terminalRefs: next }
      })
    },

    jumpToScrollbackMatch: (terminalId, lineNo) => {
      const { tileWorkspaceMap, activeWorkspaceId, selectWorkspace, focusTile, zoomToFocused } = get()
      const targetWs = tileWorkspaceMap.get(terminalId)
      if (!targetWs) return

      const applyScroll = () => {
        const refs = get().terminalRefs
        const ref = refs.get(terminalId)
        ref?.scrollToLine(lineNo)
        ref?.highlightLine(lineNo)
      }

      const doJump = () => {
        requestAnimationFrame(() => {
          focusTile(terminalId)
          zoomToFocused()
          requestAnimationFrame(applyScroll)
        })
      }

      if (targetWs !== activeWorkspaceId) {
        selectWorkspace(targetWs)
        // Allow the workspace-switch rAF + viewport restore to run first
        requestAnimationFrame(doJump)
      } else {
        doJump()
      }
    }
  }
})
