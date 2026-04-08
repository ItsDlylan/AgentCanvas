import { useEffect, useRef, useCallback, useState } from 'react'
import { registerNavigator, registerReloader, registerWebContentsId, registerCdpPort } from './useBrowserNavigation'
import type { DevicePreset } from '@/constants/devicePresets'

// Track last known URL per session for reconnect after workspace switch
const savedUrls = new Map<string, string>()

interface UseBrowserOptions {
  sessionId: string
  initialUrl?: string
  linkedTerminalId?: string
  reservationId?: string
  initialPreset?: DevicePreset
}

export interface BrowserState {
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  cdpPort?: number
}

export function useBrowser({ sessionId, initialUrl = 'https://www.google.com', linkedTerminalId, reservationId, initialPreset }: UseBrowserOptions) {
  const webviewRef = useRef<Electron.WebviewTag | null>(null)
  const mountedRef = useRef(false)
  // Use saved URL from previous mount (workspace switch) or fall back to initialUrl
  const startUrl = savedUrls.get(sessionId) || initialUrl
  const [state, setState] = useState<BrowserState>({
    url: startUrl,
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

  // Register navigate/reload callbacks so Canvas.tsx can control this tile externally
  useEffect(() => {
    return registerNavigator(sessionId, navigate)
  }, [sessionId, navigate])

  useEffect(() => {
    return registerReloader(sessionId, reload)
  }, [sessionId, reload])

  // Callback ref — attaches DOM listeners when webview mounts
  const setWebviewRef = useCallback(
    (el: Electron.WebviewTag | null) => {
      webviewRef.current = el
      if (!el || mountedRef.current) return
      mountedRef.current = true

      // Register session in main process (returns early if session already exists)
      window.browser.create(sessionId, initialUrl)

      const pushStatus = (partial: Partial<BrowserState>): void => {
        setState((prev) => ({ ...prev, ...partial }))
        window.browser.updateStatus(sessionId, partial)
      }

      el.addEventListener('did-navigate', ((e: Electron.DidNavigateEvent) => {
        savedUrls.set(sessionId, e.url)
        pushStatus({
          url: e.url,
          loading: false,
          canGoBack: el.canGoBack(),
          canGoForward: el.canGoForward()
        })
      }) as EventListener)

      el.addEventListener('did-navigate-in-page', ((e: Electron.DidNavigateInPageEvent) => {
        savedUrls.set(sessionId, e.url)
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
          // Store wcId so DevToolsTile can look it up
          registerWebContentsId(sessionId, wcId)
          // Use reservationId to find the pre-reserved CDP server, fall back to linkedTerminalId
          const cdpId = reservationId || linkedTerminalId
          window.browser.attachCdp(sessionId, wcId, cdpId).then((result) => {
            if (result.port) {
              console.log(`[CDP] Debugger wired for ${sessionId} on port ${result.port}`)
              registerCdpPort(sessionId, result.port)
              setState((prev) => ({ ...prev, cdpPort: result.port }))
            }
            // Apply initial device preset (mobile/dpr emulation) if specified at spawn time
            if (initialPreset && initialPreset.width > 0) {
              setViewportSize(initialPreset.width, initialPreset.height, initialPreset.mobile, initialPreset.dpr)
            }
          })
        }
      })
    },
    [sessionId, initialUrl, linkedTerminalId, initialPreset, setViewportSize]
  )

  // Cleanup on unmount — detach CDP but don't destroy session
  // (session metadata stays in BrowserManager for reconnect after workspace switch;
  // explicit kill is handled by Canvas.tsx calling window.browser.destroy directly)
  useEffect(() => {
    return () => {
      if (mountedRef.current) {
        window.browser.detachCdp(sessionId)
        mountedRef.current = false
      }
    }
  }, [sessionId])

  return { webviewRef: setWebviewRef, containerRef: webviewRef, state, navigate, goBack, goForward, reload, setViewportSize, startUrl }
}
