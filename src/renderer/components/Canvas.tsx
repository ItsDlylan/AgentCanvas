import { useCallback, useMemo } from 'react'
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type NodeTypes,
  type OnConnect,
  addEdge
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { v4 as uuid } from 'uuid'
import { TerminalTile } from './TerminalTile'

const nodeTypes: NodeTypes = {
  terminal: TerminalTile as unknown as NodeTypes['terminal']
}

const defaultViewport = { x: 100, y: 100, zoom: 0.85 }

let tileCount = 0

export default function Canvas() {
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])

  const onConnect: OnConnect = useCallback(
    (params) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  )

  const killTerminal = useCallback(
    (sessionId: string) => {
      window.terminal.kill(sessionId)
      setNodes((nds) =>
        nds.filter((n) => (n.data as Record<string, unknown>).sessionId !== sessionId)
      )
    },
    [setNodes]
  )

  const addTerminal = useCallback(() => {
    tileCount++
    const sessionId = uuid()
    const newNode: Node = {
      id: sessionId,
      type: 'terminal',
      position: {
        x: 100 + (tileCount % 4) * 680,
        y: 100 + Math.floor(tileCount / 4) * 440
      },
      data: {
        sessionId,
        label: `Terminal ${tileCount}`,
        onKill: killTerminal
      },
      dragHandle: '.terminal-tile-header'
    }
    setNodes((nds) => [...nds, newNode])
  }, [setNodes, killTerminal])

  const proOptions = useMemo(() => ({ hideAttribution: true }), [])

  return (
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
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          defaultViewport={defaultViewport}
          proOptions={proOptions}
          minZoom={0.2}
          maxZoom={1.5}
          fitView={false}
          selectNodesOnDrag={false}
          panOnDrag={[1, 2]}
          selectionOnDrag
          deleteKeyCode="Delete"
          className="bg-zinc-950"
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#27272a" />
          <Controls
            showInteractive={false}
            className="!rounded-lg !border-zinc-700 !bg-zinc-800 [&>button]:!border-zinc-700 [&>button]:!bg-zinc-800 [&>button]:!fill-zinc-400 [&>button:hover]:!bg-zinc-700"
          />
          <MiniMap
            nodeColor="#3b82f6"
            maskColor="rgba(0,0,0,0.7)"
            className="!rounded-lg !border-zinc-700 !bg-zinc-900"
          />
        </ReactFlow>
      </div>
    </div>
  )
}
