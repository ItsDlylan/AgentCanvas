import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  useReactFlow,
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
import { ProcessPanel } from './ProcessPanel'
import { WorkspacePanel } from './WorkspacePanel'
import { OffscreenIndicators } from './OffscreenIndicators'
import { FocusedTerminalContext } from '@/hooks/useFocusedTerminal'
import { PanDetector } from './PanDetector'
import { navigateBrowser } from '@/hooks/useBrowserNavigation'
import { usePerformanceDebug, registerRender } from '@/hooks/usePerformanceDebug'
import { PerformanceOverlay } from './PerformanceOverlay'
import { BROWSER_CHROME_HEIGHT, BROWSER_CHROME_WIDTH, type DevicePreset } from '@/constants/devicePresets'
import { DEFAULT_WORKSPACE, type Workspace } from '@/types/workspace'

const nodeTypes: NodeTypes = {
  terminal: TerminalTile as unknown as NodeTypes['terminal'],
  browser: BrowserTile as unknown as NodeTypes['browser']
}

const defaultViewport = { x: 100, y: 100, zoom: 0.85 }

let tileCount = 0

const GAP = 40 // px between tiles when auto-placing

/** Find a position that doesn't overlap any existing node. */
function findOpenPosition(
  existingNodes: Node[],
  width: number,
  height: number,
  colSpan: number
): { x: number; y: number } {
  const stepX = width + GAP
  const stepY = height + GAP

  for (let slot = 0; slot < 200; slot++) {
    const candidate = {
      x: 100 + (slot % colSpan) * stepX,
      y: 100 + Math.floor(slot / colSpan) * stepY
    }
    const overlaps = existingNodes.some((n) => {
      const nw = (n.style?.width as number) ?? (n.type === 'browser' ? 800 : 640)
      const nh = (n.style?.height as number) ?? (n.type === 'browser' ? 600 : 400)
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
  height: number
): { x: number; y: number } {
  const stepX = width + GAP
  const stepY = height + GAP

  // Determine search center in grid coords
  const centerCol = Math.round((click.x - 100) / stepX)
  const centerRow = Math.round((click.y - 100) / stepY)

  const isOccupied = (c: number, r: number) => {
    const pos = { x: 100 + c * stepX, y: 100 + r * stepY }
    return existingNodes.some((n) => {
      const nw = (n.style?.width as number) ?? (n.type === 'browser' ? 800 : 640)
      const nh = (n.style?.height as number) ?? (n.type === 'browser' ? 600 : 400)
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

export default function Canvas() {
  registerRender('Canvas')
  const { enabled: perfEnabled, stats: perfStats } = usePerformanceDebug()

  // ── All nodes/edges (across all workspaces) ──
  const [allNodes, setAllNodes] = useState<Node[]>([])
  const [allEdges, setAllEdges] = useState<Edge[]>([])

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

  const tileWorkspaceMapRef = useRef(tileWorkspaceMap)
  tileWorkspaceMapRef.current = tileWorkspaceMap

  const activeWorkspaceIdRef = useRef(activeWorkspaceId)
  activeWorkspaceIdRef.current = activeWorkspaceId

  // ── Compute visible nodes/edges for active workspace ──
  // Browser nodes from ALL workspaces stay mounted so their webview + CDP connection
  // persists across workspace switches (agents can keep controlling them).
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
          return n
        }),
    [allNodes, tileWorkspaceMap, activeWorkspaceId]
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
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setAllNodes((nds) => applyNodeChanges(changes, nds))
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
    (params) => setAllEdges((eds) => addEdge(params, eds)),
    []
  )

  // ── Load workspaces on mount ──
  useEffect(() => {
    window.workspace.load().then((data) => {
      if (data) {
        setWorkspaces(data.workspaces)
        setActiveWorkspaceId(data.activeWorkspaceId)
      }
    })
  }, [])

  // ── Save workspaces when they change ──
  const workspacesLoaded = useRef(false)
  useEffect(() => {
    // Skip the initial render before load completes
    if (!workspacesLoaded.current) {
      workspacesLoaded.current = true
      return
    }
    window.workspace.save(workspaces, activeWorkspaceId)
  }, [workspaces, activeWorkspaceId])

  // ── Global terminal:exit listener (cleans up tiles even when hidden) ──
  useEffect(() => {
    const unsub = window.terminal.onExit((id) => {
      setAllNodes((nds) =>
        nds.filter((n) => (n.data as Record<string, unknown>).sessionId !== id)
      )
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
      } else {
        window.terminal.kill(sessionId)
      }
      setAllNodes((nds) =>
        nds.filter((n) => (n.data as Record<string, unknown>).sessionId !== sessionId)
      )
      setTileWorkspaceMap((prev) => {
        const next = new Map(prev)
        next.delete(sessionId)
        return next
      })
      setFocusedId((prev) => (prev === sessionId ? null : prev))
    },
    []
  )

  const addBrowserAt = useCallback(
    (position?: { x: number; y: number }, preset?: DevicePreset) => {
      tileCount++
      const sessionId = uuid()
      const tileW = preset ? preset.width + BROWSER_CHROME_WIDTH : 800
      const tileH = preset ? preset.height + BROWSER_CHROME_HEIGHT : 600
      const visible = visibleNodes
      const pos = position ?? findOpenPosition(visible, tileW, tileH, 3)
      const newNode: Node = {
        id: sessionId,
        type: 'browser',
        position: pos,
        style: { width: tileW, height: tileH },
        data: {
          sessionId,
          label: `Browser ${tileCount}`,
          initialUrl: 'https://www.google.com',
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

  const focusTerminal = useCallback(
    (sessionId: string) => {
      setFocusedId(sessionId)
      const node = allNodesRef.current.find(
        (n) => (n.data as Record<string, unknown>).sessionId === sessionId
      )
      if (!node) return
      const defaultW = node.type === 'browser' ? 800 : 640
      const defaultH = node.type === 'browser' ? 600 : 400
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
      const pos = position ?? findOpenPosition(visible, width, height, 4)

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

  const onDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      const target = event.target as HTMLElement
      if (!target.closest('.react-flow__pane')) return
      if (target.closest('.react-flow__node')) return
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY })
      const safePos = snapToGrid(position, allNodes, 640, 400)
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

  // ── Context + render ──

  const focusCtx = useMemo(
    () => ({ focusedId, setFocusedId, killTerminal }),
    [focusedId, killTerminal]
  )

  const activeWorkspace = useMemo(
    () => workspaces.find((w) => w.id === activeWorkspaceId) ?? DEFAULT_WORKSPACE,
    [workspaces, activeWorkspaceId]
  )

  const proOptions = useMemo(() => ({ hideAttribution: true }), [])
  const togglePanel = useCallback(() => setPanelOpen((o) => !o), [])
  const toggleWorkspacePanel = useCallback(() => setWorkspacePanelOpen((o) => !o), [])

  return (
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
          <div className="titlebar-no-drag flex items-center gap-2" />
        </div>

        {/* Canvas + Panels */}
        <div className="relative flex-1 overflow-hidden">
          <ReactFlow
            nodes={visibleNodes}
            edges={visibleEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onPaneClick={onPaneClick}
            onDoubleClick={onDoubleClick}
            nodeTypes={nodeTypes}
            defaultViewport={defaultViewport}
            proOptions={proOptions}
            minZoom={0.2}
            maxZoom={1.5}
            fitView={false}
            selectNodesOnDrag={false}
            panOnScroll
            panOnDrag={[1, 2]}
            zoomOnPinch
            zoomOnDoubleClick={false}
            selectionOnDrag
            deleteKeyCode="Delete"
            className="bg-zinc-950"
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#27272a" />
            <Controls
              showInteractive={false}
              className="!rounded-lg !border-zinc-700 !bg-zinc-800 [&>button]:!border-zinc-700 [&>button]:!bg-zinc-800 [&>button]:!fill-zinc-400 [&>button:hover]:!bg-zinc-700"
            />
            <PanDetector />
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
          />

          <OffscreenIndicators
            nodes={visibleNodes}
            focusedId={focusedId}
            onFocus={focusTerminal}
          />

          <ProcessPanel
            nodes={visibleNodes}
            focusedId={focusedId}
            onFocus={focusTerminal}
            onFocusProcess={handleFocusProcess}
            onKill={killTerminal}
            onAddTerminal={addTerminal}
            onAddBrowser={addBrowser}
            open={panelOpen}
            onToggle={togglePanel}
            tileWorkspaceMap={tileWorkspaceMap}
            workspaces={workspaces}
            activeWorkspaceId={activeWorkspaceId}
          />
        </div>
      </div>
    </FocusedTerminalContext.Provider>
  )
}
