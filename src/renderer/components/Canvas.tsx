import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node,
  type Edge,
  type NodeTypes,
  type OnConnect,
  addEdge
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { v4 as uuid } from 'uuid'
import { TerminalTile } from './TerminalTile'
import { BrowserTile } from './BrowserTile'
import { ProcessPanel } from './ProcessPanel'
import { OffscreenIndicators } from './OffscreenIndicators'
import { FocusedTerminalContext } from '@/hooks/useFocusedTerminal'
import { PanDetector } from './PanDetector'
import { navigateBrowser } from '@/hooks/useBrowserNavigation'
import { usePerformanceDebug, registerRender } from '@/hooks/usePerformanceDebug'
import { PerformanceOverlay } from './PerformanceOverlay'
import { BROWSER_CHROME_HEIGHT, BROWSER_CHROME_WIDTH, type DevicePreset } from '@/constants/devicePresets'

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

export default function Canvas() {
  registerRender('Canvas')
  const { enabled: perfEnabled, stats: perfStats } = usePerformanceDebug()
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const [panelOpen, setPanelOpen] = useState(true)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const { setCenter, screenToFlowPosition } = useReactFlow()

  const nodesRef = useRef(nodes)
  nodesRef.current = nodes

  const onConnect: OnConnect = useCallback(
    (params) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  )

  const killTerminal = useCallback(
    (sessionId: string) => {
      const node = nodesRef.current.find(
        (n) => (n.data as Record<string, unknown>).sessionId === sessionId
      )
      if (node?.type === 'browser') {
        window.browser.destroy(sessionId)
      } else {
        window.terminal.kill(sessionId)
      }
      setNodes((nds) =>
        nds.filter((n) => (n.data as Record<string, unknown>).sessionId !== sessionId)
      )
      setFocusedId((prev) => (prev === sessionId ? null : prev))
    },
    [setNodes]
  )

  const addBrowserAt = useCallback(
    (position?: { x: number; y: number }, preset?: DevicePreset) => {
      tileCount++
      const sessionId = uuid()
      const tileW = preset ? preset.width + BROWSER_CHROME_WIDTH : 800
      const tileH = preset ? preset.height + BROWSER_CHROME_HEIGHT : 600
      const pos = position ?? findOpenPosition(nodesRef.current, tileW, tileH, 3)
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
      setNodes((nds) => [...nds, newNode])
      setFocusedId(sessionId)
      setCenter(pos.x + tileW / 2, pos.y + tileH / 2, { zoom: 1, duration: 400 })
    },
    [setNodes, setCenter]
  )

  const addBrowser = useCallback((preset?: DevicePreset) => addBrowserAt(undefined, preset), [addBrowserAt])

  // Auto-spawn a browser tile linked to a terminal when agent-browser is detected
  const addBrowserForTerminal = useCallback(
    (terminalId: string, url: string, reservationId?: string, tileWidth?: number, tileHeight?: number) => {
      // Treat empty terminalId as unlinked
      const isLinked = terminalId && terminalId !== 'api'

      // If a browser already exists for this terminal, navigate it instead of spawning a new one
      if (isLinked) {
        const existing = nodesRef.current.find(
          (n) => n.type === 'browser' && (n.data as Record<string, unknown>).linkedTerminalId === terminalId
        )
        if (existing) {
          const existingSessionId = (existing.data as Record<string, unknown>).sessionId as string
          navigateBrowser(existingSessionId, url)
          setFocusedId(existingSessionId)
          return
        }
      }

      const terminalNode = nodesRef.current.find(
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

      setNodes((nds) => [...nds, newNode])

      // Create edge only if linked to a real terminal
      if (terminalNode) {
        const newEdge: Edge = {
          id: `edge-${terminalId}-${sessionId}`,
          source: terminalId,
          target: sessionId,
          animated: true,
          style: { stroke: '#10b981', strokeWidth: 2 }
        }
        setEdges((eds) => [...eds, newEdge])
      }

      setFocusedId(sessionId)
    },
    [setNodes, setEdges]
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
      setNodes(nds => nds.map(n => {
        const data = n.data as Record<string, unknown>
        if (data.sessionId === sessionId) {
          return { ...n, width, height, style: { ...n.style, width, height } }
        }
        return n
      }))
    })
    return unsub
  }, [setNodes])

  const focusTerminal = useCallback(
    (sessionId: string) => {
      setFocusedId(sessionId)
      const node = nodesRef.current.find(
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
      const pos = position ?? findOpenPosition(nodesRef.current, width, height, 4)
      const newNode: Node = {
        id: sessionId,
        type: 'terminal',
        position: pos,
        style: { width, height },
        data: {
          sessionId,
          label: `Terminal ${tileCount}`
        },
        dragHandle: '.terminal-tile-header'
      }
      setNodes((nds) => [...nds, newNode])
      setFocusedId(sessionId)
      setCenter(pos.x + width / 2, pos.y + height / 2, { zoom: 1, duration: 400 })
    },
    [setNodes, setCenter]
  )

  const addTerminal = useCallback((width?: number, height?: number) => addTerminalAt(undefined, width, height), [addTerminalAt])

  const onDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      const target = event.target as HTMLElement
      if (!target.closest('.react-flow__pane')) return
      if (target.closest('.react-flow__node')) return
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY })
      addTerminalAt({ x: position.x - 320, y: position.y - 200 })
    },
    [screenToFlowPosition, addTerminalAt]
  )

  const focusCtx = useMemo(
    () => ({ focusedId, setFocusedId, killTerminal }),
    [focusedId, killTerminal]
  )

  const proOptions = useMemo(() => ({ hideAttribution: true }), [])
  const togglePanel = useCallback(() => setPanelOpen((o) => !o), [])
  return (
    <FocusedTerminalContext.Provider value={focusCtx}>
      <div className="flex h-screen w-screen flex-col">
        {perfEnabled && perfStats && <PerformanceOverlay stats={perfStats} />}
        {/* Toolbar */}
        <div className="titlebar-drag flex h-12 items-center justify-between border-b border-zinc-800 bg-zinc-900 px-4">
          <div className="flex items-center gap-3 pl-20">
            <span className="text-sm font-semibold text-zinc-300">Agent Canvas</span>
          </div>
          <div className="titlebar-no-drag flex items-center gap-2">
            <button
              onClick={addTerminal}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-500"
            >
              + Terminal
            </button>
            <button
              onClick={addBrowser}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-500"
            >
              + Browser
            </button>
          </div>
        </div>

        {/* Canvas + Panel */}
        <div className="relative flex-1 overflow-hidden">
          <ReactFlow
            nodes={nodes}
            edges={edges}
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

          <OffscreenIndicators
            nodes={nodes}
            focusedId={focusedId}
            onFocus={focusTerminal}
          />

          <ProcessPanel
            nodes={nodes}
            focusedId={focusedId}
            onFocus={focusTerminal}
            onKill={killTerminal}
            onAddTerminal={addTerminal}
            onAddBrowser={addBrowser}
            open={panelOpen}
            onToggle={togglePanel}
          />
        </div>
      </div>
    </FocusedTerminalContext.Provider>
  )
}
