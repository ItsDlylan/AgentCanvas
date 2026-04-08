import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { NodeProps, Handle, Position, NodeResizer, useReactFlow } from '@xyflow/react'
import { useBrowser } from '@/hooks/useBrowser'
import { useFocusedTerminal } from '@/hooks/useFocusedTerminal'
import { useIsPanning } from '@/hooks/usePanState'
import { registerRender } from '@/hooks/usePerformanceDebug'
import { useSettings } from '@/hooks/useSettings'
import { DEVICE_PRESETS, BROWSER_CHROME_HEIGHT, BROWSER_CHROME_WIDTH, type DevicePreset } from '@/constants/devicePresets'

export interface BrowserNodeData {
  sessionId: string
  label: string
  initialUrl?: string
  linkedTerminalId?: string
  reservationId?: string
  initialPreset?: DevicePreset
  isBackground?: boolean
  devToolsIsFocused?: boolean
}

const CHROME_HEIGHT = BROWSER_CHROME_HEIGHT
const CHROME_WIDTH = BROWSER_CHROME_WIDTH

function BrowserTileComponent({ id: nodeId, data, width, height }: NodeProps) {
  registerRender('BrowserTile')
  const { sessionId, label, initialUrl, linkedTerminalId, reservationId, initialPreset, isBackground, devToolsIsFocused } = data as unknown as BrowserNodeData
  const { focusedId, setFocusedId, killTerminal, killHighlight, toggleDevTools } = useFocusedTerminal()
  const { settings } = useSettings()
  const isPanning = useIsPanning()
  const isFocused = focusedId === sessionId
  const bodyRef = useRef<HTMLDivElement>(null)

  const { webviewRef, state, navigate, goBack, goForward, reload, setViewportSize, startUrl } = useBrowser({
    sessionId,
    initialUrl: initialUrl || settings.browser.defaultUrl,
    linkedTerminalId,
    reservationId,
    initialPreset
  })

  const [urlInput, setUrlInput] = useState(startUrl)
  const [isResizing, setIsResizing] = useState(false)
  const [presetOpen, setPresetOpen] = useState(false)
  const { setNodes } = useReactFlow()

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

  // Keep the webview in a stable position in the React tree so it's never
  // destroyed when switching between background and foreground modes.
  // Only the surrounding chrome (header, address bar, handles) is conditional.
  return (
    <div
      className={`browser-tile ${
        !isBackground && isFocused && killHighlight
          ? 'ring-1 ring-red-500/80 shadow-[0_0_25px_rgba(239,68,68,0.3)] animate-pulse'
          : !isBackground && isFocused
            ? 'ring-1 ring-blue-500/60 shadow-[0_0_20px_rgba(59,130,246,0.15)]'
            : ''
      }`}
      style={{
        width: '100%',
        height: '100%',
        pointerEvents: isBackground ? 'none' : isPanning ? 'none' : 'auto',
        opacity: isBackground ? 0 : 1
      }}
      onMouseDown={isBackground ? undefined : handleFocus}
    >
      {!isBackground && (
        <NodeResizer
          minWidth={320}
          minHeight={300}
          isVisible={isFocused}
          color="#3b82f6"
          onResizeStart={onResizeStart}
          onResizeEnd={onResizeEnd}
        />
      )}

      {/* Dimension overlay during resize */}
      {!isBackground && isResizing && width != null && height != null && (
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
      {!isBackground && (
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
      )}

      {/* Address bar */}
      {!isBackground && (
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
          {/* DevTools toggle */}
          <button
            onClick={() => toggleDevTools(sessionId)}
            className="browser-nav-btn"
            title="Toggle DevTools"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085" />
            </svg>
          </button>
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
      )}

      {/* Browser body — webview is GPU-composited by Electron, no snapshot needed.
          Always rendered (even when background) to keep the webview alive for CDP. */}
      <div
        ref={isBackground ? undefined : bodyRef}
        className={isBackground ? undefined : 'browser-tile-body titlebar-no-drag'}
        style={isBackground ? { width: 800, height: 600 } : undefined}
      >
        <webview
          ref={webviewRef}
          src={startUrl}
          style={{ width: '100%', height: '100%', pointerEvents: !isBackground && (isFocused || devToolsIsFocused) ? 'auto' : 'none' }}
        />
      </div>

      {!isBackground && <Handle type="target" position={Position.Left} className="!bg-zinc-600" />}
      {!isBackground && <Handle type="source" position={Position.Right} className="!bg-zinc-600" />}
      {!isBackground && (
        <Handle
          type="source"
          position={Position.Right}
          id="devtools-source"
          isConnectableStart={false}
          isConnectableEnd={false}
          className="!opacity-0 !w-0 !h-0 !min-w-0 !min-h-0 !border-0"
        />
      )}
    </div>
  )
}

export const BrowserTile = memo(BrowserTileComponent)
