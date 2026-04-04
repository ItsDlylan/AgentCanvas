import { contextBridge, ipcRenderer } from 'electron'

export type TerminalStatus = 'idle' | 'running' | 'waiting'

export interface TerminalStatusInfo {
  status: TerminalStatus
  cwd: string
  foregroundProcess: string
}

export interface TerminalAPI {
  create: (id: string, label: string, cwd?: string) => Promise<{ cdpPort: number }>
  write: (id: string, data: string) => Promise<void>
  resize: (id: string, cols: number, rows: number) => Promise<void>
  kill: (id: string) => Promise<void>
  getStatus: (id: string) => Promise<TerminalStatusInfo | undefined>
  list: () => Promise<Array<{ id: string; cwd: string; status: TerminalStatus; foregroundProcess: string; label: string; createdAt: number; cdpPort: number }>>
  onData: (callback: (id: string, data: string) => void) => () => void
  onExit: (callback: (id: string, exitCode: number) => void) => () => void
  onStatus: (callback: (id: string, info: TerminalStatusInfo) => void) => () => void
  onBrowserRequest: (callback: (terminalId: string, url: string, reservationId?: string) => void) => () => void
}

const terminalAPI: TerminalAPI = {
  create: (id, label, cwd) => ipcRenderer.invoke('terminal:create', { id, label, cwd }),
  write: (id, data) => ipcRenderer.invoke('terminal:write', { id, data }),
  resize: (id, cols, rows) => ipcRenderer.invoke('terminal:resize', { id, cols, rows }),
  kill: (id) => ipcRenderer.invoke('terminal:kill', { id }),
  getStatus: (id) => ipcRenderer.invoke('terminal:status', { id }),
  list: () => ipcRenderer.invoke('terminal:list'),

  onData: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, { id, data }: { id: string; data: string }) => {
      callback(id, data)
    }
    ipcRenderer.on('terminal:data', handler)
    return () => ipcRenderer.removeListener('terminal:data', handler)
  },

  onExit: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, { id, exitCode }: { id: string; exitCode: number }) => {
      callback(id, exitCode)
    }
    ipcRenderer.on('terminal:exit', handler)
    return () => ipcRenderer.removeListener('terminal:exit', handler)
  },

  onStatus: (callback) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      { id, status, cwd, foregroundProcess }: { id: string; status: TerminalStatus; cwd: string; foregroundProcess: string }
    ) => {
      callback(id, { status, cwd, foregroundProcess })
    }
    ipcRenderer.on('terminal:status', handler)
    return () => ipcRenderer.removeListener('terminal:status', handler)
  },

  onBrowserRequest: (callback) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      { terminalId, url, reservationId }: { terminalId: string; url: string; reservationId?: string }
    ) => {
      callback(terminalId, url, reservationId)
    }
    ipcRenderer.on('terminal:browser-request', handler)
    return () => ipcRenderer.removeListener('terminal:browser-request', handler)
  }
}

contextBridge.exposeInMainWorld('terminal', terminalAPI)

// ── Browser API ──────────────────────────────────────────

export interface BrowserStatusInfo {
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
}

export interface BrowserAPI {
  create: (id: string, url?: string) => Promise<void>
  updateStatus: (id: string, info: Partial<BrowserStatusInfo>) => Promise<void>
  destroy: (id: string) => Promise<void>
  list: () => Promise<Array<BrowserStatusInfo & { id: string; createdAt: number }>>
  onStatus: (callback: (id: string, info: BrowserStatusInfo) => void) => () => void
  attachCdp: (sessionId: string, webContentsId: number, linkedTerminalId?: string) => Promise<{ port?: number; error?: string }>
  detachCdp: (sessionId: string) => Promise<void>
}

const browserAPI: BrowserAPI = {
  create: (id, url) => ipcRenderer.invoke('browser:create', { id, url }),
  updateStatus: (id, info) => ipcRenderer.invoke('browser:updateStatus', { id, ...info }),
  destroy: (id) => ipcRenderer.invoke('browser:destroy', { id }),
  list: () => ipcRenderer.invoke('browser:list'),

  onStatus: (callback) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      { id, ...info }: { id: string } & BrowserStatusInfo
    ) => {
      callback(id, info as BrowserStatusInfo)
    }
    ipcRenderer.on('browser:status', handler)
    return () => ipcRenderer.removeListener('browser:status', handler)
  },

  attachCdp: (sessionId, webContentsId, linkedTerminalId?) =>
    ipcRenderer.invoke('browser:attachCdp', { sessionId, webContentsId, linkedTerminalId }),
  detachCdp: (sessionId) =>
    ipcRenderer.invoke('browser:detachCdp', { sessionId })
}

contextBridge.exposeInMainWorld('browser', browserAPI)

// Debug APIs
contextBridge.exposeInMainWorld('debug', {
  profile: (durationMs = 3000) => ipcRenderer.invoke('debug:profile', durationMs),
  eval: (code: string) => ipcRenderer.invoke('debug:eval', code)
})
