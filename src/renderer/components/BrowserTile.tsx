import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { NodeProps, Handle, Position, NodeResizer, useReactFlow } from '@xyflow/react'
import { useBrowser } from '@/hooks/useBrowser'
import { useFocusedTerminal } from '@/hooks/useFocusedTerminal'
import { useIsPanning } from '@/hooks/usePanState'
import { registerRender } from '@/hooks/usePerformanceDebug'
import { DEVICE_PRESETS, BROWSER_CHROME_HEIGHT, BROWSER_CHROME_WIDTH, type DevicePreset } from '@/constants/devicePresets'

export interface BrowserNodeData {
  sessionId: string
  label: string
  initialUrl?: string
  linkedTerminalId?: string
  reservationId?: string
  initialPreset?: DevicePreset
}

const CHROME_HEIGHT = BROWSER_CHROME_HEIGHT
const CHROME_WIDTH = BROWSER_CHROME_WIDTH

function BrowserTileComponent({ id: nodeId, data, width, height }: NodeProps) {
  registerRender('BrowserTile')
  const { sessionId, label, initialUrl, linkedTerminalId, reservationId, initialPreset } = data as unknown as BrowserNodeData
  const { focusedId, setFocusedId, killTerminal } = useFocusedTerminal()
  const isPanning = useIsPanning()
  const isFocused = focusedId === sessionId
  const bodyRef = useRef<HTMLDivElement>(null)
  const [urlInput, setUrlInput] = useState(initialUrl || 'https://www.google.com')
  const [isResizing, setIsResizing] = useState(false)
  const [presetOpen, setPresetOpen] = useState(false)
  const { setNodes } = useReactFlow()

  const { webviewRef, state, navigate, goBack, goForward, reload, setViewportSize } = useBrowser({
    sessionId,
    initialUrl: initialUrl || 'https://www.google.com',
    linkedTerminalId,
    reservationId,
    initialPreset
  })

  // Sync address bar with navigation
  useEffect(() => {
    setUrlInput(state.url)
  }, [state.url])

  const handleFocus = useCallback(() => {
    setFocusedId(sessionId)
  }, [setFocusedId, sessionId])

  const onResizeStart = useCallback(() => {
    setIsResizing(true)
  }, [])

  const onResizeEnd = useCallback(() => {
    setIsResizing(false)
    // Set CDP viewport to match the new tile dimensions
    if (width != null && height != null) {
      const vpW = Math.round(width - CHROME_WIDTH)
      const vpH = Math.round(height - CHROME_HEIGHT)
      if (vpW > 0 && vpH > 0) {
        setViewportSize(vpW, vpH)
      }
    }
  }, [width, height, setViewportSize])

  const handlePresetSelect = useCallback((preset: DevicePreset) => {
    setPresetOpen(false)
    if (preset.width === 0 && preset.height === 0) {
      // "Responsive" — clear device metrics override
      window.browser.sendCdpCommand(sessionId, 'Emulation.clearDeviceMetricsOverride', {})
      return
    }
    const tileW = preset.width + CHROME_WIDTH
    const tileH = preset.height + CHROME_HEIGHT
    setNodes(nds => nds.map(n =>
      n.id === nodeId ? { ...n, width: tileW, height: tileH, style: { ...n.style, width: tileW, height: tileH } } : n
    ))
    setViewportSize(preset.width, preset.height, preset.mobile, preset.dpr)
  }, [nodeId, sessionId, setNodes, setViewportSize])

  // Native bubble-phase wheel listener — same pattern as TerminalTile
  useEffect(() => {
    const el = bodyRef.current
    if (!el || !isFocused) return
    const handler = (e: WheelEvent) => {
      if (!e.ctrlKey) e.stopPropagation()
    }
    el.addEventListener('wheel', handler)
    return () => el.removeEventListener('wheel', handler)
  }, [isFocused])

  // Close preset dropdown when clicking outside
  useEffect(() => {
    if (!presetOpen) return
    const handler = () => setPresetOpen(false)
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [presetOpen])

  const handleUrlSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      navigate(urlInput)
    },
    [navigate, urlInput]
  )

  // Calculate viewport dimensions for display
  const viewportW = width != null ? Math.round(width - CHROME_WIDTH) : null
  const viewportH = height != null ? Math.round(height - CHROME_HEIGHT) : null

  return (
    <div
      className={`browser-tile ${
        isFocused ? 'ring-1 ring-blue-500/60 shadow-[0_0_20px_rgba(59,130,246,0.15)]' : ''
      }`}
      style={{ width: '100%', height: '100%', pointerEvents: isPanning ? 'none' : 'auto' }}
      onMouseDown={handleFocus}
    >
      <NodeResizer
        minWidth={320}
        minHeight={300}
        isVisible={isFocused}
        color="#3b82f6"
        onResizeStart={onResizeStart}
        onResizeEnd={onResizeEnd}
      />

      {/* Dimension overlay during resize */}
      {isResizing && width != null && height != null && (
        <div className="absolute inset-0 z-50 flex items-center justify-center pointer-events-none">
          <span className="rounded bg-black/80 px-2 py-1 text-xs font-mono text-zinc-300">
            {Math.round(width)} x {Math.round(height)}
            {viewportW != null && viewportH != null && (
              <span className="text-zinc-500"> ({viewportW} x {viewportH})</span>
            )}
          </span>
        </div>
      )}

      {/* Header / drag handle */}
      <div className={`browser-tile-header ${isFocused ? 'border-b-blue-500/30' : ''}`}>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${
              state.loading ? 'bg-blue-400 animate-pulse' : 'bg-green-500'
            }`}
          />
          <span
            className={`text-xs font-medium truncate ${
              isFocused ? 'text-zinc-200' : 'text-zinc-400'
            }`}
          >
            {state.title || label}
          </span>
          {viewportW != null && viewportH != null && (
            <span className="text-[10px] text-zinc-500">{viewportW}x{viewportH}</span>
          )}
          {state.cdpPort && (
            <span className="text-[10px] text-purple-400" title={`CDP proxy on port ${state.cdpPort}`}>
              CDP:{state.cdpPort}
            </span>
          )}
        </div>
        <button
          className="titlebar-no-drag rounded px-1.5 py-0.5 text-xs text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300"
          onClick={() => killTerminal(sessionId)}
        >
          Close
        </button>
      </div>

      {/* Address bar */}
      <div className="browser-tile-addressbar titlebar-no-drag">
        <button
          onClick={goBack}
          disabled={!state.canGoBack}
          className="browser-nav-btn"
          title="Back"
        >
          &#8592;
        </button>
        <button
          onClick={goForward}
          disabled={!state.canGoForward}
          className="browser-nav-btn"
          title="Forward"
        >
          &#8594;
        </button>
        <button onClick={reload} className="browser-nav-btn" title="Reload">
          &#8635;
        </button>
        <form onSubmit={handleUrlSubmit} className="flex-1 min-w-0">
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            className="w-full rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none focus:ring-1 focus:ring-blue-500/50"
          />
        </form>
        {/* Device preset dropdown */}
        <div className="relative" onMouseDown={(e) => e.stopPropagation()}>
          <button
            onClick={() => setPresetOpen(!presetOpen)}
            className="browser-nav-btn"
            title="Device presets"
          >
            &#9783;
          </button>
          {presetOpen && (
            <div className="absolute right-0 top-full mt-1 z-50 w-44 rounded-md border border-zinc-700 bg-zinc-800 py-1 shadow-lg">
              {DEVICE_PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  className="w-full px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-700"
                  onClick={() => handlePresetSelect(preset)}
                >
                  <span>{preset.name}</span>
                  {preset.width > 0 && (
                    <span className="ml-1 text-zinc-500">{preset.width}x{preset.height}</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Browser body — webview is GPU-composited by Electron, no snapshot needed */}
      <div
        ref={bodyRef}
        className="browser-tile-body titlebar-no-drag"
      >
        <webview
          ref={webviewRef}
          src={initialUrl || 'https://www.google.com'}
          style={{ width: '100%', height: '100%', pointerEvents: isFocused ? 'auto' : 'none' }}
        />
      </div>

      <Handle type="target" position={Position.Left} className="!bg-zinc-600" />
      <Handle type="source" position={Position.Right} className="!bg-zinc-600" />
    </div>
  )
}

export const BrowserTile = memo(BrowserTileComponent)
