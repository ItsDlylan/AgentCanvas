import { useEffect, useRef, useCallback, useState } from 'react'
import { registerNavigator } from './useBrowserNavigation'

interface UseBrowserOptions {
  sessionId: string
  initialUrl?: string
  linkedTerminalId?: string
  reservationId?: string
}

export interface BrowserState {
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  cdpPort?: number
}

export function useBrowser({ sessionId, initialUrl = 'https://www.google.com', linkedTerminalId, reservationId }: UseBrowserOptions) {
  const webviewRef = useRef<Electron.WebviewTag | null>(null)
  const mountedRef = useRef(false)
  const [state, setState] = useState<BrowserState>({
    url: initialUrl,
    title: 'New Tab',
    loading: true,
    canGoBack: false,
    canGoForward: false
  })

  const navigate = useCallback((url: string) => {
    const wv = webviewRef.current
    if (!wv) return
    const normalized = url.match(/^https?:\/\//) ? url : `https://${url}`
    wv.loadURL(normalized)
  }, [])

  const goBack = useCallback(() => webviewRef.current?.goBack(), [])
  const goForward = useCallback(() => webviewRef.current?.goForward(), [])
  const reload = useCallback(() => webviewRef.current?.reload(), [])

  const setViewportSize = useCallback(async (width: number, height: number, mobile = false, dpr = 1) => {
    try {
      await window.browser.sendCdpCommand(sessionId, 'Emulation.setDeviceMetricsOverride', {
        width: Math.round(width),
        height: Math.round(height),
        deviceScaleFactor: dpr,
        mobile
      })
    } catch (e) {
      console.warn('[CDP] setDeviceMetricsOverride failed:', e)
    }
  }, [sessionId])

  // Register navigate callback so Canvas.tsx can navigate this tile externally
  useEffect(() => {
    return registerNavigator(sessionId, navigate)
  }, [sessionId, navigate])

  // Callback ref — attaches DOM listeners when webview mounts
  const setWebviewRef = useCallback(
    (el: Electron.WebviewTag | null) => {
      webviewRef.current = el
      if (!el || mountedRef.current) return
      mountedRef.current = true

      // Register session in main process
      window.browser.create(sessionId, initialUrl)

      const pushStatus = (partial: Partial<BrowserState>): void => {
        setState((prev) => ({ ...prev, ...partial }))
        window.browser.updateStatus(sessionId, partial)
      }

      el.addEventListener('did-navigate', ((e: Electron.DidNavigateEvent) => {
        pushStatus({
          url: e.url,
          loading: false,
          canGoBack: el.canGoBack(),
          canGoForward: el.canGoForward()
        })
      }) as EventListener)

      el.addEventListener('did-navigate-in-page', ((e: Electron.DidNavigateInPageEvent) => {
        pushStatus({
          url: e.url,
          canGoBack: el.canGoBack(),
          canGoForward: el.canGoForward()
        })
      }) as EventListener)

      el.addEventListener('page-title-updated', ((e: Electron.PageTitleUpdatedEvent) => {
        pushStatus({ title: e.title })
      }) as EventListener)

      el.addEventListener('did-start-loading', () => {
        pushStatus({ loading: true })
      })

      el.addEventListener('did-stop-loading', () => {
        pushStatus({ loading: false })
      })

      // Wire the debugger to the CDP proxy (server may already be reserved by the Canvas API)
      el.addEventListener('dom-ready', () => {
        const wcId = (el as unknown as { getWebContentsId(): number }).getWebContentsId()
        if (wcId) {
          // Use reservationId to find the pre-reserved CDP server, fall back to linkedTerminalId
          const cdpId = reservationId || linkedTerminalId
          window.browser.attachCdp(sessionId, wcId, cdpId).then((result) => {
            if (result.port) {
              console.log(`[CDP] Debugger wired for ${sessionId} on port ${result.port}`)
              setState((prev) => ({ ...prev, cdpPort: result.port }))
            }
          })
        }
      })
    },
    [sessionId, initialUrl, linkedTerminalId]
  )

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (mountedRef.current) {
        window.browser.detachCdp(sessionId)
        window.browser.destroy(sessionId)
        mountedRef.current = false
      }
    }
  }, [sessionId])

  return { webviewRef: setWebviewRef, containerRef: webviewRef, state, navigate, goBack, goForward, reload, setViewportSize }
}
