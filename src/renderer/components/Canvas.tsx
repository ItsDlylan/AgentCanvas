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

const nodeTypes: NodeTypes = {
  terminal: TerminalTile as unknown as NodeTypes['terminal'],
  browser: BrowserTile as unknown as NodeTypes['browser']
}

const defaultViewport = { x: 100, y: 100, zoom: 0.85 }

let tileCount = 0

export default function Canvas() {
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const [panelOpen, setPanelOpen] = useState(true)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const { setCenter, screenToFlowPosition } = useReactFlow()

  const onConnect: OnConnect = useCallback(
    (params) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  )

  const killTerminal = useCallback(
    (sessionId: string) => {
      const node = nodes.find(
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
    [setNodes, nodes]
  )

  const addBrowserAt = useCallback(
    (position?: { x: number; y: number }) => {
      tileCount++
      const sessionId = uuid()
      const pos = position ?? {
        x: 100 + (tileCount % 3) * 880,
        y: 100 + Math.floor(tileCount / 3) * 680
      }
      const newNode: Node = {
        id: sessionId,
        type: 'browser',
        position: pos,
        data: {
          sessionId,
          label: `Browser ${tileCount}`,
          initialUrl: 'https://www.google.com'
        },
        dragHandle: '.browser-tile-header'
      }
      setNodes((nds) => [...nds, newNode])
      setFocusedId(sessionId)
    },
    [setNodes]
  )

  const addBrowser = useCallback(() => addBrowserAt(), [addBrowserAt])

  // Auto-spawn a browser tile linked to a terminal when agent-browser is detected
  const nodesRef = useRef(nodes)
  nodesRef.current = nodes

  const addBrowserForTerminal = useCallback(
    (terminalId: string, url: string, reservationId?: string) => {
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
    const unsub = window.terminal.onBrowserRequest((terminalId, url, reservationId) => {
      addBrowserForTerminal(terminalId, url, reservationId)
    })
    return unsub
  }, [addBrowserForTerminal])

  const focusTerminal = useCallback(
    (sessionId: string) => {
      setFocusedId(sessionId)
      const node = nodes.find(
        (n) => (n.data as Record<string, unknown>).sessionId === sessionId
      )
      if (!node) return
      const cx = node.type === 'browser' ? 400 : 320
      const cy = node.type === 'browser' ? 300 : 200
      setCenter(node.position.x + cx, node.position.y + cy, {
        zoom: 1,
        duration: 400
      })
    },
    [nodes, setCenter]
  )

  const onPaneClick = useCallback(() => {
    setFocusedId(null)
  }, [])

  const addTerminalAt = useCallback(
    (position?: { x: number; y: number }) => {
      tileCount++
      const sessionId = uuid()
      const pos = position ?? {
        x: 100 + (tileCount % 4) * 680,
        y: 100 + Math.floor(tileCount / 4) * 440
      }
      const newNode: Node = {
        id: sessionId,
        type: 'terminal',
        position: pos,
        data: {
          sessionId,
          label: `Terminal ${tileCount}`
        },
        dragHandle: '.terminal-tile-header'
      }
      setNodes((nds) => [...nds, newNode])
      setFocusedId(sessionId)
    },
    [setNodes]
  )

  const addTerminal = useCallback(() => addTerminalAt(), [addTerminalAt])

  const onDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      const target = event.target as HTMLElement
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
