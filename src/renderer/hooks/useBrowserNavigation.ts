/**
 * Module-level pub/sub for triggering navigation and reload in existing browser tiles.
 * useBrowser registers callbacks; Canvas.tsx calls navigateBrowser / reloadBrowser.
 */
const navigators = new Map<string, (url: string) => void>()
const reloaders = new Map<string, () => void>()

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
