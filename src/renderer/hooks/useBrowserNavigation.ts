/**
 * Module-level pub/sub for triggering navigation in existing browser tiles.
 * useBrowser registers a navigate callback; Canvas.tsx calls navigateBrowser
 * when a browser tile already exists for a terminal.
 */
const navigators = new Map<string, (url: string) => void>()

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
