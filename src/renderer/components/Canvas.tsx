import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  useReactFlow,
  useStore,
  applyNodeChanges,
  applyEdgeChanges,
  type Node,
  type Edge,
  type NodeTypes,
  type NodeChange,
  type EdgeChange,
  type OnConnect,
  type Viewport,
  addEdge
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { v4 as uuid } from 'uuid'
import { TerminalTile } from './TerminalTile'
import { BrowserTile } from './BrowserTile'
import { NotesTile } from './NotesTile'
import { DiffViewerTile } from './DiffViewerTile'
import { DevToolsTile } from './DevToolsTile'
import { DrawTile } from './draw/DrawTile'
import { parseMermaid } from '@/lib/mermaid-parser'
import { layoutMermaidGraph } from '@/lib/mermaid-layout'
import { ProcessPanel } from './ProcessPanel'
import { WorkspacePanel } from './WorkspacePanel'
import { OffscreenIndicators } from './OffscreenIndicators'
import { CanvasBackground } from './CanvasBackground'
import { FocusedTerminalContext } from '@/hooks/useFocusedTerminal'
import { PanDetector } from './PanDetector'
import { navigateBrowser, reloadBrowser } from '@/hooks/useBrowserNavigation'
import { usePerformanceDebug, registerRender } from '@/hooks/usePerformanceDebug'
import { PerformanceOverlay } from './PerformanceOverlay'
import { PomodoroWidget } from './PomodoroWidget'
import { usePomodoro, PomodoroContext } from '@/hooks/usePomodoro'
import { BROWSER_CHROME_HEIGHT, BROWSER_CHROME_WIDTH, type DevicePreset } from '@/constants/devicePresets'
import { DEFAULT_WORKSPACE, type Workspace } from '@/types/workspace'
import { useSettings, type WorkspaceTemplate } from '@/hooks/useSettings'
import { useHotkeys } from '@/hooks/useHotkeys'
import type { HotkeyAction } from '@/types/settings'
import { SettingsPage } from './SettingsPage'

const nodeTypes: NodeTypes = {
  terminal: TerminalTile as unknown as NodeTypes['terminal'],
  browser: BrowserTile as unknown as NodeTypes['browser'],
  notes: NotesTile as unknown as NodeTypes['notes'],
  diffViewer: DiffViewerTile as unknown as NodeTypes['diffViewer'],
  devTools: DevToolsTile as unknown as NodeTypes['devTools'],
  draw: DrawTile as unknown as NodeTypes['draw']
}

const MINIMAP_NODE_COLORS: Record<string, string> = {
  terminal: '#22c55e',
  browser:  '#3b82f6',
  notes:    '#f59e0b',
  diffViewer: '#a855f7',
  devTools:   '#f97316',
  draw:       '#ec4899',
}

function minimapNodeColor(node: Node): string {
  return MINIMAP_NODE_COLORS[node.type ?? ''] ?? '#71717a'
}

function CanvasMiniMap({ position, panelOpen, workspacePanelOpen }: {
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
  panelOpen: boolean
  workspacePanelOpen: boolean
}) {
  const edges = useStore((s) => s.edges)
  const nodeLookup = useStore((s) => s.nodeLookup)

  // Inject edge lines into the minimap SVG so they share the same viewBox
  useEffect(() => {
    const svg = document.querySelector<SVGSVGElement>('.react-flow__minimap-svg')
    if (!svg) return

    // Get or create edge group, insert before the mask path
    let edgeGroup = svg.querySelector('.minimap-edges') as SVGGElement | null
    if (!edgeGroup) {
      edgeGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g')
      edgeGroup.setAttribute('class', 'minimap-edges')
      const mask = svg.querySelector('.react-flow__minimap-mask')
      if (mask) svg.insertBefore(edgeGroup, mask)
      else svg.appendChild(edgeGroup)
    }

    // Clear previous lines
    edgeGroup.innerHTML = ''

    // Draw edges
    for (const e of edges) {
      const source = nodeLookup.get(e.source)
      const target = nodeLookup.get(e.target)
      if (!source || !target) continue
      const sx = source.internals.positionAbsolute.x + (source.measured?.width ?? 0) / 2
      const sy = source.internals.positionAbsolute.y + (source.measured?.height ?? 0) / 2
      const tx = target.internals.positionAbsolute.x + (target.measured?.width ?? 0) / 2
      const ty = target.internals.positionAbsolute.y + (target.measured?.height ?? 0) / 2
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
      line.setAttribute('x1', String(sx))
      line.setAttribute('y1', String(sy))
      line.setAttribute('x2', String(tx))
      line.setAttribute('y2', String(ty))
      line.setAttribute('stroke', '#a1a1aa')
      line.setAttribute('stroke-width', '8')
      line.setAttribute('stroke-dasharray', '12 6')
      line.setAttribute('opacity', '0.8')
      edgeGroup.appendChild(line)
    }
  }, [edges, nodeLookup])

  return (
    <MiniMap
      position={position}
      nodeColor={minimapNodeColor}
      nodeStrokeColor="transparent"
      maskColor="rgba(0, 0, 0, 0.7)"
      pannable
      zoomable
      style={{
        backgroundColor: '#18181b',
        borderRadius: 8,
        border: '1px solid #27272a',
        zIndex: 20,
        transition: 'margin 0.2s ease',
        ...(position.includes('bottom') ? { marginBottom: position === 'bottom-left' ? 95 : 4 } : {}),
        ...(position.includes('top') ? { marginTop: 4 } : {}),
        ...(position.includes('right') && panelOpen ? { marginRight: 256 + 15 } : {}),
        ...(position.includes('left') && workspacePanelOpen ? { marginLeft: 240 + 15 } : {}),
      }}
    />
  )
}

function defaultTileWidth(type: string | undefined): number {
  return type === 'browser' ? 800 : type === 'notes' ? 400 : type === 'diffViewer' ? 700 : type === 'devTools' ? 900 : type === 'draw' ? 800 : 640
}

function defaultTileHeight(type: string | undefined): number {
  return type === 'browser' ? 600 : type === 'notes' ? 400 : type === 'diffViewer' ? 500 : type === 'devTools' ? 500 : type === 'draw' ? 600 : 400
}

let tileCount = 0

/** Find a position that doesn't overlap any existing node. */
function findOpenPosition(
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
  // Fallback: offset from last node
  return { x: 100, y: 100 + existingNodes.length * stepY }
}

