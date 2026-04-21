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
import { PlanTile } from './PlanTile'
import { TaskTile } from './TaskTile'
import { DiffViewerTile } from './DiffViewerTile'
import { DevToolsTile } from './DevToolsTile'
import { DrawTile } from './draw/DrawTile'
import { ImageTile } from './ImageTile'
import { NotificationToast } from './NotificationToast'
import { UpdateBanner } from './UpdateBanner'
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
import { ClaudeUsageWidget } from './ClaudeUsageWidget'
import { usePomodoro, PomodoroContext } from '@/hooks/usePomodoro'
import { DEFAULT_WORKSPACE } from '@/types/workspace'
import { useSettings } from '@/hooks/useSettings'
import { useResolvedTemplates } from '@/hooks/useResolvedTemplates'
import { useHotkeys } from '@/hooks/useHotkeys'
import type { HotkeyAction } from '@/types/settings'
import { SettingsPage } from './SettingsPage'
import { VoiceIndicator } from './VoiceIndicator'
import { DictationPanel } from './DictationPanel'
import { VoiceNumberOverlay } from './VoiceNumberOverlay'
import { VoiceGridOverlay } from './VoiceGridOverlay'
import { useVoice } from '@/hooks/useVoice'
import { useCanvasStore, snapToGrid } from '@/store/canvas-store'
import { useFlowMuteStore } from '@/store/flow-mute-store'
import { useActivityTracker } from '@/hooks/useActivityTracker'
import { CommandPalette } from './palette/CommandPalette'
import { PALETTE_ACTION_EVENT, type PaletteUiAction } from '@/lib/palette-commands'
import { TaskLens } from './TaskLens'

const nodeTypes: NodeTypes = {
  terminal: TerminalTile as unknown as NodeTypes['terminal'],
  browser: BrowserTile as unknown as NodeTypes['browser'],
  notes: NotesTile as unknown as NodeTypes['notes'],
  plan: PlanTile as unknown as NodeTypes['plan'],
  task: TaskTile as unknown as NodeTypes['task'],
  diffViewer: DiffViewerTile as unknown as NodeTypes['diffViewer'],
  devTools: DevToolsTile as unknown as NodeTypes['devTools'],
  draw: DrawTile as unknown as NodeTypes['draw'],
  image: ImageTile as unknown as NodeTypes['image']
}

const MINIMAP_NODE_COLORS: Record<string, string> = {
  terminal: '#22c55e',
  browser:  '#3b82f6',
  notes:    '#f59e0b',
  plan:     '#14b8a6',
  task:     '#eab308',
  diffViewer: '#a855f7',
  devTools:   '#f97316',
  draw:       '#ec4899',
  image:      '#06b6d4',
}

