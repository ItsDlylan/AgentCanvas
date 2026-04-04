import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { NodeProps, Handle, Position } from '@xyflow/react'
import { useBrowser } from '@/hooks/useBrowser'
import { useFocusedTerminal } from '@/hooks/useFocusedTerminal'
import { useIsPanning } from '@/hooks/usePanState'
import { registerRender } from '@/hooks/usePerformanceDebug'

export interface BrowserNodeData {
  sessionId: string
  label: string
  initialUrl?: string
  linkedTerminalId?: string
  reservationId?: string
}

function BrowserTileComponent({ data }: NodeProps) {
  registerRender('BrowserTile')
  const { sessionId, label, initialUrl, linkedTerminalId, reservationId } = data as unknown as BrowserNodeData
  const { focusedId, setFocusedId, killTerminal } = useFocusedTerminal()
  const isPanning = useIsPanning()
  const isFocused = focusedId === sessionId
  const bodyRef = useRef<HTMLDivElement>(null)
  const [urlInput, setUrlInput] = useState(initialUrl || 'https://www.google.com')

  const { webviewRef, state, navigate, goBack, goForward, reload } = useBrowser({
    sessionId,
    initialUrl: initialUrl || 'https://www.google.com',
    linkedTerminalId,
    reservationId
  })

  // Sync address bar with navigation
  useEffect(() => {
    setUrlInput(state.url)
  }, [state.url])

  const handleFocus = useCallback(() => {
    setFocusedId(sessionId)
  }, [setFocusedId, sessionId])

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

  const handleUrlSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      navigate(urlInput)
    },
    [navigate, urlInput]
  )

  return (
    <div
      className={`browser-tile ${
        isFocused ? 'ring-1 ring-blue-500/60 shadow-[0_0_20px_rgba(59,130,246,0.15)]' : ''
      }`}
      style={{ width: 800, height: 600, pointerEvents: isPanning ? 'none' : 'auto' }}
      onMouseDown={handleFocus}
    >
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