/** Find the nearest open grid cell to a click position. */
function snapToGrid(
  click: { x: number; y: number },
  existingNodes: Node[],
  width: number,
  height: number,
  gap: number
): { x: number; y: number } {
  const stepX = width + gap
  const stepY = height + gap

  // Determine search center in grid coords
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

  // Search grid cells in a square around the click, pick closest open one
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

// ── Jump hints overlay (Ctrl-hold to show, press letter to jump) ──

// 1-9, 0, then A-Z
const JUMP_KEYS = '1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ'

export default function Canvas() {
  registerRender('Canvas')
  const { enabled: perfEnabled, stats: perfStats } = usePerformanceDebug()
  const { settings, updateSettings } = useSettings()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const pomodoro = usePomodoro()
  const [pomodoroExpanded, setPomodoroExpanded] = useState(false)
  const togglePomodoro = useCallback(() => setPomodoroExpanded((o) => !o), [])

  // ── All nodes/edges (across all workspaces) ──
  const [allNodes, setAllNodes] = useState<Node[]>([])
  const [allEdges, setAllEdges] = useState<Edge[]>([])
  const [nodesLoadedFlags, setNodesLoadedFlags] = useState({ notes: false, terminals: false, browsers: false, draws: false })

  // ── Workspace state ──
  const [workspaces, setWorkspaces] = useState<Workspace[]>([DEFAULT_WORKSPACE])
  const [activeWorkspaceId, setActiveWorkspaceId] = useState('default')
  const [tileWorkspaceMap, setTileWorkspaceMap] = useState<Map<string, string>>(new Map())
  const [workspacePanelOpen, setWorkspacePanelOpen] = useState(true)
  const viewportCache = useRef<Map<string, Viewport>>(new Map())

  const [panelOpen, setPanelOpen] = useState(true)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const { setCenter, getViewport, setViewport, fitView, screenToFlowPosition } = useReactFlow()

  const allNodesRef = useRef(allNodes)
  allNodesRef.current = allNodes

  const allEdgesRef = useRef(allEdges)
  allEdgesRef.current = allEdges

  const tileWorkspaceMapRef = useRef(tileWorkspaceMap)
  tileWorkspaceMapRef.current = tileWorkspaceMap

  const activeWorkspaceIdRef = useRef(activeWorkspaceId)
  activeWorkspaceIdRef.current = activeWorkspaceId

  // ── Note close/delete (must be defined before visibleNodes) ──

  const removeTileFromCanvas = useCallback((sessionId: string) => {
    setAllNodes((nds) =>
      nds.filter((n) => (n.data as Record<string, unknown>).sessionId !== sessionId)
    )
    setAllEdges((eds) =>
      eds.filter((e) => e.source !== sessionId && e.target !== sessionId)
    )
    setTileWorkspaceMap((prev) => {
      const next = new Map(prev)
      next.delete(sessionId)
      return next
    })
    setFocusedId((prev) => (prev === sessionId ? null : prev))
  }, [])

  const closeDraw = useCallback(
    (sessionId: string) => {
      window.draw.save(sessionId, { isSoftDeleted: true })
      removeTileFromCanvas(sessionId)
    },
    [removeTileFromCanvas]
  )

  const deleteDraw = useCallback(
    (sessionId: string) => {
      window.draw.delete(sessionId)
      removeTileFromCanvas(sessionId)
    },
    [removeTileFromCanvas]
  )

  /** Collect all descendant note IDs linked to a parent (recursively). */
  const getChildNoteIds = useCallback((parentId: string): string[] => {
    const children: string[] = []
    for (const n of allNodesRef.current) {
      if (n.type !== 'notes') continue
      const data = n.data as Record<string, unknown>
      if (data.linkedNoteId === parentId) {
        const childId = data.sessionId as string
        children.push(childId, ...getChildNoteIds(childId))
      }
    }
    return children
  }, [])

  const closeNote = useCallback(
    (sessionId: string) => {
      // Cascade: soft-close all child notes first
      for (const childId of getChildNoteIds(sessionId)) {
        window.note.save(childId, { isSoftDeleted: true })
        removeTileFromCanvas(childId)
        window.dispatchEvent(new CustomEvent('note:removed', { detail: { noteId: childId } }))
      }
      // Soft close: mark as soft-deleted in file, remove from canvas
      window.note.save(sessionId, { isSoftDeleted: true })
      removeTileFromCanvas(sessionId)
      window.dispatchEvent(new CustomEvent('note:removed', { detail: { noteId: sessionId } }))
    },
    [removeTileFromCanvas, getChildNoteIds]
  )

  const deleteNote = useCallback(
    (sessionId: string) => {
      // Cascade: hard-delete all child notes first
      for (const childId of getChildNoteIds(sessionId)) {
        window.note.delete(childId)
        removeTileFromCanvas(childId)
        window.dispatchEvent(new CustomEvent('note:removed', { detail: { noteId: childId } }))
      }
      // Hard delete: remove from canvas AND delete file
      window.note.delete(sessionId)
      removeTileFromCanvas(sessionId)
      window.dispatchEvent(new CustomEvent('note:removed', { detail: { noteId: sessionId } }))
    },
    [removeTileFromCanvas, getChildNoteIds]
  )

  // ── Linked note spawning from checklist items ──

  const spawnLinkedNote = useCallback(
    (sourceNoteId: string, taskId: string, taskText: string, onCreated: (newNoteId: string) => void) => {
      tileCount++
      const newNoteId = uuid()

      // Find source node to position relative to it
      const sourceNode = allNodesRef.current.find(
        (n) => (n.data as Record<string, unknown>).sessionId === sourceNoteId
      )
      const sourceWidth = (sourceNode?.measured?.width ?? (sourceNode?.style?.width as number) ?? 400)
      const sourcePos = sourceNode?.position ?? { x: 100, y: 100 }

      const targetPos = {
        x: sourcePos.x + sourceWidth + settings.canvas.tileGap,
        y: sourcePos.y
      }
      const pos = snapToGrid(targetPos, allNodesRef.current, 400, 400, settings.canvas.tileGap)

      const label = taskText.length > 30 ? taskText.slice(0, 30) + '...' : taskText
      const wsId = activeWorkspaceIdRef.current

      const newNode: Node = {
        id: newNoteId,
        type: 'notes',
        position: pos,
        style: { width: 400, height: 400 },
        data: {
          sessionId: newNoteId,
          label,
          linkedNoteId: sourceNoteId,
          onClose: closeNote,
          onDelete: deleteNote
        },
        dragHandle: '.notes-tile-header'
      }
      setAllNodes((nds) => [...nds, newNode])
      setTileWorkspaceMap((prev) => new Map(prev).set(newNoteId, wsId))

      // Create amber edge from source checklist → new note
      const edgeId = `edge-task-${sourceNoteId}-${newNoteId}`
      setAllEdges((eds) => [
        ...eds,
        {
          id: edgeId,
          source: sourceNoteId,
          target: newNoteId,
          animated: true,
          style: { stroke: '#f59e0b', strokeWidth: 2 }
        }
      ])

      // Persist note metadata
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

      // Let the caller set the linkedNoteId attribute on the task item
      onCreated(newNoteId)

      setFocusedId(newNoteId)
      setCenter(pos.x + 200, pos.y + 200, { zoom: 1, duration: 400 })
    },
    [settings.canvas.tileGap, setCenter, closeNote, deleteNote]
  )

  const focusNoteOnCanvas = useCallback(
    (noteId: string) => {
      const node = allNodesRef.current.find(
        (n) => (n.data as Record<string, unknown>).sessionId === noteId
      )
      if (!node) return
      const cx = ((node.measured?.width ?? (node.style?.width as number) ?? 400) / 2)
      const cy = ((node.measured?.height ?? (node.style?.height as number) ?? 400) / 2)
      setFocusedId(noteId)
      setCenter(node.position.x + cx, node.position.y + cy, { zoom: 1, duration: 400 })
    },
    [setCenter]
  )

  // ── Compute visible nodes/edges for active workspace ──
  // Browser nodes from ALL workspaces stay mounted so their webview + CDP connection
  // persists across workspace switches (agents can keep controlling them).
  // When a DevTools tile is focused, flag its linked browser so pointer events stay enabled.
  const focusedDevToolsLinkedBrowser = useMemo(() => {
    if (!focusedId) return null
    const focusedNode = allNodes.find(
      (n) => n.type === 'devTools' && (n.data as Record<string, unknown>).sessionId === focusedId
    )
    return focusedNode ? (focusedNode.data as Record<string, unknown>).linkedBrowserId as string : null
  }, [focusedId, allNodes])

  const visibleNodes = useMemo(
    () =>
      allNodes
        .filter((n) => {
          const sid = (n.data as Record<string, unknown>).sessionId as string
          const inActiveWorkspace = tileWorkspaceMap.get(sid) === activeWorkspaceId
          return inActiveWorkspace || n.type === 'browser'
        })
        .map((n) => {
          const sid = (n.data as Record<string, unknown>).sessionId as string
          const inActiveWorkspace = tileWorkspaceMap.get(sid) === activeWorkspaceId
          if (!inActiveWorkspace && n.type === 'browser') {
            return {
              ...n,
              selectable: false,
              draggable: false,
              focusable: false,
              data: { ...n.data, isBackground: true }
            }
          }
          // Keep browser webview interactive when its DevTools tile is focused (for inspector)
          if (n.type === 'browser' && focusedDevToolsLinkedBrowser === sid) {
            return {
              ...n,
              data: { ...n.data, devToolsIsFocused: true }
            }
          }
          // Inject close/delete/spawn callbacks into notes data
          if (n.type === 'notes') {
            return {
              ...n,
              data: {
                ...n.data,
                onClose: closeNote,
                onDelete: deleteNote,
                onSpawnLinkedNote: spawnLinkedNote,
                onNavigateToNote: focusNoteOnCanvas
              }
            }
          }
          // Inject close/delete callbacks into draw data
          if (n.type === 'draw') {
            return {
              ...n,
              data: { ...n.data, onClose: closeDraw, onDelete: deleteDraw }
            }
          }
          // Inject close callback into diff viewer data
          if (n.type === 'diffViewer') {
            return {
              ...n,
              data: { ...n.data, onClose: (sid: string) => removeTileFromCanvas(sid) }
            }
          }
          // Inject close callback into devtools data
          if (n.type === 'devTools') {
            return {
              ...n,
              data: { ...n.data, onClose: (sid: string) => removeTileFromCanvas(sid) }
            }
          }
          return n
        }),
    [allNodes, tileWorkspaceMap, activeWorkspaceId, closeNote, deleteNote, closeDraw, deleteDraw, removeTileFromCanvas, focusedDevToolsLinkedBrowser, spawnLinkedNote, focusNoteOnCanvas]
  )

  const visibleNodeIds = useMemo(
    () => new Set(visibleNodes.map((n) => n.id)),
    [visibleNodes]
  )

  const visibleEdges = useMemo(
    () => allEdges.filter((e) => visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target)),
    [allEdges, visibleNodeIds]
  )

  // ── ReactFlow change handlers (operate on full arrays) ──
  const notesSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setAllNodes((nds) => {
        const updated = applyNodeChanges(changes, nds)

        // Debounced save of note position/size when dragged or resized
        const hasPositionOrDimension = changes.some(
          (c) => c.type === 'position' || c.type === 'dimensions'
        )
        if (hasPositionOrDimension) {
          if (notesSaveTimerRef.current) clearTimeout(notesSaveTimerRef.current)
          notesSaveTimerRef.current = setTimeout(() => {
            notesSaveTimerRef.current = null
            for (const n of updated) {
              if (n.type === 'notes') {
                const sid = (n.data as Record<string, unknown>).sessionId as string
                const w = (n.style?.width as number) ?? 400
                const h = (n.style?.height as number) ?? 400
                window.note.save(sid, {
                  position: n.position,
                  width: n.measured?.width ?? w,
                  height: n.measured?.height ?? h
                })
              } else if (n.type === 'draw') {
                const sid = (n.data as Record<string, unknown>).sessionId as string
                const w = (n.style?.width as number) ?? 800
                const h = (n.style?.height as number) ?? 600
                window.draw.save(sid, {
                  position: n.position,
                  width: n.measured?.width ?? w,
                  height: n.measured?.height ?? h
                })
              }
            }
          }, 500)
        }

        return updated
      })
    },
    []
  )

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setAllEdges((eds) => applyEdgeChanges(changes, eds))
    },
    []
  )

  const onConnect: OnConnect = useCallback(
    (params) => {
      // Block manual connections to/from diff handles
      if (params.sourceHandle === 'diff-source' || params.targetHandle === 'diff-target') return

      setAllEdges((eds) => addEdge(params, eds))

      const sourceNode = allNodesRef.current.find((n) => n.id === params.source)
      const targetNode = allNodesRef.current.find((n) => n.id === params.target)

      // Helper: persist linkedTerminalId on a note and sync its workspace
      const linkNoteToTerminal = (noteId: string, terminalId: string) => {
        const terminalWs = tileWorkspaceMapRef.current.get(terminalId)
        if (terminalWs) {
          setTileWorkspaceMap((prev) => new Map(prev).set(noteId, terminalWs))
          window.note.save(noteId, { workspaceId: terminalWs, linkedTerminalId: terminalId })
        } else {
          window.note.save(noteId, { linkedTerminalId: terminalId })
        }
        // Update node data so grouping picks it up immediately
        setAllNodes((nds) =>
          nds.map((n) =>
            n.id === noteId
              ? { ...n, data: { ...n.data, linkedTerminalId: terminalId } }
              : n
          )
        )
      }

      // terminal -> notes
      if (sourceNode?.type === 'terminal' && targetNode?.type === 'notes') {
        linkNoteToTerminal(params.target!, params.source!)
      }
      // notes -> terminal
      else if (sourceNode?.type === 'notes' && targetNode?.type === 'terminal') {
        linkNoteToTerminal(params.source!, params.target!)
      }
      // notes -> notes: propagate terminal link, or create standalone note group
      else if (sourceNode?.type === 'notes' && targetNode?.type === 'notes') {
        const sourceLinkedTerminal = (sourceNode.data as Record<string, unknown>).linkedTerminalId as string | undefined
        const targetLinkedTerminal = (targetNode.data as Record<string, unknown>).linkedTerminalId as string | undefined
        if (sourceLinkedTerminal && !targetLinkedTerminal) {
          linkNoteToTerminal(params.target!, sourceLinkedTerminal)
        } else if (targetLinkedTerminal && !sourceLinkedTerminal) {
          linkNoteToTerminal(params.source!, targetLinkedTerminal)
        } else if (!sourceLinkedTerminal && !targetLinkedTerminal) {
          // Standalone note group — source is the parent, target becomes child
          // If the source already has a linkedNoteId, propagate that root instead
          const sourceLinkedNote = (sourceNode.data as Record<string, unknown>).linkedNoteId as string | undefined
          const parentNoteId = sourceLinkedNote || params.source!
          window.note.save(params.target!, { linkedNoteId: parentNoteId })
          setAllNodes((nds) =>
            nds.map((n) =>
              n.id === params.target
                ? { ...n, data: { ...n.data, linkedNoteId: parentNoteId } }
                : n
            )
          )
        }
      }
      // terminal -> browser or browser -> terminal: persist linkedTerminalId on browser node data
      else if (sourceNode?.type === 'terminal' && targetNode?.type === 'browser') {
        setAllNodes((nds) =>
          nds.map((n) =>
            n.id === params.target
              ? { ...n, data: { ...n.data, linkedTerminalId: params.source } }
              : n
          )
        )
      } else if (sourceNode?.type === 'browser' && targetNode?.type === 'terminal') {
        setAllNodes((nds) =>
          nds.map((n) =>
            n.id === params.source
              ? { ...n, data: { ...n.data, linkedTerminalId: params.target } }
              : n
          )
        )
      }
    },
    []
  )

  // ── Load workspaces on mount ──
  useEffect(() => {
    window.workspace.load().then((data) => {
      if (data) {
        setWorkspaces(data.workspaces)
        setActiveWorkspaceId(data.activeWorkspaceId)
      }
      // Enable the save effect only after the load has populated state,
      // preventing StrictMode double-invoke from saving defaults to disk
      workspacesLoaded.current = true
    })
  }, [])

  // ── Load persisted notes on mount ──
  useEffect(() => {
    window.note.list().then((noteFiles) => {
      const notesToRestore = noteFiles.filter((nf) => !nf.meta.isSoftDeleted)
      if (notesToRestore.length === 0) return

      setAllNodes((nds) => {
        // Avoid duplicates if this effect re-runs (HMR / StrictMode)
        const existingIds = new Set(nds.map((n) => n.id))
        const newNodes: Node[] = []
        const wsMapEntries: [string, string][] = []

        for (const nf of notesToRestore) {
          const { noteId, label, workspaceId, position, width, height } = nf.meta
          if (existingIds.has(noteId)) continue
          tileCount++
          newNodes.push({
            id: noteId,
            type: 'notes',
            position,
            style: { width, height },
            data: {
              sessionId: noteId,
              label,
              linkedTerminalId: nf.meta.linkedTerminalId,
              linkedNoteId: nf.meta.linkedNoteId
            },
            dragHandle: '.notes-tile-header'
          })
          wsMapEntries.push([noteId, workspaceId])
        }

        if (newNodes.length > 0) {
          setTileWorkspaceMap((prev) => {
            const next = new Map(prev)
            for (const [sid, wsId] of wsMapEntries) next.set(sid, wsId)
            return next
          })
        }

        return [...nds, ...newNodes]
      })

      // Reconstruct edges from persisted note metadata
      const edgesToRestore: Edge[] = []
      const edgeIds = new Set<string>()
      for (const nf of notesToRestore) {
        const { noteId, linkedTerminalId, linkedNoteId } = nf.meta
        if (linkedTerminalId) {
          const edgeId = `edge-${linkedTerminalId}-${noteId}`
          if (!edgeIds.has(edgeId)) {
            edgesToRestore.push({
              id: edgeId,
              source: linkedTerminalId,
              target: noteId,
              animated: true,
              style: { stroke: '#22c55e', strokeWidth: 2 }
            })
            edgeIds.add(edgeId)
          }
        }
        if (linkedNoteId) {
          const edgeId = `edge-${linkedNoteId}-${noteId}`
          if (!edgeIds.has(edgeId)) {
            edgesToRestore.push({
              id: edgeId,
              source: linkedNoteId,
              target: noteId,
              animated: true,
              style: { stroke: '#f59e0b', strokeWidth: 2 }
            })
            edgeIds.add(edgeId)
          }
        }
      }
      if (edgesToRestore.length > 0) {
        setAllEdges((eds) => {
          const existing = new Set(eds.map((e) => e.id))
          const newEdges = edgesToRestore.filter((e) => !existing.has(e.id))
          return newEdges.length > 0 ? [...eds, ...newEdges] : eds
        })
      }
      setNodesLoadedFlags((prev) => ({ ...prev, notes: true }))
    })
  }, [])

  // ── Load persisted terminal tiles on mount ──
  useEffect(() => {
    window.terminalTiles.load().then((persisted) => {
      if (!persisted || persisted.length === 0) return

      setAllNodes((nds) => {
        const existingIds = new Set(nds.map((n) => n.id))
        const newNodes: Node[] = []
        const wsMapEntries: [string, string][] = []

        for (const pt of persisted) {
          if (existingIds.has(pt.sessionId)) continue
          tileCount++
          newNodes.push({
            id: pt.sessionId,
            type: 'terminal',
            position: pt.position,
            style: { width: pt.width, height: pt.height },
            data: {
              sessionId: pt.sessionId,
              label: pt.label,
              cwd: pt.cwd,
              metadata: pt.metadata
            },
            dragHandle: '.terminal-tile-header'
          })
          wsMapEntries.push([pt.sessionId, pt.workspaceId])
        }

        if (newNodes.length > 0) {
          setTileWorkspaceMap((prev) => {
            const next = new Map(prev)
            for (const [sid, wsId] of wsMapEntries) next.set(sid, wsId)
            return next
          })
        }

        return newNodes.length > 0 ? [...nds, ...newNodes] : nds
      })

      // Reconstruct note→terminal edges now that terminal nodes exist
      window.note.list().then((noteFiles) => {
        const edgesToRestore: Edge[] = []
        const edgeIds = new Set<string>()
        for (const nf of noteFiles.filter((n) => !n.meta.isSoftDeleted)) {
          if (nf.meta.linkedTerminalId) {
            const edgeId = `edge-${nf.meta.linkedTerminalId}-${nf.meta.noteId}`
            if (!edgeIds.has(edgeId)) {
              edgesToRestore.push({
                id: edgeId,
                source: nf.meta.linkedTerminalId,
                target: nf.meta.noteId,
                animated: true,
                style: { stroke: '#22c55e', strokeWidth: 2 }
              })
              edgeIds.add(edgeId)
            }
          }
        }
        if (edgesToRestore.length > 0) {
          setAllEdges((eds) => {
            const existing = new Set(eds.map((e) => e.id))
            const newEdges = edgesToRestore.filter((e) => !existing.has(e.id))
            return newEdges.length > 0 ? [...eds, ...newEdges] : eds
          })
        }
      })
      setNodesLoadedFlags((prev) => ({ ...prev, terminals: true }))
    })
  }, [])

  // ── Load persisted browser tiles on mount ──
  useEffect(() => {
    window.browserTiles.load().then((persisted) => {
      if (!persisted || persisted.length === 0) {
        setNodesLoadedFlags((prev) => ({ ...prev, browsers: true }))
        return
      }

      setAllNodes((nds) => {
        const existingIds = new Set(nds.map((n) => n.id))
        const newNodes: Node[] = []
        const wsMapEntries: [string, string][] = []

        for (const pb of persisted) {
          if (existingIds.has(pb.sessionId)) continue
          tileCount++
          newNodes.push({
            id: pb.sessionId,
            type: 'browser',
            position: pb.position,
            style: { width: pb.width, height: pb.height },
            data: {
              sessionId: pb.sessionId,
              label: pb.label,
              initialUrl: pb.url,
              linkedTerminalId: pb.linkedTerminalId,
              initialPreset: pb.initialPreset
            },
            dragHandle: '.browser-tile-header'
          })
          wsMapEntries.push([pb.sessionId, pb.workspaceId])
        }

        if (newNodes.length > 0) {
          setTileWorkspaceMap((prev) => {
            const next = new Map(prev)
            for (const [sid, wsId] of wsMapEntries) next.set(sid, wsId)
            return next
          })
        }

        return newNodes.length > 0 ? [...nds, ...newNodes] : nds
      })

      setNodesLoadedFlags((prev) => ({ ...prev, browsers: true }))
    })
  }, [])

  // ── Load persisted draw tiles on mount ──
  useEffect(() => {
    window.draw.list().then((drawFiles) => {
      const drawsToRestore = drawFiles.filter((df) => !df.meta.isSoftDeleted)
      if (drawsToRestore.length === 0) {
        setNodesLoadedFlags((prev) => ({ ...prev, draws: true }))
        return
      }

      setAllNodes((nds) => {
        const existingIds = new Set(nds.map((n) => n.id))
        const newNodes: Node[] = []
        const wsMapEntries: [string, string][] = []

        for (const df of drawsToRestore) {
          const { drawId, label, workspaceId, position, width, height } = df.meta
          if (existingIds.has(drawId)) continue
          tileCount++
          newNodes.push({
            id: drawId,
            type: 'draw',
            position,
            style: { width, height },
            data: {
              sessionId: drawId,
              label,
              linkedTerminalId: df.meta.linkedTerminalId
            },
            dragHandle: '.draw-tile-header'
          })
          wsMapEntries.push([drawId, workspaceId])
        }

        if (newNodes.length > 0) {
          setTileWorkspaceMap((prev) => {
            const next = new Map(prev)
            for (const [sid, wsId] of wsMapEntries) next.set(sid, wsId)
            return next
          })
        }

        return newNodes.length > 0 ? [...nds, ...newNodes] : nds
      })

      // Reconstruct edges from draw metadata
      const edgesToRestore: Edge[] = []
      const edgeIds = new Set<string>()
      for (const df of drawsToRestore) {
        if (df.meta.linkedTerminalId) {
          const edgeId = `edge-${df.meta.linkedTerminalId}-${df.meta.drawId}`
          if (!edgeIds.has(edgeId)) {
            edgesToRestore.push({
              id: edgeId,
              source: df.meta.linkedTerminalId,
              target: df.meta.drawId,
              animated: true,
              style: { stroke: '#ec4899', strokeWidth: 2 }
            })
            edgeIds.add(edgeId)
          }
        }
      }
      if (edgesToRestore.length > 0) {
        setAllEdges((eds) => {
          const existing = new Set(eds.map((e) => e.id))
          const newEdges = edgesToRestore.filter((e) => !existing.has(e.id))
          return newEdges.length > 0 ? [...eds, ...newEdges] : eds
        })
      }

      setNodesLoadedFlags((prev) => ({ ...prev, draws: true }))
    })
  }, [])

  // ── Load persisted edges once all nodes are ready ──
  useEffect(() => {
    if (!nodesLoadedFlags.notes || !nodesLoadedFlags.terminals || !nodesLoadedFlags.browsers || !nodesLoadedFlags.draws) return

    window.edges.load().then((persistedEdges) => {
      if (!persistedEdges || persistedEdges.length === 0) return

      // Filter orphaned edges whose source or target no longer exists
      const currentNodeIds = new Set(allNodesRef.current.map((n) => n.id))
      const validEdges = persistedEdges
        .filter((e) => currentNodeIds.has(e.source) && currentNodeIds.has(e.target))
        .map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle ?? undefined,
          targetHandle: e.targetHandle ?? undefined,
          animated: e.animated ?? false,
          style: e.style as React.CSSProperties | undefined
        }))

      if (validEdges.length > 0) {
        setAllEdges(validEdges)
      }
    })
  }, [nodesLoadedFlags])

  // ── Save terminal tile layout on window close ──
  useEffect(() => {
    const handler = () => {
      const terminalNodes = allNodesRef.current.filter((n) => n.type === 'terminal')
      const layout = terminalNodes.map((n) => ({
        sessionId: (n.data as { sessionId: string }).sessionId,
        position: n.position,
        width: (n.style?.width as number) ?? 640,
        height: (n.style?.height as number) ?? 400,
        workspaceId: tileWorkspaceMapRef.current.get((n.data as { sessionId: string }).sessionId) ?? 'default'
      }))
      window.terminalTiles.saveLayout(layout)

      // Save browser tile layout
      const browserNodes = allNodesRef.current.filter(
        (n) => n.type === 'browser' && !(n.data as { isBackground?: boolean }).isBackground
      )
      const browserLayout = browserNodes.map((n) => {
        const d = n.data as {
          sessionId: string
          label: string
          linkedTerminalId?: string
          initialPreset?: { name: string; width: number; height: number; mobile: boolean; dpr: number }
        }
        return {
          sessionId: d.sessionId,
          label: d.label,
          position: n.position,
          width: (n.style?.width as number) ?? 800,
          height: (n.style?.height as number) ?? 600,
          workspaceId: tileWorkspaceMapRef.current.get(d.sessionId) ?? 'default',
          linkedTerminalId: d.linkedTerminalId,
          initialPreset: d.initialPreset
        }
      })
      window.browserTiles.saveLayout(browserLayout)

      // Save all edges
      const edgesToSave = allEdgesRef.current.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
        animated: e.animated,
        style: e.style
      }))
      window.edges.save(edgesToSave)
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

  // ── Save workspaces when they change ──
  const workspacesLoaded = useRef(false)
  useEffect(() => {
    // Only save after the initial load has populated state (guards against
    // StrictMode double-invoke saving defaults before the async load resolves)
    if (!workspacesLoaded.current) return
    window.workspace.save(workspaces, activeWorkspaceId)
  }, [workspaces, activeWorkspaceId])

  // ── Global terminal:exit listener (cleans up tiles even when hidden) ──
  useEffect(() => {
    const unsub = window.terminal.onExit((id) => {
      setAllNodes((nds) => {
        // Also remove any linked diff viewer for this terminal
        const diffViewerIds = nds
          .filter((n) => n.type === 'diffViewer' && (n.data as Record<string, unknown>).linkedTerminalId === id)
          .map((n) => (n.data as Record<string, unknown>).sessionId as string)
        const removeIds = new Set([id, ...diffViewerIds])
        return nds.filter((n) => !removeIds.has((n.data as Record<string, unknown>).sessionId as string))
      })
      setTileWorkspaceMap((prev) => {
        const next = new Map(prev)
        next.delete(id)
        return next
      })
      setFocusedId((prev) => (prev === id ? null : prev))
    })
    return unsub
  }, [])

  // ── Tile management ──

  const killTerminal = useCallback(
    (sessionId: string) => {
      const node = allNodesRef.current.find(
        (n) => (n.data as Record<string, unknown>).sessionId === sessionId
      )
      if (node?.type === 'browser') {
        window.browser.destroy(sessionId)
        // Also remove any linked DevTools tile
        const linkedDevTools = allNodesRef.current.find(
          (n) => n.type === 'devTools' && (n.data as Record<string, unknown>).linkedBrowserId === sessionId
        )
        if (linkedDevTools) {
          removeTileFromCanvas((linkedDevTools.data as Record<string, unknown>).sessionId as string)
        }
      } else if (node?.type === 'notes') {
        // For notes in killTerminal (e.g. workspace removal), delete the file
        window.note.delete(sessionId)
      } else if (node?.type === 'draw') {
        window.draw.delete(sessionId)
      } else if (node?.type === 'diffViewer') {
        // Diff viewers just get removed from canvas
      } else {
        window.terminal.kill(sessionId)
        // Also remove any linked diff viewer
        const linkedDiff = allNodesRef.current.find(
          (n) => n.type === 'diffViewer' && (n.data as Record<string, unknown>).linkedTerminalId === sessionId
        )
        if (linkedDiff) {
          removeTileFromCanvas((linkedDiff.data as Record<string, unknown>).sessionId as string)
        }
      }
      removeTileFromCanvas(sessionId)
    },
    [removeTileFromCanvas]
  )

  // ── Diff viewer toggle ──

  const toggleDiffViewer = useCallback(
    (terminalSessionId: string) => {
      const existing = allNodesRef.current.find(
        (n) => n.type === 'diffViewer' && (n.data as Record<string, unknown>).linkedTerminalId === terminalSessionId
      )

      if (existing) {
        removeTileFromCanvas((existing.data as Record<string, unknown>).sessionId as string)
        return
      }

      const terminalNode = allNodesRef.current.find(
        (n) => (n.data as Record<string, unknown>).sessionId === terminalSessionId
      )
      if (!terminalNode) return

      tileCount++
      const sessionId = uuid()
      const diffW = 700
      const diffH = 500
      const termH = (terminalNode.measured?.height ?? (terminalNode.style?.height as number) ?? 400)
      const pos = {
        x: terminalNode.position.x,
        y: terminalNode.position.y + termH + (settings.canvas.tileGap || 40)
      }

      const newNode: Node = {
        id: sessionId,
        type: 'diffViewer',
        position: pos,
        style: { width: diffW, height: diffH },
        data: {
          sessionId,
          label: `Diff Viewer`,
          linkedTerminalId: terminalSessionId,
          cwd: (terminalNode.data as Record<string, unknown>).cwd || '',
          onClose: (sid: string) => removeTileFromCanvas(sid)
        },
        dragHandle: '.diff-viewer-tile-header'
      }

      setAllNodes((nds) => [...nds, newNode])
      setTileWorkspaceMap((prev) =>
        new Map(prev).set(sessionId, tileWorkspaceMapRef.current.get(terminalSessionId) ?? activeWorkspaceIdRef.current)
      )

      // Create auto-edge with diff-specific handle IDs and purple dashed styling
      const newEdge: Edge = {
        id: `diff-edge-${terminalSessionId}-${sessionId}`,
        source: terminalSessionId,
        target: sessionId,
        sourceHandle: 'diff-source',
        targetHandle: 'diff-target',
        animated: true,
        style: { stroke: '#a855f7', strokeWidth: 2, strokeDasharray: '6 3' }
      }
      setAllEdges((eds) => [...eds, newEdge])

      setFocusedId(sessionId)
      setCenter(pos.x + diffW / 2, pos.y + diffH / 2, { zoom: 1, duration: 400 })
    },
    [removeTileFromCanvas, setCenter, settings.canvas.tileGap]
  )

  const hasDiffViewer = useCallback(
    (terminalSessionId: string) => {
      return allNodes.some(
        (n) => n.type === 'diffViewer' && (n.data as Record<string, unknown>).linkedTerminalId === terminalSessionId
      )
    },
    [allNodes]
  )

  const toggleDevTools = useCallback(
    (browserSessionId: string) => {
      const existing = allNodesRef.current.find(
        (n) => n.type === 'devTools' && (n.data as Record<string, unknown>).linkedBrowserId === browserSessionId
      )
      if (existing) {
        removeTileFromCanvas((existing.data as Record<string, unknown>).sessionId as string)
        return
      }

      const browserNode = allNodesRef.current.find(
        (n) => (n.data as Record<string, unknown>).sessionId === browserSessionId
      )
      if (!browserNode) return

      tileCount++
      const sessionId = uuid()
      const dtW = 900
      const dtH = 500
      const browserW = (browserNode.measured?.width ?? (browserNode.style?.width as number) ?? 800)
      const pos = {
        x: browserNode.position.x + browserW + (settings.canvas.tileGap || 40),
        y: browserNode.position.y
      }

      const newNode: Node = {
        id: sessionId,
        type: 'devTools',
        position: pos,
        style: { width: dtW, height: dtH },
        data: {
          sessionId,
          label: 'DevTools',
          linkedBrowserId: browserSessionId,
          onClose: (sid: string) => removeTileFromCanvas(sid)
        },
        dragHandle: '.devtools-tile-header'
      }

      setAllNodes((nds) => [...nds, newNode])
      setTileWorkspaceMap((prev) =>
        new Map(prev).set(sessionId, tileWorkspaceMapRef.current.get(browserSessionId) ?? activeWorkspaceIdRef.current)
      )

      const newEdge: Edge = {
        id: `devtools-edge-${browserSessionId}-${sessionId}`,
        source: browserSessionId,
        target: sessionId,
        sourceHandle: 'devtools-source',
        targetHandle: 'devtools-target',
        animated: true,
        style: { stroke: '#f97316', strokeWidth: 2, strokeDasharray: '6 3' }
      }
      setAllEdges((eds) => [...eds, newEdge])

      setFocusedId(sessionId)
      setCenter(pos.x + dtW / 2, pos.y + dtH / 2, { zoom: 1, duration: 400 })
    },
    [removeTileFromCanvas, setCenter, settings.canvas.tileGap]
  )

  const hasDevTools = useCallback(
    (browserSessionId: string) => {
      return allNodes.some(
        (n) => n.type === 'devTools' && (n.data as Record<string, unknown>).linkedBrowserId === browserSessionId
      )
    },
    [allNodes]
  )

  const addBrowserAt = useCallback(
    (position?: { x: number; y: number }, preset?: DevicePreset) => {
      tileCount++
      const sessionId = uuid()
      const tileW = preset ? preset.width + BROWSER_CHROME_WIDTH : 800
      const tileH = preset ? preset.height + BROWSER_CHROME_HEIGHT : 600
      const visible = visibleNodes
      const pos = position ?? findOpenPosition(visible, tileW, tileH, 3, settings.canvas.tileGap)
      const newNode: Node = {
        id: sessionId,
        type: 'browser',
        position: pos,
        style: { width: tileW, height: tileH },
        data: {
          sessionId,
          label: `Browser ${tileCount}`,
          initialUrl: settings.browser.defaultUrl,
          initialPreset: preset && (preset.mobile || preset.dpr > 1) ? preset : undefined
        },
        dragHandle: '.browser-tile-header'
      }
      setAllNodes((nds) => [...nds, newNode])
      setTileWorkspaceMap((prev) => new Map(prev).set(sessionId, activeWorkspaceIdRef.current))
      setFocusedId(sessionId)
      setCenter(pos.x + tileW / 2, pos.y + tileH / 2, { zoom: 1, duration: 400 })
    },
    [visibleNodes, setCenter]
  )

  const addBrowser = useCallback((preset?: DevicePreset) => addBrowserAt(undefined, preset), [addBrowserAt])

  // Auto-spawn a browser tile linked to a terminal when agent-browser is detected
  const addBrowserForTerminal = useCallback(
    (terminalId: string, url: string, reservationId?: string, tileWidth?: number, tileHeight?: number) => {
      // Treat empty terminalId as unlinked
      const isLinked = terminalId && terminalId !== 'api'

      // If a browser already exists for this terminal, navigate it instead of spawning a new one
      if (isLinked) {
        const existing = allNodesRef.current.find(
          (n) => n.type === 'browser' && (n.data as Record<string, unknown>).linkedTerminalId === terminalId
        )
        if (existing) {
          const existingSessionId = (existing.data as Record<string, unknown>).sessionId as string
          navigateBrowser(existingSessionId, url)
          setFocusedId(existingSessionId)
          return
        }
      }

      const terminalNode = allNodesRef.current.find(
        (n) => (n.data as Record<string, unknown>).sessionId === terminalId
      )

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

      setAllNodes((nds) => [...nds, newNode])

      // Inherit workspace from the terminal, or fall back to active workspace
      const terminalWorkspace = isLinked
        ? tileWorkspaceMapRef.current.get(terminalId)
        : undefined
      setTileWorkspaceMap((prev) =>
        new Map(prev).set(sessionId, terminalWorkspace ?? activeWorkspaceIdRef.current)
      )

      // Create edge only if linked to a real terminal
      if (terminalNode) {
        const newEdge: Edge = {
          id: `edge-${terminalId}-${sessionId}`,
          source: terminalId,
          target: sessionId,
          animated: true,
          style: { stroke: '#10b981', strokeWidth: 2 }
        }
        setAllEdges((eds) => [...eds, newEdge])
      }

      setFocusedId(sessionId)
    },
    []
  )

  useEffect(() => {
    const unsub = window.terminal.onBrowserRequest((terminalId, url, reservationId, width, height) => {
      addBrowserForTerminal(terminalId, url, reservationId, width, height)
    })
    return unsub
  }, [addBrowserForTerminal])

  // Handle Cmd+R / Ctrl+R / F5 — globalShortcut in the main process intercepts
  // the key at the OS level and sends IPC here. Reload the focused browser tile.
  useEffect(() => {
    const unsub = window.browser.onRefreshFocused(() => {
      if (!focusedId) return
      const node = allNodesRef.current.find(
        (n) => (n.data as Record<string, unknown>).sessionId === focusedId
      )
      if (node?.type === 'browser') {
        reloadBrowser(focusedId)
      }
    })
    return unsub
  }, [focusedId])

  // Handle agentic browser resize via API
  useEffect(() => {
    const unsub = window.terminal.onBrowserResize((sessionId, width, height) => {
      setAllNodes(nds => nds.map(n => {
        const data = n.data as Record<string, unknown>
        if (data.sessionId === sessionId) {
          return { ...n, width, height, style: { ...n.style, width, height } }
        }
        return n
      }))
    })
    return unsub
  }, [])

  // Handle tile rename via API
  useEffect(() => {
    const unsub = window.terminal.onTileRename((sessionId, label) => {
      setAllNodes(nds => nds.map(n => {
        const data = n.data as Record<string, unknown>
        if (data.sessionId === sessionId) {
          return { ...n, data: { ...data, label } }
        }
        return n
      }))
      // Persist note labels when renamed via API
      const node = allNodesRef.current.find(
        n => (n.data as Record<string, unknown>).sessionId === sessionId
      )
      if (node?.type === 'notes') {
        window.note.save(sessionId, { label })
      }
    })
    return unsub
  }, [])

  const focusTerminal = useCallback(
    (sessionId: string) => {
      setFocusedId(sessionId)
      const node = allNodesRef.current.find(
        (n) => (n.data as Record<string, unknown>).sessionId === sessionId
      )
      if (!node) return
      const defaultW = defaultTileWidth(node.type)
      const defaultH = defaultTileHeight(node.type)
      const cx = (node.measured?.width ?? (node.style?.width as number) ?? defaultW) / 2
      const cy = (node.measured?.height ?? (node.style?.height as number) ?? defaultH) / 2
      setCenter(node.position.x + cx, node.position.y + cy, {
        zoom: 1,
        duration: 400
      })
    },
    [setCenter]
  )

  const onPaneClick = useCallback(() => {
    setFocusedId(null)
  }, [])

  const addTerminalAt = useCallback(
    (position?: { x: number; y: number }, width = 640, height = 400) => {
      tileCount++
      const sessionId = uuid()
      const visible = visibleNodes
      const pos = position ?? findOpenPosition(visible, width, height, 4, settings.canvas.tileGap)

      // Get workspace path for terminal CWD
      const wsId = activeWorkspaceIdRef.current
      const ws = workspaces.find((w) => w.id === wsId)
      const cwd = ws?.path ?? undefined

      const newNode: Node = {
        id: sessionId,
        type: 'terminal',
        position: pos,
        style: { width, height },
        data: {
          sessionId,
          label: `Terminal ${tileCount}`,
          cwd
        },
        dragHandle: '.terminal-tile-header'
      }
      setAllNodes((nds) => [...nds, newNode])
      setTileWorkspaceMap((prev) => new Map(prev).set(sessionId, wsId))
      setFocusedId(sessionId)
      setCenter(pos.x + width / 2, pos.y + height / 2, { zoom: 1, duration: 400 })
    },
    [visibleNodes, workspaces, setCenter]
  )

  const addTerminal = useCallback((width?: number, height?: number) => addTerminalAt(undefined, width, height), [addTerminalAt])

  const addNoteAt = useCallback(
    (position?: { x: number; y: number }) => {
      tileCount++
      const sessionId = uuid()
      const visible = visibleNodes
      const pos = position ?? findOpenPosition(visible, 400, 400, 4, settings.canvas.tileGap)
      const label = `Note ${tileCount}`
      const wsId = activeWorkspaceIdRef.current
      const newNode: Node = {
        id: sessionId,
        type: 'notes',
        position: pos,
        style: { width: 400, height: 400 },
        data: {
          sessionId,
          label,
          onClose: closeNote,
          onDelete: deleteNote
        },
        dragHandle: '.notes-tile-header'
      }
      setAllNodes((nds) => [...nds, newNode])
      setTileWorkspaceMap((prev) => new Map(prev).set(sessionId, wsId))
      setFocusedId(sessionId)
      setCenter(pos.x + 200, pos.y + 200, { zoom: 1, duration: 400 })

      // Persist metadata
      window.note.save(sessionId, {
        noteId: sessionId,
        label,
        workspaceId: wsId,
        isSoftDeleted: false,
        position: pos,
        width: 400,
        height: 400,
        createdAt: Date.now(),
        updatedAt: Date.now()
      })
    },
    [visibleNodes, setCenter, closeNote, deleteNote]
  )

  const addNote = useCallback(() => addNoteAt(undefined), [addNoteAt])

  const addDrawAt = useCallback(
    (position?: { x: number; y: number }, linkedTerminalId?: string) => {
      tileCount++
      const sessionId = uuid()
      const visible = visibleNodes
      const pos = position ?? findOpenPosition(visible, 800, 600, 2, settings.canvas.tileGap)
      const label = `Draw ${tileCount}`
      const wsId = activeWorkspaceIdRef.current
      const newNode: Node = {
        id: sessionId,
        type: 'draw',
        position: pos,
        style: { width: 800, height: 600 },
        data: {
          sessionId,
          label,
          linkedTerminalId,
          onClose: closeDraw,
          onDelete: deleteDraw
        },
        dragHandle: '.draw-tile-header'
      }
      setAllNodes((nds) => [...nds, newNode])
      setTileWorkspaceMap((prev) => new Map(prev).set(sessionId, wsId))
      setFocusedId(sessionId)
      setCenter(pos.x + 400, pos.y + 300, { zoom: 1, duration: 400 })

      window.draw.save(sessionId, {
        drawId: sessionId,
        label,
        workspaceId: wsId,
        isSoftDeleted: false,
        position: pos,
        width: 800,
        height: 600,
        linkedTerminalId,
        createdAt: Date.now(),
        updatedAt: Date.now()
      })

      // Auto-create edge if linked to a terminal
      if (linkedTerminalId) {
        const newEdge: Edge = {
          id: `edge-${linkedTerminalId}-${sessionId}`,
          source: linkedTerminalId,
          target: sessionId,
          animated: true,
          style: { stroke: '#ec4899', strokeWidth: 2 }
        }
        setAllEdges((eds) => [...eds, newEdge])
      }

      return sessionId
    },
    [visibleNodes, setCenter, closeDraw, deleteDraw, settings.canvas.tileGap]
  )

  const addDraw = useCallback(() => addDrawAt(undefined), [addDrawAt])

  // ── Agent-driven draw tile creation ──
  useEffect(() => {
    const unsub = window.draw.onDrawOpen((info) => {
      addDrawAt(undefined, info.terminalId)
    })
    return unsub
  }, [addDrawAt])

  // ── Agent-driven draw tile update (Mermaid or raw elements) ──
  useEffect(() => {
    const unsub = window.draw.onDrawUpdate((info) => {
      const doUpdate = async (elements: unknown[]) => {
        if (info.mode !== 'replace') {
          const existing = await window.draw.load(info.sessionId)
          if (existing?.elements?.length) {
            elements = [...existing.elements, ...elements]
          }
        }
        window.draw.save(info.sessionId, {}, elements, {})
      }

      if (info.mermaid) {
        const graph = parseMermaid(info.mermaid)
        const { shapes, arrows } = layoutMermaidGraph(graph, 50, 50)
        doUpdate([...shapes, ...arrows] as unknown[])
      } else if (info.elements) {
        doUpdate(info.elements)
      }
    })
    return unsub
  }, [])

  // ── Template spawning ──
  const spawnTemplate = useCallback(
    (template: WorkspaceTemplate, origin?: { x: number; y: number }) => {
      const gap = settings.canvas.tileGap
      // Find a clear area for the template bounding box
      let maxW = 0, maxH = 0
      for (const t of template.tiles) {
        maxW = Math.max(maxW, t.relativePosition.x + t.width)
        maxH = Math.max(maxH, t.relativePosition.y + t.height)
      }
      const basePos = origin ?? findOpenPosition(visibleNodes, maxW, maxH, 2, gap)

      for (const tile of template.tiles) {
        const pos = {
          x: basePos.x + tile.relativePosition.x,
          y: basePos.y + tile.relativePosition.y
        }
        if (tile.type === 'terminal') {
          addTerminalAt(pos, tile.width, tile.height)
        } else if (tile.type === 'browser') {
          addBrowserAt(pos)
        } else if (tile.type === 'notes') {
          addNoteAt(pos)
        } else if (tile.type === 'draw') {
          addDrawAt(pos)
        }
      }
    },
    [settings.canvas.tileGap, visibleNodes, addTerminalAt, addBrowserAt, addNoteAt, addDrawAt]
  )

  // ── Right-click context menu ──
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; flowPos: { x: number; y: number } } | null>(null)

  const onContextMenu = useCallback(
    (event: React.MouseEvent) => {
      const target = event.target as HTMLElement
      if (!target.closest('.react-flow__pane')) return
      if (target.closest('.react-flow__node')) return
      event.preventDefault()
      const flowPos = screenToFlowPosition({ x: event.clientX, y: event.clientY })
      setContextMenu({ x: event.clientX, y: event.clientY, flowPos })
    },
    [screenToFlowPosition]
  )

  // Close context menu on any click
  useEffect(() => {
    if (!contextMenu) return
    const handler = () => setContextMenu(null)
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [contextMenu])

  const onDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      const target = event.target as HTMLElement
      if (!target.closest('.react-flow__pane')) return
      if (target.closest('.react-flow__node')) return
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY })
      const safePos = snapToGrid(position, allNodes, 640, 400, settings.canvas.tileGap)
      addTerminalAt(safePos)
    },
    [screenToFlowPosition, addTerminalAt, allNodes]
  )

  // ── Workspace management ──

  // Switch to a workspace and focus a specific tile
  const handleFocusProcess = useCallback(
    (workspaceId: string, sessionId: string) => {
      if (workspaceId !== activeWorkspaceId) {
        // Save current viewport, switch workspace
        viewportCache.current.set(activeWorkspaceId, getViewport())
        setActiveWorkspaceId(workspaceId)
        // Focus the tile after workspace switch settles
        requestAnimationFrame(() => {
          setFocusedId(sessionId)
          const node = allNodesRef.current.find(
            (n) => (n.data as Record<string, unknown>).sessionId === sessionId
          )
          if (!node) return
          const defaultW = node.type === 'browser' ? 800 : 640
          const defaultH = node.type === 'browser' ? 600 : 400
          const cx = (node.measured?.width ?? (node.style?.width as number) ?? defaultW) / 2
          const cy = (node.measured?.height ?? (node.style?.height as number) ?? defaultH) / 2
          setCenter(node.position.x + cx, node.position.y + cy, { zoom: 1, duration: 400 })
        })
      } else {
        focusTerminal(sessionId)
      }
    },
    [activeWorkspaceId, getViewport, setCenter, focusTerminal]
  )

  const handleSelectWorkspace = useCallback(
    (id: string) => {
      if (id === activeWorkspaceId) return
      // Save current viewport
      viewportCache.current.set(activeWorkspaceId, getViewport())
      setActiveWorkspaceId(id)
      setFocusedId(null)
      // Restore target viewport
      const saved = viewportCache.current.get(id)
      if (saved) {
        // Use requestAnimationFrame to ensure ReactFlow has processed the new nodes
        requestAnimationFrame(() => {
          setViewport(saved, { duration: 300 })
        })
      } else {
        requestAnimationFrame(() => {
          fitView({ duration: 300, padding: 0.2 })
        })
      }
    },
    [activeWorkspaceId, getViewport, setViewport, fitView]
  )

  const handleAddWorkspace = useCallback(async () => {
    const dirPath = await window.workspace.pickDirectory()
    if (!dirPath) return
    // Check if workspace with this path already exists
    const existing = workspaces.find((w) => w.path === dirPath)
    if (existing) {
      handleSelectWorkspace(existing.id)
      return
    }
    const name = dirPath.split('/').pop() || dirPath
    const ws: Workspace = {
      id: uuid(),
      name,
      path: dirPath,
      isDefault: false,
      createdAt: Date.now()
    }
    setWorkspaces((prev) => [...prev, ws])
    handleSelectWorkspace(ws.id)
  }, [workspaces, handleSelectWorkspace])

  const handleRemoveWorkspace = useCallback(
    (id: string) => {
      const ws = workspaces.find((w) => w.id === id)
      if (!ws || ws.isDefault) return

      // Kill all tiles belonging to this workspace
      const tilesToKill: string[] = []
      for (const [sessionId, wsId] of tileWorkspaceMapRef.current) {
        if (wsId === id) tilesToKill.push(sessionId)
      }
      for (const sessionId of tilesToKill) {
        const node = allNodesRef.current.find(
          (n) => (n.data as Record<string, unknown>).sessionId === sessionId
        )
        if (node?.type === 'browser') {
          window.browser.destroy(sessionId)
        } else if (node?.type === 'notes') {
          window.note.delete(sessionId)
        } else {
          window.terminal.kill(sessionId)
        }
      }
      setAllNodes((nds) =>
        nds.filter((n) => !tilesToKill.includes((n.data as Record<string, unknown>).sessionId as string))
      )
      setAllEdges((eds) =>
        eds.filter((e) => !tilesToKill.includes(e.source) && !tilesToKill.includes(e.target))
      )
      setTileWorkspaceMap((prev) => {
        const next = new Map(prev)
        for (const sid of tilesToKill) next.delete(sid)
        return next
      })

      // Remove workspace
      setWorkspaces((prev) => prev.filter((w) => w.id !== id))
      viewportCache.current.delete(id)

      // Switch to default if we just removed the active workspace
      if (activeWorkspaceId === id) {
        setActiveWorkspaceId('default')
        setFocusedId(null)
        requestAnimationFrame(() => {
          fitView({ duration: 300, padding: 0.2 })
        })
      }
    },
    [workspaces, activeWorkspaceId, fitView]
  )

  const handleRenameWorkspace = useCallback(
    (id: string, name: string) => {
      setWorkspaces((prev) =>
        prev.map((w) => (w.id === id && !w.isDefault ? { ...w, name } : w))
      )
    },
    []
  )

  // ── Mod-hold kill highlight ──
  // Hold Cmd/Ctrl for 300ms to pulse the focused tile red, hinting that
  // Mod+D will kill it.

  const [killHighlight, setKillHighlight] = useState(false)
  const modTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const modKey = navigator.platform.includes('Mac') ? 'Meta' : 'Control'
    const clearTimer = () => {
      if (modTimerRef.current) {
        clearTimeout(modTimerRef.current)
        modTimerRef.current = null
      }
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === modKey && !e.altKey && !e.shiftKey && focusedId) {
        clearTimer()
        modTimerRef.current = setTimeout(() => {
          modTimerRef.current = null
          setKillHighlight(true)
        }, 300)
      } else if (killHighlight || modTimerRef.current) {
        // Any other key cancels or we're past the highlight
        // Don't clear killHighlight here — let keyup handle it
        clearTimer()
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === modKey) {
        clearTimer()
        setKillHighlight(false)
      }
    }
    const onBlur = () => {
      clearTimer()
      setKillHighlight(false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      clearTimer()
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [focusedId, killHighlight])

  // ── Tile rename ──

  const renameTile = useCallback((sessionId: string, newLabel: string) => {
    setAllNodes(nds => nds.map(n => {
      const data = n.data as Record<string, unknown>
      if (data.sessionId === sessionId) {
        return { ...n, data: { ...data, label: newLabel } }
      }
      return n
    }))
    const node = allNodesRef.current.find(
      n => (n.data as Record<string, unknown>).sessionId === sessionId
    )
    if (node?.type === 'terminal') {
      window.terminal.rename(sessionId, newLabel)
    } else if (node?.type === 'notes') {
      window.note.save(sessionId, { label: newLabel })
    } else if (node?.type === 'draw') {
      window.draw.save(sessionId, { label: newLabel })
    }
  }, [])

  // ── Context + render ──

  const focusCtx = useMemo(
    () => ({ focusedId, setFocusedId, killTerminal, killHighlight, toggleDiffViewer, hasDiffViewer, toggleDevTools, hasDevTools, renameTile }),
    [focusedId, killTerminal, killHighlight, toggleDiffViewer, hasDiffViewer, toggleDevTools, hasDevTools, renameTile]
  )

  const navigateToNote = useCallback(
    (noteId: string) => {
      const wsId = tileWorkspaceMap.get(noteId)
      if (wsId) {
        handleFocusProcess(wsId, noteId)
      }
    },
    [tileWorkspaceMap, handleFocusProcess]
  )

  const pomodoroCtx = useMemo(
    () => ({ addTask: pomodoro.addTask, tasks: pomodoro.tasks, navigateToNote }),
    [pomodoro.addTask, pomodoro.tasks, navigateToNote]
  )

  const activeWorkspace = useMemo(
    () => workspaces.find((w) => w.id === activeWorkspaceId) ?? DEFAULT_WORKSPACE,
    [workspaces, activeWorkspaceId]
  )

  const proOptions = useMemo(() => ({ hideAttribution: true }), [])
  const togglePanel = useCallback(() => setPanelOpen((o) => !o), [])
  const toggleWorkspacePanel = useCallback(() => setWorkspacePanelOpen((o) => !o), [])

  // ── Hotkeys ──

  const cycleFocus = useCallback(
    (direction: 1 | -1) => {
      const tileIds = visibleNodes
        .filter((n) => tileWorkspaceMap.get((n.data as Record<string, unknown>).sessionId as string) === activeWorkspaceId)
        .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)
        .map((n) => (n.data as Record<string, unknown>).sessionId as string)

      if (tileIds.length === 0) return

      const currentIndex = focusedId ? tileIds.indexOf(focusedId) : -1
      const nextIndex =
        currentIndex === -1
          ? direction === 1 ? 0 : tileIds.length - 1
          : (currentIndex + direction + tileIds.length) % tileIds.length

      focusTerminal(tileIds[nextIndex])
    },
    [visibleNodes, tileWorkspaceMap, activeWorkspaceId, focusedId, focusTerminal]
  )

  const hotkeyActions = useMemo<Record<HotkeyAction, () => void>>(
    () => ({
      toggleProcessPanel: togglePanel,
      toggleWorkspacePanel: toggleWorkspacePanel,
      toggleMinimap: () => {
        updateSettings({ canvas: { ...settings.canvas, minimapEnabled: !settings.canvas.minimapEnabled } })
      },
      newTerminal: () => addTerminal(),
      newBrowser: () => addBrowser(),
      newNote: addNote,
      newDraw: addDraw,
      openSettings: () => setSettingsOpen(true),
      cycleFocusForward: () => cycleFocus(1),
      cycleFocusBackward: () => cycleFocus(-1),
      killFocused: () => {
        if (!focusedId) return
        const node = allNodesRef.current.find(
          (n) => (n.data as Record<string, unknown>).sessionId === focusedId
        )
        if (node?.type === 'notes') {
          closeNote(focusedId)
        } else {
          killTerminal(focusedId)
        }
      },
      openInIde: async () => {
        if (!focusedId) return
        const status = await window.terminal.getStatus(focusedId)
        if (!status) return
        const worktree = status.metadata?.worktree as { path?: string } | undefined
        const targetPath = worktree?.path || status.cwd
        if (targetPath) {
          window.ide.open(targetPath)
        }
      },
      togglePomodoro
    }),
    [togglePanel, toggleWorkspacePanel, updateSettings, settings.canvas, addTerminal, addBrowser, addNote, cycleFocus, focusedId, closeNote, killTerminal, togglePomodoro]
  )

  useHotkeys(settings.hotkeys, hotkeyActions)

  // ── Ctrl-hold jump hints ──
  // Hold Ctrl for 300ms (without pressing another key) to show jump badges.
  // Press the letter to jump to that tile. Releasing Ctrl or pressing any
  // non-matching key exits jump mode. The delay prevents conflict with
  // fast Ctrl+C / Ctrl+Z combos.

  const [jumpMode, setJumpMode] = useState(false)
  const ctrlTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Assignments follow the Process Panel display order:
  // terminals → browsers (active workspace) → notes
  const jumpAssignments = useMemo(() => {
    if (!jumpMode) return new Map<string, string>()
    const terminals = visibleNodes.filter((n) => n.type === 'terminal')
    const browsers = visibleNodes.filter((n) => {
      if (n.type !== 'browser') return false
      const sid = (n.data as Record<string, unknown>).sessionId as string
      return tileWorkspaceMap.get(sid) === activeWorkspaceId
    })
    const notes = visibleNodes.filter((n) => n.type === 'notes')
    const diffs = visibleNodes.filter((n) => n.type === 'diffViewer')
    const draws = visibleNodes.filter((n) => n.type === 'draw')
    const ordered = [...terminals, ...browsers, ...notes, ...draws, ...diffs]
    const map = new Map<string, string>()
    ordered.forEach((n, i) => {
      if (i >= JUMP_KEYS.length) return
      const sid = (n.data as Record<string, unknown>).sessionId as string
      map.set(sid, JUMP_KEYS[i])
    })
    return map
  }, [jumpMode, visibleNodes, tileWorkspaceMap, activeWorkspaceId])

  useEffect(() => {
    const clearTimer = () => {
      if (ctrlTimerRef.current) {
        clearTimeout(ctrlTimerRef.current)
        ctrlTimerRef.current = null
      }
    }

    const onKeyDown = (e: KeyboardEvent) => {
      // Bare Ctrl press starts the 300ms timer
      if (e.key === 'Control' && !e.shiftKey && !e.altKey && !e.metaKey) {
        clearTimer()
        ctrlTimerRef.current = setTimeout(() => {
          ctrlTimerRef.current = null
          setJumpMode(true)
        }, 300)
        return
      }

      // Any other key while timer is pending → cancel (it's a Ctrl+X combo)
      if (!jumpMode) {
        clearTimer()
        return
      }

      // In jump mode: Ctrl+key jumps to tile (stay in jump mode while Ctrl held)
      if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && e.key.length === 1) {
        const pressed = e.key.toUpperCase()
        for (const [sessionId, key] of jumpAssignments) {
          if (key === pressed) {
            e.preventDefault()
            e.stopPropagation()
            focusTerminal(sessionId)
            return
          }
        }
      }
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Control') {
        clearTimer()
        setJumpMode(false)
      }
    }

    const onBlur = () => {
      clearTimer()
      setJumpMode(false)
    }

    window.addEventListener('keydown', onKeyDown, { capture: true })
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      clearTimer()
      window.removeEventListener('keydown', onKeyDown, { capture: true })
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [jumpMode, jumpAssignments, focusTerminal])

  // ── Option-hold workspace jump hints ──
  // Hold Option/Alt for 300ms to show workspace badges in the Workspace Panel.

  const [wsJumpMode, setWsJumpMode] = useState(false)
  const optionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const wsJumpAssignments = useMemo(() => {
    if (!wsJumpMode) return new Map<string, string>()
    const map = new Map<string, string>()
    workspaces.forEach((ws, i) => {
      if (i >= JUMP_KEYS.length) return
      map.set(ws.id, JUMP_KEYS[i])
    })
    return map
  }, [wsJumpMode, workspaces])

  useEffect(() => {
    const clearTimer = () => {
      if (optionTimerRef.current) {
        clearTimeout(optionTimerRef.current)
        optionTimerRef.current = null
      }
    }

    const onKeyDown = (e: KeyboardEvent) => {
      // Bare Alt/Option press starts the 300ms timer
      if (e.key === 'Alt' && !e.ctrlKey && !e.shiftKey && !e.metaKey) {
        clearTimer()
        optionTimerRef.current = setTimeout(() => {
          optionTimerRef.current = null
          setWsJumpMode(true)
        }, 300)
        return
      }

      // Any other key while timer is pending → cancel
      if (!wsJumpMode) {
        clearTimer()
        return
      }

      // In workspace jump mode: Alt+key switches workspace
      // On macOS, Alt+letter produces special characters (e.g., å for Alt+A),
      // so use event.code to get the physical key.
      if (e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey && e.code) {
        const code = e.code
        let pressed: string | null = null
        if (code.startsWith('Key')) pressed = code.slice(3)
        else if (code.startsWith('Digit')) pressed = code.slice(5)
        if (!pressed) return
        for (const [wsId, key] of wsJumpAssignments) {
          if (key === pressed) {
            e.preventDefault()
            e.stopPropagation()
            handleSelectWorkspace(wsId)
            return
          }
        }
      }
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt') {
        clearTimer()
        setWsJumpMode(false)
      }
    }

    const onBlur = () => {
      clearTimer()
      setWsJumpMode(false)
    }

    window.addEventListener('keydown', onKeyDown, { capture: true })
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      clearTimer()
      window.removeEventListener('keydown', onKeyDown, { capture: true })
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [wsJumpMode, wsJumpAssignments, handleSelectWorkspace])

  return (
    <PomodoroContext.Provider value={pomodoroCtx}>
    <FocusedTerminalContext.Provider value={focusCtx}>
      <div className="flex h-screen w-screen flex-col">
        {perfEnabled && perfStats && <PerformanceOverlay stats={perfStats} />}
        {/* Toolbar */}
        <div className="titlebar-drag flex h-12 items-center justify-between border-b border-zinc-800 bg-zinc-900 px-4">
          <div className="flex items-center gap-3 pl-20">
            <span className="text-sm font-semibold text-zinc-300">Agent Canvas</span>
            {!activeWorkspace.isDefault && (
              <>
                <span className="text-zinc-600">|</span>
                <span className="text-sm font-medium text-zinc-400">{activeWorkspace.name}</span>
              </>
            )}
          </div>
          <div className="titlebar-no-drag flex items-center gap-2">
            <PomodoroWidget pomodoro={pomodoro} expanded={pomodoroExpanded} onToggle={togglePomodoro} />
            <button
              onClick={() => setSettingsOpen(true)}
              className="rounded p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
              title="Settings"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          </div>
        </div>

        {/* Canvas + Panels */}
        <div className="relative flex-1 overflow-hidden">
          <ReactFlow
            nodes={visibleNodes}
            edges={visibleEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            isValidConnection={(connection) =>
              connection.sourceHandle !== 'diff-source' && connection.targetHandle !== 'diff-target'
            }
            onPaneClick={onPaneClick}
            onDoubleClick={onDoubleClick}
            onContextMenu={onContextMenu}
            nodeTypes={nodeTypes}
            defaultViewport={{ x: 100, y: 100, zoom: settings.canvas.defaultZoom }}
            proOptions={proOptions}
            minZoom={settings.canvas.minZoom}
            maxZoom={settings.canvas.maxZoom}
            fitView={false}
            selectNodesOnDrag={false}
            panOnScroll
            panOnScrollSpeed={settings.canvas.panSpeed}
            panOnDrag={[1, 2]}
            zoomOnPinch
            zoomOnDoubleClick={false}
            selectionOnDrag
            deleteKeyCode="Delete"
            className="bg-zinc-950"
          >
            {settings.canvas.backgroundMode === 'dots' ? (
              <Background variant={BackgroundVariant.Dots} gap={settings.canvas.backgroundDotGap} size={settings.canvas.backgroundDotSize} color="#27272a" />
            ) : (
              <CanvasBackground mode={settings.canvas.backgroundMode} />
            )}
            <Controls
              showInteractive={false}
              className="!rounded-lg !border-zinc-700 !bg-zinc-800 [&>button]:!border-zinc-700 [&>button]:!bg-zinc-800 [&>button]:!fill-zinc-400 [&>button:hover]:!bg-zinc-700"
            />
            <PanDetector />
            {settings.canvas.minimapEnabled && (
              <CanvasMiniMap
                position={settings.canvas.minimapPosition}
                panelOpen={panelOpen}
                workspacePanelOpen={workspacePanelOpen}
              />
            )}
          </ReactFlow>

          <WorkspacePanel
            workspaces={workspaces}
            activeWorkspaceId={activeWorkspaceId}
            tileWorkspaceMap={tileWorkspaceMap}
            nodes={allNodes}
            focusedId={focusedId}
            onSelect={handleSelectWorkspace}
            onFocusProcess={handleFocusProcess}
            onAdd={handleAddWorkspace}
            onRemove={handleRemoveWorkspace}
            onRename={handleRenameWorkspace}
            open={workspacePanelOpen}
            onToggle={toggleWorkspacePanel}
            jumpHints={wsJumpAssignments}
          />

          <OffscreenIndicators
            nodes={visibleNodes}
            focusedId={focusedId}
            onFocus={focusTerminal}
          />

          <ProcessPanel
            nodes={visibleNodes}
            edges={visibleEdges}
            focusedId={focusedId}
            onFocus={focusTerminal}
            onFocusProcess={handleFocusProcess}
            onKill={killTerminal}
            onCloseNote={closeNote}
            onDeleteNote={deleteNote}
            onAddTerminal={addTerminal}
            onAddBrowser={addBrowser}
            onAddNote={addNote}
            onAddDraw={addDraw}
            onCloseDraw={closeDraw}
            onDeleteDraw={deleteDraw}
            onSpawnTemplate={spawnTemplate}
            open={panelOpen}
            onToggle={togglePanel}
            tileWorkspaceMap={tileWorkspaceMap}
            workspaces={workspaces}
            activeWorkspaceId={activeWorkspaceId}
            jumpHints={jumpAssignments}
          />
          {/* Right-click context menu */}
          {contextMenu && (
            <div
              className="fixed z-50 min-w-[160px] rounded-md border border-zinc-700 bg-zinc-800 py-1 shadow-xl"
              style={{ left: contextMenu.x, top: contextMenu.y }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => {
                  const safePos = snapToGrid(contextMenu.flowPos, allNodes, 640, 400, settings.canvas.tileGap)
                  addTerminalAt(safePos)
                  setContextMenu(null)
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-zinc-300 hover:bg-zinc-700"
              >
                <span className="h-2 w-2 rounded-full bg-green-500" />
                Terminal
              </button>
              <button
                onClick={() => {
                  const safePos = snapToGrid(contextMenu.flowPos, allNodes, 800, 600, settings.canvas.tileGap)
                  addBrowserAt(safePos)
                  setContextMenu(null)
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-zinc-300 hover:bg-zinc-700"
              >
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                Browser
              </button>
              <button
                onClick={() => {
                  const safePos = snapToGrid(contextMenu.flowPos, allNodes, 400, 400, settings.canvas.tileGap)
                  addNoteAt(safePos)
                  setContextMenu(null)
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-zinc-300 hover:bg-zinc-700"
              >
                <span className="h-2 w-2 rounded-full bg-amber-400" />
                Note
              </button>
              <button
                onClick={() => {
                  const safePos = snapToGrid(contextMenu.flowPos, allNodes, 800, 600, settings.canvas.tileGap)
                  addDrawAt(safePos)
                  setContextMenu(null)
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-zinc-300 hover:bg-zinc-700"
              >
                <span className="h-2 w-2 rounded-full bg-pink-500" />
                Draw
              </button>
              {settings.templates.length > 0 && (
                <>
                  <div className="my-1 border-t border-zinc-700" />
                  <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
                    Templates
                  </div>
                  {settings.templates.map((tmpl) => (
                    <button
                      key={tmpl.id}
                      onClick={() => {
                        spawnTemplate(tmpl, contextMenu.flowPos)
                        setContextMenu(null)
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-zinc-300 hover:bg-zinc-700"
                    >
                      <span className="h-2 w-2 rounded-full bg-blue-500" />
                      {tmpl.name}
                    </button>
                  ))}
                </>
              )}
            </div>
          )}

          {/* Settings overlay */}
          {settingsOpen && <SettingsPage onClose={() => setSettingsOpen(false)} />}
        </div>
      </div>
    </FocusedTerminalContext.Provider>
    </PomodoroContext.Provider>
  )
}
