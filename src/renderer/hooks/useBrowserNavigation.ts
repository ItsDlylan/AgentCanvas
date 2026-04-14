/**
 * Module-level pub/sub for triggering navigation and reload in existing browser tiles.
 * useBrowser registers callbacks; Canvas.tsx calls navigateBrowser / reloadBrowser.
 * Also stores webContentsIds so DevToolsTile can look up the browser's guest process.
 */
const navigators = new Map<string, (url: string) => void>()
const reloaders = new Map<string, () => void>()
const webContentsIds = new Map<string, number>()

export function registerNavigator(sessionId: string, navigate: (url: string) => void): () => void {
  navigators.set(sessionId, navigate)
  return () => navigators.delete(sessionId)
}

export function navigateBrowser(sessionId: string, url: string): boolean {
  const fn = navigators.get(sessionId)
  if (fn) {
    fn(url)
    return true
  }
  return false
}

export function registerReloader(sessionId: string, reload: () => void): () => void {
  reloaders.set(sessionId, reload)
  return () => reloaders.delete(sessionId)
}

export function reloadBrowser(sessionId: string): boolean {
  const fn = reloaders.get(sessionId)
  if (fn) {
    fn()
    return true
  }
  return false
}

export function registerWebContentsId(sessionId: string, wcId: number): () => void {
  webContentsIds.set(sessionId, wcId)
  return () => webContentsIds.delete(sessionId)
}

export function getWebContentsId(sessionId: string): number | undefined {
  return webContentsIds.get(sessionId)
}

// Pub/sub for requesting a new browser tile from a terminal (e.g. link click)
type BrowserOpenHandler = (terminalId: string, url: string) => void
let browserOpenHandler: BrowserOpenHandler | null = null

export function onBrowserOpenRequest(handler: BrowserOpenHandler): () => void {
  browserOpenHandler = handler
  return () => { browserOpenHandler = null }
}

export function requestBrowserOpen(terminalId: string, url: string): void {
  browserOpenHandler?.(terminalId, url)
}

const cdpPorts = new Map<string, number>()

export function registerCdpPort(sessionId: string, port: number): () => void {
  cdpPorts.set(sessionId, port)
  return () => cdpPorts.delete(sessionId)
}

export function getCdpPort(sessionId: string): number | undefined {
  return cdpPorts.get(sessionId)
}
