import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
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
  type ReactFlowInstance,
  addEdge
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { TerminalTile } from './TerminalTile'
import { BrowserTile } from './BrowserTile'
import { NotesTile } from './NotesTile'
import { DiffViewerTile } from './DiffViewerTile'
import { DevToolsTile } from './DevToolsTile'
import { DrawTile } from './draw/DrawTile'
import { NotificationToast } from './NotificationToast'
import { NotificationCenter } from './NotificationCenter'
import { parseMermaid } from '@/lib/mermaid-parser'
import { layoutMermaidGraph } from '@/lib/mermaid-layout'
import { ProcessPanel } from './ProcessPanel'
import { WorkspacePanel } from './WorkspacePanel'
import { OffscreenIndicators } from './OffscreenIndicators'
import { CanvasBackground } from './CanvasBackground'
import { FocusedTerminalContext } from '@/hooks/useFocusedTerminal'
import { PanDetector } from './PanDetector'
import { onBrowserOpenRequest, reloadBrowser } from '@/hooks/useBrowserNavigation'
import { usePerformanceDebug, registerRender } from '@/hooks/usePerformanceDebug'
import { PerformanceOverlay } from './PerformanceOverlay'
import { PomodoroWidget } from './PomodoroWidget'
import { usePomodoro, PomodoroContext } from '@/hooks/usePomodoro'
import { DEFAULT_WORKSPACE } from '@/types/workspace'
import { useSettings } from '@/hooks/useSettings'
import { useHotkeys } from '@/hooks/useHotkeys'
import type { HotkeyAction } from '@/types/settings'
import { SettingsPage } from './SettingsPage'
import { useCanvasStore, snapToGrid } from '@/store/canvas-store'

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
  if ((node.data as Record<string, unknown>)?.isBackground) return 'transparent'
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

  // ── Store state subscriptions ──
  const allNodes = useCanvasStore(s => s.allNodes)
  const allEdges = useCanvasStore(s => s.allEdges)
  const focusedId = useCanvasStore(s => s.focusedId)
  const tileWorkspaceMap = useCanvasStore(s => s.tileWorkspaceMap)
  const activeWorkspaceId = useCanvasStore(s => s.activeWorkspaceId)
  const workspaces = useCanvasStore(s => s.workspaces)
  const nodesLoadedFlags = useCanvasStore(s => s.nodesLoadedFlags)

  // ── Store action references (stable, never change) ──
  const setAllNodes = useCanvasStore(s => s.setAllNodes)
  const setAllEdges = useCanvasStore(s => s.setAllEdges)
  const setFocusedId = useCanvasStore(s => s.setFocusedId)
  const setTileWorkspaceMap = useCanvasStore(s => s.setTileWorkspaceMap)
  const setWorkspaces = useCanvasStore(s => s.setWorkspaces)
  const setNodesLoadedFlags = useCanvasStore(s => s.setNodesLoadedFlags)

  // ── UI-only state ──
  const [workspacePanelOpen, setWorkspacePanelOpen] = useState(true)
  const [panelOpen, setPanelOpen] = useState(true)

  // ── ReactFlow instance ──
  const reactFlowInstance = useReactFlow()
  const { screenToFlowPosition } = reactFlowInstance

  useEffect(() => {
    useCanvasStore.getState().setReactFlowInstance(reactFlowInstance as unknown as ReactFlowInstance)
  }, [reactFlowInstance])

  // ── Sync settings to store ──
  useEffect(() => {
    useCanvasStore.getState().setTileGap(settings.canvas.tileGap)
    useCanvasStore.getState().setBrowserDefaultUrl(settings.browser.defaultUrl)
  }, [settings.canvas.tileGap, settings.browser.defaultUrl])

  // ── Refs that sync from store (for beforeunload handler and onConnect) ──
  const allNodesRef = useRef(allNodes)
  allNodesRef.current = allNodes

  const allEdgesRef = useRef(allEdges)
  allEdgesRef.current = allEdges

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
                onClose: useCanvasStore.getState().closeNote,
                onDelete: useCanvasStore.getState().deleteNote,
                onSpawnLinkedNote: useCanvasStore.getState().spawnLinkedNote,
                onNavigateToNote: useCanvasStore.getState().focusNoteOnCanvas
              }
            }
          }
          // Inject close/delete callbacks into draw data
          if (n.type === 'draw') {
            return {
              ...n,
              data: { ...n.data, onClose: useCanvasStore.getState().closeDraw, onDelete: useCanvasStore.getState().deleteDraw }
            }
          }
          // Inject close callback into diff viewer data
          if (n.type === 'diffViewer') {
            return {
              ...n,
              data: { ...n.data, onClose: (sid: string) => useCanvasStore.getState().removeTileFromCanvas(sid) }
            }
          }
          // Inject close callback into devtools data
          if (n.type === 'devTools') {
            return {
              ...n,
              data: { ...n.data, onClose: (sid: string) => useCanvasStore.getState().removeTileFromCanvas(sid) }
            }
          }
          return n
        }),
    [allNodes, tileWorkspaceMap, activeWorkspaceId, focusedDevToolsLinkedBrowser]
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
        const terminalWs = useCanvasStore.getState().tileWorkspaceMap.get(terminalId)
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
        useCanvasStore.getState().setActiveWorkspaceId(data.activeWorkspaceId)
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

      // Reconstruct note->terminal edges now that terminal nodes exist
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
      const currentTileWorkspaceMap = useCanvasStore.getState().tileWorkspaceMap
      const terminalNodes = allNodesRef.current.filter((n) => n.type === 'terminal')
      const layout = terminalNodes.map((n) => ({
        sessionId: (n.data as { sessionId: string }).sessionId,
        position: n.position,
        width: (n.style?.width as number) ?? 640,
        height: (n.style?.height as number) ?? 400,
        workspaceId: currentTileWorkspaceMap.get((n.data as { sessionId: string }).sessionId) ?? 'default'
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
          workspaceId: currentTileWorkspaceMap.get(d.sessionId) ?? 'default',
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
      setFocusedId(useCanvasStore.getState().focusedId === id ? null : useCanvasStore.getState().focusedId)
    })
    return unsub
  }, [])

  // ── IPC listeners for browser/terminal tile management ──
  useEffect(() => {
    const unsub = window.terminal.onBrowserRequest((terminalId, url, reservationId, width, height) => {
      useCanvasStore.getState().addBrowserForTerminal(terminalId, url, reservationId, width, height)
    })
    return unsub
  }, [])

  // Open a browser tile when a link is clicked in a terminal
  useEffect(() => {
    return onBrowserOpenRequest((terminalId, url) => {
      useCanvasStore.getState().addBrowserForTerminal(terminalId, url)
    })
  }, [])

  // ── Spawn a terminal tile linked to another terminal (agent orchestration) ──
  useEffect(() => {
    const unsub = window.terminal.onTerminalSpawn((info) => {
      useCanvasStore.getState().addTerminalForTerminal(info)
    })
    return unsub
  }, [])

  // Handle Cmd+R / Ctrl+R / F5 — globalShortcut in the main process intercepts
  // the key at the OS level and sends IPC here. Reload the focused browser tile.
  useEffect(() => {
    const unsub = window.browser.onRefreshFocused(() => {
      const currentFocusedId = useCanvasStore.getState().focusedId
      if (!currentFocusedId) return
      const node = useCanvasStore.getState().allNodes.find(
        (n) => (n.data as Record<string, unknown>).sessionId === currentFocusedId
      )
      if (node?.type === 'browser') {
        reloadBrowser(currentFocusedId)
      }
    })
    return unsub
  }, [])

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

  const onPaneClick = useCallback(() => {
    setFocusedId(null)
  }, [])

  // ── Agent-driven draw tile creation ──
  useEffect(() => {
    const unsub = window.draw.onDrawOpen((info) => {
      useCanvasStore.getState().addDrawAt(undefined, info.terminalId)
    })
    return unsub
  }, [])

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
      const safePos = snapToGrid(position, useCanvasStore.getState().allNodes, 640, 400, settings.canvas.tileGap)
      useCanvasStore.getState().addTerminalAt(safePos)
    },
    [screenToFlowPosition, settings.canvas.tileGap]
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
        // Don't clear killHighlight here -- let keyup handle it
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

  // ── Context + render ──

  const focusCtx = useMemo(
    () => ({
      focusedId,
      setFocusedId: useCanvasStore.getState().setFocusedId,
      killTerminal: useCanvasStore.getState().killTile,
      killHighlight,
      toggleDiffViewer: useCanvasStore.getState().toggleDiffViewer,
      hasDiffViewer: useCanvasStore.getState().hasDiffViewer,
      toggleDevTools: useCanvasStore.getState().toggleDevTools,
      hasDevTools: useCanvasStore.getState().hasDevTools,
      renameTile: useCanvasStore.getState().renameTile
    }),
    [focusedId, killHighlight]
  )

  const navigateToNote = useCallback(
    (noteId: string) => {
      const wsId = tileWorkspaceMap.get(noteId)
      if (wsId) {
        useCanvasStore.getState().focusProcess(wsId, noteId)
      }
    },
    [tileWorkspaceMap]
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

      useCanvasStore.getState().focusTile(tileIds[nextIndex])
    },
    [visibleNodes, tileWorkspaceMap, activeWorkspaceId, focusedId]
  )

  const hotkeyActions = useMemo<Record<HotkeyAction, () => void>>(
    () => ({
      toggleProcessPanel: togglePanel,
      toggleWorkspacePanel: toggleWorkspacePanel,
      toggleMinimap: () => {
        updateSettings({ canvas: { ...settings.canvas, minimapEnabled: !settings.canvas.minimapEnabled } })
      },
      newTerminal: () => useCanvasStore.getState().addTerminalAt(),
      newBrowser: () => useCanvasStore.getState().addBrowserAt(),
      newNote: () => useCanvasStore.getState().addNoteAt(),
      newDraw: () => useCanvasStore.getState().addDrawAt(),
      openSettings: () => setSettingsOpen(true),
      cycleFocusForward: () => cycleFocus(1),
      cycleFocusBackward: () => cycleFocus(-1),
      killFocused: () => {
        const currentFocusedId = useCanvasStore.getState().focusedId
        if (!currentFocusedId) return
        const node = useCanvasStore.getState().allNodes.find(
          (n) => (n.data as Record<string, unknown>).sessionId === currentFocusedId
        )
        if (node?.type === 'notes') {
          useCanvasStore.getState().closeNote(currentFocusedId)
        } else {
          useCanvasStore.getState().killTile(currentFocusedId)
        }
      },
      openInIde: async () => {
        const currentFocusedId = useCanvasStore.getState().focusedId
        if (!currentFocusedId) return
        const status = await window.terminal.getStatus(currentFocusedId)
        if (!status) return
        const worktree = status.metadata?.worktree as { path?: string } | undefined
        const targetPath = worktree?.path || status.cwd
        if (targetPath) {
          window.ide.open(targetPath)
        }
      },
      togglePomodoro
    }),
    [togglePanel, toggleWorkspacePanel, updateSettings, settings.canvas, cycleFocus, togglePomodoro]
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
  // terminals -> browsers (active workspace) -> notes
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

      // Any other key while timer is pending -> cancel (it's a Ctrl+X combo)
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
            useCanvasStore.getState().focusTile(sessionId)
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
  }, [jumpMode, jumpAssignments])

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

      // Any other key while timer is pending -> cancel
      if (!wsJumpMode) {
        clearTimer()
        return
      }

      // In workspace jump mode: Alt+key switches workspace
      // On macOS, Alt+letter produces special characters (e.g., a for Alt+A),
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
            useCanvasStore.getState().selectWorkspace(wsId)
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
  }, [wsJumpMode, wsJumpAssignments])

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
            <NotificationCenter onFocusTerminal={(id) => useCanvasStore.getState().focusTile(id)} />
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
            onSelect={(id) => useCanvasStore.getState().selectWorkspace(id)}
            onFocusProcess={(wsId, sid) => useCanvasStore.getState().focusProcess(wsId, sid)}
            onAdd={() => useCanvasStore.getState().addWorkspace()}
            onRemove={(id) => useCanvasStore.getState().removeWorkspace(id)}
            onRename={(id, name) => useCanvasStore.getState().renameWorkspace(id, name)}
            onSetPath={(id) => useCanvasStore.getState().setWorkspacePath(id)}
            onSetDefaultUrl={(id, url) => useCanvasStore.getState().setWorkspaceDefaultUrl(id, url)}
            open={workspacePanelOpen}
            onToggle={toggleWorkspacePanel}
            jumpHints={wsJumpAssignments}
          />

          <OffscreenIndicators
            nodes={visibleNodes}
            focusedId={focusedId}
            onFocus={(id) => useCanvasStore.getState().focusTile(id)}
          />

          <ProcessPanel
            nodes={visibleNodes}
            edges={visibleEdges}
            focusedId={focusedId}
            onFocus={(id) => useCanvasStore.getState().focusTile(id)}
            onFocusProcess={(wsId, sid) => useCanvasStore.getState().focusProcess(wsId, sid)}
            onKill={(id) => useCanvasStore.getState().killTile(id)}
            onCloseNote={(id) => useCanvasStore.getState().closeNote(id)}
            onDeleteNote={(id) => useCanvasStore.getState().deleteNote(id)}
            onAddTerminal={() => useCanvasStore.getState().addTerminalAt()}
            onAddBrowser={() => useCanvasStore.getState().addBrowserAt()}
            onAddNote={() => useCanvasStore.getState().addNoteAt()}
            onAddDraw={() => useCanvasStore.getState().addDrawAt()}
            onCloseDraw={(id) => useCanvasStore.getState().closeDraw(id)}
            onDeleteDraw={(id) => useCanvasStore.getState().deleteDraw(id)}
            onSpawnTemplate={(tmpl, origin) => useCanvasStore.getState().spawnTemplate(tmpl, origin)}
            open={panelOpen}
            onToggle={togglePanel}
            tileWorkspaceMap={tileWorkspaceMap}
            workspaces={workspaces}
            activeWorkspaceId={activeWorkspaceId}
            jumpHints={jumpAssignments}
          />
          <NotificationToast onFocusTerminal={(id) => useCanvasStore.getState().focusTile(id)} />

          {/* Right-click context menu */}
          {contextMenu && (
            <div
              className="fixed z-50 min-w-[160px] rounded-md border border-zinc-700 bg-zinc-800 py-1 shadow-xl"
              style={{ left: contextMenu.x, top: contextMenu.y }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => {
                  const safePos = snapToGrid(contextMenu.flowPos, useCanvasStore.getState().allNodes, 640, 400, settings.canvas.tileGap)
                  useCanvasStore.getState().addTerminalAt(safePos)
                  setContextMenu(null)
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-zinc-300 hover:bg-zinc-700"
              >
                <span className="h-2 w-2 rounded-full bg-green-500" />
                Terminal
              </button>
              <button
                onClick={() => {
                  const safePos = snapToGrid(contextMenu.flowPos, useCanvasStore.getState().allNodes, 800, 600, settings.canvas.tileGap)
                  useCanvasStore.getState().addBrowserAt(safePos)
                  setContextMenu(null)
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-zinc-300 hover:bg-zinc-700"
              >
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                Browser
              </button>
              <button
                onClick={() => {
                  const safePos = snapToGrid(contextMenu.flowPos, useCanvasStore.getState().allNodes, 400, 400, settings.canvas.tileGap)
                  useCanvasStore.getState().addNoteAt(safePos)
                  setContextMenu(null)
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-zinc-300 hover:bg-zinc-700"
              >
                <span className="h-2 w-2 rounded-full bg-amber-400" />
                Note
              </button>
              <button
                onClick={() => {
                  const safePos = snapToGrid(contextMenu.flowPos, useCanvasStore.getState().allNodes, 800, 600, settings.canvas.tileGap)
                  useCanvasStore.getState().addDrawAt(safePos)
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
                        useCanvasStore.getState().spawnTemplate(tmpl, contextMenu.flowPos)
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