export function styleForEdgeKind(kind: string | undefined): React.CSSProperties {
  switch (kind) {
    case 'has-plan':
      return { stroke: '#a855f7', strokeWidth: 2 }
    case 'executing-in':
      return { stroke: '#3b82f6', strokeWidth: 2 }
    case 'research-output':
      return { stroke: '#f59e0b', strokeWidth: 2, strokeDasharray: '4 3' }
    case 'linked-pr':
      return { stroke: '#22c55e', strokeWidth: 2 }
    case 'depends-on':
      return { stroke: '#ef4444', strokeWidth: 2 }
    default:
      return { stroke: '#737373', strokeWidth: 1 }
  }
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
  const { resolvedTemplates } = useResolvedTemplates(settings.templates)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [taskLensOpen, setTaskLensOpen] = useState(false)
  const pomodoro = usePomodoro()
  const [pomodoroExpanded, setPomodoroExpanded] = useState(false)
  const togglePomodoro = useCallback(() => setPomodoroExpanded((o) => !o), [])

  // ── Voice ──
  const voice = useVoice(settings.voice)

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

  // ── Flow-mute wiring ──
  useActivityTracker()

  useEffect(() => {
    useFlowMuteStore.getState().setSettings(settings.flowMute)
  }, [settings.flowMute])

  useEffect(() => {
    useFlowMuteStore.getState().setFocus(focusedId)
  }, [focusedId])

  useEffect(() => {
    const interval = setInterval(() => {
      useFlowMuteStore.getState().tick()
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  // Exit flow if the target tile is removed (killed, crashed, etc.)
  useEffect(() => {
    const fm = useFlowMuteStore.getState()
    if (fm.mode === 'off' || !fm.targetId) return
    const exists = allNodes.some(
      (n) => (n.data as Record<string, unknown>).sessionId === fm.targetId
    )
    if (!exists) {
      fm.exitFlow({ reason: 'tile-killed', replay: true })
    }
  }, [allNodes])

  // Push flow-mute snapshot to main so it can suppress native OS notifications
  // without an IPC round-trip per notification.
  const flowMuteMode = useFlowMuteStore(s => s.mode)
  const flowMuteTarget = useFlowMuteStore(s => s.targetId)
  useEffect(() => {
    const flowGroupIds: string[] = []
    if (flowMuteMode === 'active' && flowMuteTarget) {
      flowGroupIds.push(flowMuteTarget)
      for (const e of allEdges) {
        if (e.source === flowMuteTarget) flowGroupIds.push(e.target)
        else if (e.target === flowMuteTarget) flowGroupIds.push(e.source)
      }
    }
    window.flowMute.updateMirror({
      enabled: settings.flowMute?.enabled ?? true,
      active: flowMuteMode === 'active',
      suppressNative: settings.flowMute?.suppressNative ?? true,
      flowGroupIds
    })
  }, [flowMuteMode, flowMuteTarget, allEdges, settings.flowMute?.enabled, settings.flowMute?.suppressNative])

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

  // ── Flow-mute ring: tiles in the active flow group get a className that CSS hooks. ──
  const flowTargetId = useFlowMuteStore(s => s.mode === 'active' ? s.targetId : null)
  const flowRingEnabled = useFlowMuteStore(s => s.settings.enabled && s.settings.showRing)
  const flowGroup = useMemo(() => {
    if (!flowTargetId || !flowRingEnabled) return new Set<string>()
    const group = new Set<string>([flowTargetId])
    for (const e of allEdges) {
      if (e.source === flowTargetId) group.add(e.target)
      else if (e.target === flowTargetId) group.add(e.source)
    }
    return group
  }, [flowTargetId, flowRingEnabled, allEdges])

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
          // Inject delete callback into image data
          if (n.type === 'image') {
            return {
              ...n,
              data: { ...n.data, onDelete: useCanvasStore.getState().deleteImage }
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
        })
        .map((n) => flowGroup.has(n.id)
          ? { ...n, className: [n.className, 'flow-ring'].filter(Boolean).join(' ') }
          : n),
    [allNodes, tileWorkspaceMap, activeWorkspaceId, focusedDevToolsLinkedBrowser, flowGroup]
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
              } else if (n.type === 'image') {
                const sid = (n.data as Record<string, unknown>).sessionId as string
                const w = (n.style?.width as number) ?? 500
                const h = (n.style?.height as number) ?? 400
                window.image.save(sid, {
                  position: n.position,
                  width: n.measured?.width ?? w,
                  height: n.measured?.height ?? h
                })
              } else if (n.type === 'plan') {
                const sid = (n.data as Record<string, unknown>).sessionId as string
                const w = (n.style?.width as number) ?? 480
                const h = (n.style?.height as number) ?? 560
                window.plan.move(sid, n.position)
                window.plan.resize(sid, n.measured?.width ?? w, n.measured?.height ?? h)
              } else if (n.type === 'task') {
                const taskId = (n.data as Record<string, unknown>).taskId as string
                const w = (n.style?.width as number) ?? 420
                const h = (n.style?.height as number) ?? 440
                window.task.save(taskId, {
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

  // ── Load persisted plans on mount + subscribe to plan events ──
  useEffect(() => {
    window.plan.list().then((plans) => {
      const planMetas = plans.filter((p) => !p.isSoftDeleted)
      // Build nodes for each plan and edges for linkedTerminalId + linkedExecutorTerminalId + latest critique.
      const planNodes: Node[] = []
      const planEdges: Edge[] = []
      const wsMapEntries: [string, string][] = []

      ;(async () => {
        for (const meta of planMetas) {
          planNodes.push({
            id: meta.planId,
            type: 'plan',
            position: meta.position,
            style: { width: meta.width, height: meta.height },
            data: {
              sessionId: meta.planId,
              label: meta.label,
              linkedTerminalId: meta.linkedTerminalId
            },
            dragHandle: '.plan-tile-header'
          })
          wsMapEntries.push([meta.planId, meta.workspaceId])

          // Edges
          if (meta.linkedTerminalId) {
            planEdges.push({
              id: `edge-plan-auth-${meta.planId}`,
              source: meta.linkedTerminalId,
              target: meta.planId,
              animated: true,
              style: { stroke: '#737373', strokeWidth: 1 }
            })
          }
          if (meta.linkedExecutorTerminalId) {
            planEdges.push({
              id: `edge-plan-exec-${meta.planId}`,
              source: meta.planId,
              target: meta.linkedExecutorTerminalId,
              animated: true,
              style: { stroke: '#06b6d4', strokeWidth: 2 }
            })
          }

          // Latest critique note: load the full doc to get critiqueNoteIds
          try {
            const doc = await window.plan.load(meta.planId)
            if (doc && doc.critiqueNoteIds.length > 0) {
              const latest = doc.critiqueNoteIds[doc.critiqueNoteIds.length - 1]
              planEdges.push({
                id: `edge-plan-critique-${meta.planId}`,
                source: meta.planId,
                target: latest.noteId,
                animated: true,
                style: { stroke: '#f59e0b', strokeWidth: 2 }
              })
            }
          } catch {
            // skip
          }
        }

        setAllNodes((nds) => {
          const existing = new Set(nds.map((n) => n.id))
          const toAdd = planNodes.filter((n) => !existing.has(n.id))
          return toAdd.length > 0 ? [...nds, ...toAdd] : nds
        })
        if (wsMapEntries.length > 0) {
          setTileWorkspaceMap((prev) => {
            const next = new Map(prev)
            for (const [sid, wsId] of wsMapEntries) next.set(sid, wsId)
            return next
          })
        }
        if (planEdges.length > 0) {
          setAllEdges((eds) => {
            const existing = new Set(eds.map((e) => e.id))
            const toAdd = planEdges.filter((e) => !existing.has(e.id))
            return toAdd.length > 0 ? [...eds, ...toAdd] : eds
          })
        }
        setNodesLoadedFlags((prev) => ({ ...prev, plans: true }))
      })()
    }).catch(() => {
      setNodesLoadedFlags((prev) => ({ ...prev, plans: true }))
    })

    // ── Load persisted task tiles ──
    window.task.list().then(async (tasks) => {
      const taskNodes: Node[] = []
      const wsMapEntries: Array<[string, string]> = []
      for (const t of tasks) {
        if (t.meta.isSoftDeleted) continue
        const derived = await window.task.deriveState(t.meta.taskId)
        taskNodes.push({
          id: t.meta.taskId,
          type: 'task',
          position: t.meta.position,
          style: { width: t.meta.width, height: t.meta.height },
          data: {
            sessionId: t.meta.taskId,
            taskId: t.meta.taskId,
            label: t.meta.label,
            classification: t.meta.classification,
            timelinePressure: t.meta.timelinePressure,
            derivedState: derived?.state ?? 'raw'
          }
        })
        wsMapEntries.push([t.meta.taskId, t.meta.workspaceId])
      }
      setAllNodes((nds) => {
        const existing = new Set(nds.map((n) => n.id))
        const toAdd = taskNodes.filter((n) => !existing.has(n.id))
        return toAdd.length > 0 ? [...nds, ...toAdd] : nds
      })
      if (wsMapEntries.length > 0) {
        setTileWorkspaceMap((prev) => {
          const next = new Map(prev)
          for (const [sid, wsId] of wsMapEntries) next.set(sid, wsId)
          return next
        })
      }
      setNodesLoadedFlags((prev) => ({ ...prev, tasks: true }))
    }).catch(() => {
      setNodesLoadedFlags((prev) => ({ ...prev, tasks: true }))
    })

    // Subscribe to task events
    const offTaskOpen = window.task.onTaskOpen(async (info) => {
      if (!info.taskId) return
      const file = info.meta ? { meta: info.meta } : await window.task.load(info.taskId)
      if (!file) return
      const meta = file.meta
      const derived = await window.task.deriveState(meta.taskId)
      setAllNodes((nds) => {
        if (nds.some((n) => n.id === meta.taskId)) return nds
        return [
          ...nds,
          {
            id: meta.taskId,
            type: 'task',
            position: meta.position,
            style: { width: meta.width, height: meta.height },
            data: {
              sessionId: meta.taskId,
              taskId: meta.taskId,
              label: meta.label,
              classification: meta.classification,
              timelinePressure: meta.timelinePressure,
              derivedState: derived?.state ?? 'raw'
            }
          }
        ]
      })
      setTileWorkspaceMap((prev) => {
        const next = new Map(prev)
        next.set(meta.taskId, meta.workspaceId)
        return next
      })
    })
    const offTaskClose = window.task.onTaskClose(({ taskId }) => {
      setAllNodes((nds) => nds.filter((n) => n.id !== taskId))
    })
    const offTaskDelete = window.task.onTaskDelete(({ taskId }) => {
      setAllNodes((nds) => nds.filter((n) => n.id !== taskId))
    })
    const offTaskUpdate = window.task.onTaskUpdate(async ({ taskId: id }) => {
      const file = await window.task.load(id)
      const derived = await window.task.deriveState(id)
      if (!file) return
      setAllNodes((nds) =>
        nds.map((n) =>
          n.id === id
            ? {
                ...n,
                data: {
                  ...(n.data as Record<string, unknown>),
                  label: file.meta.label,
                  classification: file.meta.classification,
                  timelinePressure: file.meta.timelinePressure,
                  derivedState: derived?.state ?? 'raw'
                }
              }
            : n
        )
      )
    })
    const offTaskStateChange = window.task.onTaskStateChange(({ taskId: id, state }) => {
      setAllNodes((nds) =>
        nds.map((n) =>
          n.id === id
            ? { ...n, data: { ...(n.data as Record<string, unknown>), derivedState: state } }
            : n
        )
      )
    })
    const offTaskLink = window.task.onTaskLink((edge) => {
      // Defer until after current reconcile so both endpoints are fully
      // measured in ReactFlow's internal store before the edge is added;
      // otherwise ReactFlow logs error 008 and can't resolve handles.
      requestAnimationFrame(() => {
        setAllEdges((eds) => {
          if (eds.some((e) => e.id === edge.id)) return eds
          return [
            ...eds,
            {
              id: edge.id,
              source: edge.source,
              target: edge.target,
              sourceHandle: null,
              targetHandle: null,
              animated: true,
              style: styleForEdgeKind(edge.kind),
              data: { kind: edge.kind }
            }
          ]
        })
      })
    })

    // ── Subscribe to plan events to add/update/remove tiles live ──
    const offOpen = window.plan.onOpen((info) => {
      const meta = info.meta
      setAllNodes((nds) => {
        if (nds.some((n) => n.id === meta.planId)) return nds
        return [
          ...nds,
          {
            id: meta.planId,
            type: 'plan',
            position: meta.position,
            style: { width: meta.width, height: meta.height },
            data: {
              sessionId: meta.planId,
              label: meta.label,
              linkedTerminalId: meta.linkedTerminalId
            },
            dragHandle: '.plan-tile-header'
          }
        ]
      })
      setTileWorkspaceMap((prev) => {
        const next = new Map(prev)
        next.set(meta.planId, meta.workspaceId)
        return next
      })
      if (meta.linkedTerminalId) {
        setAllEdges((eds) => {
          const edgeId = `edge-plan-auth-${meta.planId}`
          if (eds.some((e) => e.id === edgeId)) return eds
          return [
            ...eds,
            {
              id: edgeId,
              source: meta.linkedTerminalId!,
              target: meta.planId,
              animated: true,
              style: { stroke: '#737373', strokeWidth: 1 }
            }
          ]
        })
      }
    })

    // Handle state changes that may change edges (executor attached, critique appeared)
    const offState = window.plan.onState((info) => {
      const planId = info.planId
      const executorId = info.executorTerminalId as string | undefined
      const critiqueId = info.critiqueNoteId as string | undefined
      if (executorId) {
        setAllEdges((eds) => {
          const edgeId = `edge-plan-exec-${planId}`
          if (eds.some((e) => e.id === edgeId)) return eds
          return [
            ...eds,
            {
              id: edgeId,
              source: planId,
              target: executorId,
              animated: true,
              style: { stroke: '#06b6d4', strokeWidth: 2 }
            }
          ]
        })
      }
      if (critiqueId) {
        setAllEdges((eds) => {
          // Remove prior critique edge for this plan; render only the latest.
          const filtered = eds.filter((e) => !e.id.startsWith(`edge-plan-critique-${planId}`))
          return [
            ...filtered,
            {
              id: `edge-plan-critique-${planId}`,
              source: planId,
              target: critiqueId,
              animated: true,
              style: { stroke: '#f59e0b', strokeWidth: 2 }
            }
          ]
        })
      }
    })

    const offDeleted = window.plan.onDeleted((info) => {
      setAllNodes((nds) => nds.filter((n) => n.id !== info.planId))
      setAllEdges((eds) => eds.filter((e) => e.source !== info.planId && e.target !== info.planId))
    })

    return () => {
      offOpen()
      offState()
      offDeleted()
      offTaskOpen()
      offTaskClose()
      offTaskDelete()
      offTaskLink()
      offTaskUpdate()
      offTaskStateChange()
    }
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
              metadata: pt.metadata,
              command: pt.command
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

  // ── Load persisted image tiles on mount ──
  useEffect(() => {
    window.image.list().then((imageFiles) => {
      const imagesToRestore = imageFiles.filter((img) => !img.meta.isSoftDeleted)
      if (imagesToRestore.length === 0) return

      setAllNodes((nds) => {
        const existingIds = new Set(nds.map((n) => n.id))
        const newNodes: Node[] = []
        const wsMapEntries: [string, string][] = []

        for (const img of imagesToRestore) {
          const { imageId, label, workspaceId, position, width, height, storedFilename } = img.meta
          if (existingIds.has(imageId)) continue
          newNodes.push({
            id: imageId,
            type: 'image',
            position,
            style: { width, height },
            data: { sessionId: imageId, label, imagePath: storedFilename },
            dragHandle: '.image-tile-header'
          })
          wsMapEntries.push([imageId, workspaceId])
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
    })
  }, [])

  // ── Load persisted edges once all nodes are ready ──
  useEffect(() => {
    if (!nodesLoadedFlags.notes || !nodesLoadedFlags.terminals || !nodesLoadedFlags.browsers || !nodesLoadedFlags.draws || !nodesLoadedFlags.plans || !nodesLoadedFlags.tasks) return

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
          style: e.style as React.CSSProperties | undefined,
          data: { ...(e.data ?? {}), kind: e.kind ?? 'legacy' }
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
        workspaceId: currentTileWorkspaceMap.get((n.data as { sessionId: string }).sessionId) ?? 'default',
        command: (n.data as { command?: string }).command
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
      const edgesToSave = allEdgesRef.current.map((e) => {
        const edgeData = (e.data ?? {}) as { kind?: string }
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          kind: (edgeData.kind ?? 'legacy') as
            | 'has-plan'
            | 'executing-in'
            | 'research-output'
            | 'linked-pr'
            | 'depends-on'
            | 'legacy',
          sourceHandle: e.sourceHandle,
          targetHandle: e.targetHandle,
          animated: e.animated,
          style: e.style,
          data: e.data as Record<string, unknown> | undefined
        }
      })
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

  // ── Spawn a template via API (POST /api/template/spawn) ──
  useEffect(() => {
    const unsub = window.terminal.onTemplateSpawn((info) => {
      const templates = resolvedTemplates
      const match = info.templateId
        ? templates.find((t) => t.id === info.templateId)
        : templates.find((t) => t.name.toLowerCase() === info.templateName?.toLowerCase())
      if (match) {
        useCanvasStore.getState().spawnTemplate(match, info.origin)
      }
    })
    return unsub
  }, [resolvedTemplates])

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

  // ── Agent-driven note tile creation ──
  useEffect(() => {
    const unsub = window.note.onNoteOpen((info) => {
      useCanvasStore.getState().addNoteForApi(info)
    })
    return unsub
  }, [])

  // ── Agent-driven note content update ──
  useEffect(() => {
    const unsub = window.note.onNoteUpdate((info) => {
      window.dispatchEvent(new CustomEvent('api:note-updated', { detail: { noteId: info.noteId } }))
    })
    return unsub
  }, [])

  // ── Agent-driven note soft-delete ──
  useEffect(() => {
    const unsub = window.note.onNoteClose((info) => {
      useCanvasStore.getState().closeNote(info.noteId)
    })
    return unsub
  }, [])

  // ── Agent-driven note hard-delete ──
  useEffect(() => {
    const unsub = window.note.onNoteDelete((info) => {
      useCanvasStore.getState().deleteNote(info.noteId)
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

  // ── Canvas-level image drag-and-drop ──
  const IMAGE_EXTS = /\.(png|jpe?g|gif|webp|svg|bmp|tiff|ico)$/i
  const [imageDragPreview, setImageDragPreview] = useState<{ x: number; y: number } | null>(null)

  // Clear image drag preview whenever the drag moves over any tile node.
  // Uses a native capture-phase listener so it fires even when React synthetic
  // events are stopped by child components (e.g. TerminalTile's stopPropagation).
  useEffect(() => {
    const handler = (e: DragEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('.react-flow__node')) {
        setImageDragPreview(null)
      }
    }
    document.addEventListener('dragover', handler, { capture: true })
    return () => document.removeEventListener('dragover', handler, { capture: true })
  }, [])

  const onCanvasDragOver = useCallback(
    (event: React.DragEvent) => {
      if (!event.dataTransfer.types.includes('Files')) return
      const target = event.target as HTMLElement
      if (target.closest('.react-flow__node')) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
      setImageDragPreview({ x: event.clientX, y: event.clientY })
    },
    []
  )

  const onCanvasDragLeave = useCallback(
    (event: React.DragEvent) => {
      const related = event.relatedTarget as HTMLElement | null
      if (related && (event.currentTarget as HTMLElement).contains(related)) return
      setImageDragPreview(null)
    },
    []
  )

  const onCanvasDrop = useCallback(
    (event: React.DragEvent) => {
      setImageDragPreview(null)
      const target = event.target as HTMLElement
      if (target.closest('.react-flow__node')) return

      const files = Array.from(event.dataTransfer.files)
      const imageFiles = files.filter((f) =>
        f.type.startsWith('image/') || IMAGE_EXTS.test(f.name)
      )
      if (imageFiles.length === 0) return

      event.preventDefault()
      const flowPos = screenToFlowPosition({ x: event.clientX, y: event.clientY })

      for (const file of imageFiles) {
        const path = window.fileUtils.getPathForFile(file)
        if (!path) continue
        useCanvasStore.getState().addImageAt(flowPos, path)
      }
    },
    [screenToFlowPosition]
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
      togglePomodoro,
      toggleVoice: () => {
        if (voice.mode === 'idle') voice.startListening()
        else voice.stopListening()
      },
      zoomToFocused: () => useCanvasStore.getState().zoomToFocused(),
      toggleFlow: () => {
        const fm = useFlowMuteStore.getState()
        if (!fm.settings.enabled) return
        if (fm.mode === 'active') {
          fm.exitFlow({ reason: 'manual', replay: true })
          return
        }
        const currentFocusedId = useCanvasStore.getState().focusedId
        if (!currentFocusedId) return
        fm.enterFlow(currentFocusedId, { manual: true })
      },
      exitFlowReplay: () => {
        const fm = useFlowMuteStore.getState()
        if (fm.mode === 'off') return
        fm.exitFlow({ reason: 'manual', replay: true })
      },
      openPalette: () => useCanvasStore.getState().togglePalette()
    }),
    [togglePanel, toggleWorkspacePanel, updateSettings, settings.canvas, cycleFocus, togglePomodoro, voice]
  )

  useHotkeys(settings.hotkeys, hotkeyActions)

  // Task Lens toggle: Cmd+Shift+T
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      const modifier = navigator.platform.includes('Mac') ? e.metaKey : e.ctrlKey
      if (modifier && e.shiftKey && (e.key === 'T' || e.key === 't')) {
        e.preventDefault()
        setTaskLensOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // ── Palette-dispatched UI actions ──
  // Commands registry (`>` prefix) emits CustomEvents for toggles/actions that
  // live in Canvas.tsx local state; route them through the same hotkey actions.
  useEffect(() => {
    const handler = (e: Event) => {
      const action = (e as CustomEvent<{ action: PaletteUiAction }>).detail?.action
      if (!action) return
      const fn = hotkeyActions[action]
      if (fn) fn()
    }
    window.addEventListener(PALETTE_ACTION_EVENT, handler)
    return () => window.removeEventListener(PALETTE_ACTION_EVENT, handler)
  }, [hotkeyActions])

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
            <ClaudeUsageWidget />
            <NotificationCenter
              onFocusTerminal={(id) => {
                const s = useCanvasStore.getState()
                const wsId = s.tileWorkspaceMap.get(id)
                if (wsId) s.focusProcess(wsId, id)
                else s.focusTile(id)
              }}
            />
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
        <div
          className="relative flex-1 overflow-hidden"
          onDragOver={onCanvasDragOver}
          onDragLeave={onCanvasDragLeave}
          onDrop={onCanvasDrop}
        >
          {/* Image drop ghost preview */}
          {imageDragPreview && (
            <div
              className="fixed z-50 pointer-events-none"
              style={{ left: imageDragPreview.x - 250, top: imageDragPreview.y - 200 }}
            >
              <div className="w-[500px] h-[400px] rounded-lg border-2 border-dashed border-cyan-500/60 bg-cyan-500/5 flex flex-col items-center justify-center">
                <svg className="w-10 h-10 text-cyan-400 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z" />
                </svg>
                <span className="text-sm text-cyan-300 font-medium">Drop to create image tile</span>
              </div>
            </div>
          )}
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
            {settings.voice.enabled && (
              <>
                <VoiceIndicator
                  mode={voice.mode}
                  transcript={voice.transcript}
                  error={voice.error}
                  listeningSecondsLeft={voice.listeningSecondsLeft}
                  onConfirm={voice.confirm}
                  onCancel={voice.cancel}
                />
                <VoiceNumberOverlay
                  active={voice.numberOverlayActive}
                  tiles={voice.numberedTiles}
                  onDismiss={voice.dismissOverlay}
                />
                <VoiceGridOverlay
                  active={voice.gridOverlayActive}
                  onSelect={voice.selectGridRegion}
                  onDismiss={voice.dismissOverlay}
                />
                <DictationPanel
                  active={voice.dictationStreamActive}
                  streamingText={voice.dictationStreamText}
                  isSpeaking={voice.dictationStreamSpeaking}
                  isComplete={voice.dictationStreamComplete}
                  isConfirming={voice.dictationStreamConfirming}
                  confirmationMessage={voice.dictationStreamConfirmMsg}
                  heardText={voice.dictationStreamHeardText}
                  onSend={voice.sendDictationStream}
                  onCancel={voice.cancelDictationStream}
                  onStopDictation={voice.stopDictationStream}
                  onConfirm={voice.confirmDictationStream}
                  onReject={voice.rejectDictationStream}
                />
              </>
            )}
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
            onAddTerminal={(width, height, command, label) => useCanvasStore.getState().addTerminalAt(undefined, width, height, command, label)}
            onAddBrowser={() => useCanvasStore.getState().addBrowserAt()}
            onAddNote={() => useCanvasStore.getState().addNoteAt()}
            onAddDraw={() => useCanvasStore.getState().addDrawAt()}
            onCloseDraw={(id) => useCanvasStore.getState().closeDraw(id)}
            onDeleteDraw={(id) => useCanvasStore.getState().deleteDraw(id)}
            onDeleteImage={(id) => useCanvasStore.getState().deleteImage(id)}
            onSpawnTemplate={(tmpl, origin) => useCanvasStore.getState().spawnTemplate(tmpl, origin)}
            open={panelOpen}
            onToggle={togglePanel}
            tileWorkspaceMap={tileWorkspaceMap}
            workspaces={workspaces}
            activeWorkspaceId={activeWorkspaceId}
            jumpHints={jumpAssignments}
          />
          <NotificationToast
            onFocusTerminal={(id) => {
              const s = useCanvasStore.getState()
              const wsId = s.tileWorkspaceMap.get(id)
              if (wsId) s.focusProcess(wsId, id)
              else s.focusTile(id)
            }}
          />
          <UpdateBanner />

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
              {resolvedTemplates.length > 0 && (
                <>
                  <div className="my-1 border-t border-zinc-700" />
                  <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
                    Templates
                  </div>
                  {resolvedTemplates.map((tmpl) => (
                    <button
                      key={tmpl.id}
                      onClick={() => {
                        useCanvasStore.getState().spawnTemplate(tmpl, contextMenu.flowPos)
                        setContextMenu(null)
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-zinc-300 hover:bg-zinc-700"
                    >
                      <span className={`h-2 w-2 rounded-full ${tmpl.scope === 'project' ? 'bg-purple-500' : 'bg-blue-500'}`} />
                      {tmpl.name}
                    </button>
                  ))}
                </>
              )}
            </div>
          )}

          {/* Settings overlay */}
          {settingsOpen && <SettingsPage onClose={() => setSettingsOpen(false)} />}

          {/* Command palette */}
          <CommandPalette />

          {/* Task Lens sidebar */}
          {taskLensOpen && <TaskLens onClose={() => setTaskLensOpen(false)} />}
        </div>
      </div>
    </FocusedTerminalContext.Provider>
    </PomodoroContext.Provider>
  )
}
