import { useSyncExternalStore } from 'react'

export interface BrowserStatusInfo {
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
}

type Listener = () => void

let statusMap = new Map<string, BrowserStatusInfo>()
const listeners = new Set<Listener>()
let subscribed = false

function notify(): void {
  listeners.forEach((l) => l())
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener)

  if (!subscribed) {
    subscribed = true
    window.browser.onStatus((id, info) => {
      const next = new Map(statusMap)
      next.set(id, info)
      statusMap = next
      notify()
    })
  }

  return () => listeners.delete(listener)
}

function getSnapshot(): Map<string, BrowserStatusInfo> {
  return statusMap
}

export function useBrowserStatus(sessionId: string): BrowserStatusInfo | undefined {
  const store = useSyncExternalStore(subscribe, getSnapshot)
  return store.get(sessionId)
}

export function useAllBrowserStatuses(): Map<string, BrowserStatusInfo> {
  return useSyncExternalStore(subscribe, getSnapshot)
}
