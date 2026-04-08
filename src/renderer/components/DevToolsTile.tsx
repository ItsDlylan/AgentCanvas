import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { NodeProps, Handle, Position, NodeResizer } from '@xyflow/react'
import { useFocusedTerminal } from '@/hooks/useFocusedTerminal'
import { useIsPanning } from '@/hooks/usePanState'
import { getCdpPort } from '@/hooks/useBrowserNavigation'
import { EditableLabel } from './EditableLabel'

export interface DevToolsNodeData {
  sessionId: string
  label: string
  linkedBrowserId: string
  onClose?: (sessionId: string) => void
}

function DevToolsTileComponent({ data, width, height }: NodeProps) {
  const { sessionId, label, linkedBrowserId, onClose } = data as unknown as DevToolsNodeData
  const { focusedId, setFocusedId, renameTile } = useFocusedTerminal()
  const isPanning = useIsPanning()
  const isFocused = focusedId === sessionId
  const bodyRef = useRef<HTMLDivElement>(null)
  const [isResizing, setIsResizing] = useState(false)
  const [devtoolsUrl, setDevtoolsUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleFocus = useCallback(() => setFocusedId(sessionId), [setFocusedId, sessionId])

  // Prevent canvas pan while scrolling inside the tile
  useEffect(() => {
    const el = bodyRef.current
    if (!el || !isFocused) return
    const handler = (e: WheelEvent) => {
      if (!e.ctrlKey) e.stopPropagation()
    }
    el.addEventListener('wheel', handler)
    return () => el.removeEventListener('wheel', handler)
  }, [isFocused])

  // Build the DevTools frontend URL from the browser tile's CDP port
  useEffect(() => {
    const cdpPort = getCdpPort(linkedBrowserId)
    if (!cdpPort) {
      setError('CDP port not available — open a page in the browser tile first')
      return
    }
    // Load Chrome DevTools frontend bundled with Electron, connecting via CDP WebSocket
    setDevtoolsUrl(`devtools://devtools/bundled/devtools_app.html?ws=127.0.0.1:${cdpPort}`)
  }, [linkedBrowserId])

  return (
    <div
      className={`devtools-tile ${
        isFocused
          ? 'ring-1 ring-orange-500/60 shadow-[0_0_20px_rgba(249,115,22,0.15)]'
          : ''
      }`}
      style={{ width: '100%', height: '100%', pointerEvents: isPanning ? 'none' : 'auto' }}
      onMouseDown={handleFocus}
    >
      <NodeResizer
        minWidth={400}
        minHeight={300}
        isVisible={isFocused}
        color="#f97316"
        onResizeStart={() => setIsResizing(true)}
        onResizeEnd={() => setIsResizing(false)}
      />

      {isResizing && width != null && height != null && (
        <div className="absolute inset-0 z-50 flex items-center justify-center pointer-events-none">
          <span className="rounded bg-black/80 px-2 py-1 text-xs font-mono text-zinc-300">
            {Math.round(width)} x {Math.round(height)}
          </span>
        </div>
      )}

      {/* Header */}
      <div className={`devtools-tile-header ${isFocused ? 'border-b-orange-500/30' : ''}`}>
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 shrink-0 rounded-full ${isFocused ? 'bg-orange-400' : 'bg-orange-500/60'}`} />
          <EditableLabel
            label={label}
            onRename={(newLabel) => renameTile(sessionId, newLabel)}
            className={`text-xs font-medium ${isFocused ? 'text-zinc-200' : 'text-zinc-400'}`}
          />
        </div>
        <button
          className="titlebar-no-drag rounded px-1.5 py-0.5 text-xs text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300"
          onClick={() => onClose?.(sessionId)}
        >
          Close
        </button>
      </div>

      {/* Body — loads Chrome DevTools frontend connected to the browser tile's CDP proxy */}
      <div ref={bodyRef} className="devtools-tile-body titlebar-no-drag">
        {error ? (
          <div className="flex h-full items-center justify-center text-xs text-red-400 px-4 text-center">
            {error}
          </div>
        ) : devtoolsUrl ? (
          <webview
            src={devtoolsUrl}
            style={{ width: '100%', height: '100%', pointerEvents: isFocused ? 'auto' : 'none' }}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-zinc-500">
            Connecting...
          </div>
        )}
      </div>

      <Handle
        type="target"
        position={Position.Top}
        id="devtools-target"
        isConnectableStart={false}
        isConnectableEnd={false}
        className="!opacity-0 !w-0 !h-0 !min-w-0 !min-h-0 !border-0"
      />
    </div>
  )
}

export const DevToolsTile = memo(DevToolsTileComponent)
