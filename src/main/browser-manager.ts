import { EventEmitter } from 'events'

export interface BrowserSessionInfo {
  id: string
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  createdAt: number
}

/**
 * Lightweight session registry for browser tiles.
 *
 * Unlike TerminalManager (which owns PTY processes), the actual <webview>
 * lives in the renderer. This manager tracks metadata so the ProcessPanel
 * and IPC bridge can query browser state from main.
 */
export class BrowserManager extends EventEmitter {
  private sessions = new Map<string, BrowserSessionInfo>()

  create(id: string, url = 'https://www.google.com'): void {
    if (this.sessions.has(id)) return
    const session: BrowserSessionInfo = {
      id,
      url,
      title: 'New Tab',
      loading: true,
      canGoBack: false,
      canGoForward: false,
      createdAt: Date.now()
    }
    this.sessions.set(id, session)
    this.emit('created', id)
  }

  updateStatus(id: string, info: Partial<Omit<BrowserSessionInfo, 'id' | 'createdAt'>>): void {
    const session = this.sessions.get(id)
    if (!session) return
    Object.assign(session, info)
    this.emit('status', id, { ...session })
  }

  destroy(id: string): void {
    this.sessions.delete(id)
    this.emit('destroyed', id)
  }

  getSession(id: string): BrowserSessionInfo | undefined {
    return this.sessions.get(id)
  }

  listSessions(): BrowserSessionInfo[] {
    return Array.from(this.sessions.values())
  }

  destroyAll(): void {
    for (const id of this.sessions.keys()) {
      this.destroy(id)
    }
  }
}
