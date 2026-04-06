import { contextBridge, ipcRenderer } from 'electron'

export type TerminalStatus = 'idle' | 'running' | 'waiting'

export interface TerminalStatusInfo {
  status: TerminalStatus
  cwd: string
  foregroundProcess: string
  metadata?: Record<string, unknown>
}

export interface WorktreeInfo {
  path: string
  branch: string
  head: string
  bare: boolean
}

export interface TerminalAPI {
  create: (id: string, label: string, cwd?: string, metadata?: Record<string, unknown>) => Promise<{ cdpPort: number; isReconnect?: boolean }>
  resume: (id: string) => Promise<{ scrollback: string }>
  write: (id: string, data: string) => Promise<void>
  resize: (id: string, cols: number, rows: number) => Promise<void>
  kill: (id: string) => Promise<void>
  getStatus: (id: string) => Promise<TerminalStatusInfo | undefined>
  list: () => Promise<Array<{ id: string; cwd: string; status: TerminalStatus; foregroundProcess: string; label: string; createdAt: number; cdpPort: number; metadata: Record<string, unknown> }>>
  setMetadata: (id: string, key: string, value: unknown) => Promise<{ ok: boolean }>
  listWorktrees: (cwd: string) => Promise<WorktreeInfo[]>
  onData: (callback: (id: string, data: string) => void) => () => void
  onExit: (callback: (id: string, exitCode: number) => void) => () => void
  onStatus: (callback: (id: string, info: TerminalStatusInfo) => void) => () => void
  onBrowserRequest: (callback: (terminalId: string, url: string, reservationId?: string, width?: number, height?: number) => void) => () => void
  onBrowserResize: (callback: (sessionId: string, width: number, height: number) => void) => () => void
}

const terminalAPI: TerminalAPI = {
  create: (id, label, cwd, metadata) => ipcRenderer.invoke('terminal:create', { id, label, cwd, metadata }),
  resume: (id) => ipcRenderer.invoke('terminal:resume', { id }),
  write: (id, data) => ipcRenderer.invoke('terminal:write', { id, data }),
  resize: (id, cols, rows) => ipcRenderer.invoke('terminal:resize', { id, cols, rows }),
  kill: (id) => ipcRenderer.invoke('terminal:kill', { id }),
  getStatus: (id) => ipcRenderer.invoke('terminal:status', { id }),
  list: () => ipcRenderer.invoke('terminal:list'),
  setMetadata: (id, key, value) => ipcRenderer.invoke('terminal:set-metadata', { id, key, value }),
  listWorktrees: (cwd) => ipcRenderer.invoke('terminal:list-worktrees', { cwd }),

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
      { id, status, cwd, foregroundProcess, metadata }: { id: string; status: TerminalStatus; cwd: string; foregroundProcess: string; metadata?: Record<string, unknown> }
    ) => {
      callback(id, { status, cwd, foregroundProcess, metadata })
    }
    ipcRenderer.on('terminal:status', handler)
    return () => ipcRenderer.removeListener('terminal:status', handler)
  },

  onBrowserRequest: (callback) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      { terminalId, url, reservationId, width, height }: { terminalId: string; url: string; reservationId?: string; width?: number; height?: number }
    ) => {
      callback(terminalId, url, reservationId, width, height)
    }
    ipcRenderer.on('terminal:browser-request', handler)
    return () => ipcRenderer.removeListener('terminal:browser-request', handler)
  },

  onBrowserResize: (callback) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      { sessionId, width, height }: { sessionId: string; width: number; height: number }
    ) => {
      callback(sessionId, width, height)
    }
    ipcRenderer.on('canvas:browser-resize', handler)
    return () => ipcRenderer.removeListener('canvas:browser-resize', handler)
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
  sendCdpCommand: (sessionId: string, method: string, params: Record<string, unknown>) => Promise<unknown>
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
    ipcRenderer.invoke('browser:detachCdp', { sessionId }),
  sendCdpCommand: (sessionId, method, params) =>
    ipcRenderer.invoke('browser:cdpCommand', { sessionId, method, params })
}

contextBridge.exposeInMainWorld('browser', browserAPI)

// ── Workspace API ────────────────────────────────────────

export interface WorkspaceInfo {
  id: string
  name: string
  path: string | null
  isDefault: boolean
  createdAt: number
}

export interface WorkspaceAPI {
  load: () => Promise<{ workspaces: WorkspaceInfo[]; activeWorkspaceId: string }>
  save: (workspaces: WorkspaceInfo[], activeWorkspaceId: string) => Promise<void>
  pickDirectory: () => Promise<string | null>
}

const workspaceAPI: WorkspaceAPI = {
  load: () => ipcRenderer.invoke('workspace:load'),
  save: (workspaces, activeWorkspaceId) =>
    ipcRenderer.invoke('workspace:save', { workspaces, activeWorkspaceId }),
  pickDirectory: () => ipcRenderer.invoke('workspace:pickDirectory')
}

contextBridge.exposeInMainWorld('workspace', workspaceAPI)

// ── Note API ──────────────────────────────────────────────

export interface NoteMeta {
  noteId: string
  label: string
  workspaceId: string
  isSoftDeleted: boolean
  position: { x: number; y: number }
  width: number
  height: number
  linkedTerminalId?: string
  linkedNoteId?: string
  createdAt: number
  updatedAt: number
}

export interface NoteFile {
  meta: NoteMeta
  content: Record<string, unknown>
}

export interface NoteAPI {
  load: (noteId: string) => Promise<NoteFile | null>
  save: (noteId: string, meta: Partial<NoteMeta>, content?: Record<string, unknown>) => Promise<void>
  delete: (noteId: string) => Promise<void>
  list: () => Promise<NoteFile[]>
}

const noteAPI: NoteAPI = {
  load: (noteId) => ipcRenderer.invoke('note:load', { noteId }),
  save: (noteId, meta, content) => ipcRenderer.invoke('note:save', { noteId, meta, content }),
  delete: (noteId) => ipcRenderer.invoke('note:delete', { noteId }),
  list: () => ipcRenderer.invoke('note:list')
}

contextBridge.exposeInMainWorld('note', noteAPI)

// ── Settings API ─────────────────────────────────────────

export interface SettingsAPI {
  load: () => Promise<import('../main/settings-store').Settings>
  save: (settings: import('../main/settings-store').Settings) => Promise<void>
  getDefaults: () => Promise<import('../main/settings-store').Settings>
  onChanged: (callback: (settings: import('../main/settings-store').Settings) => void) => () => void
}

const settingsAPI: SettingsAPI = {
  load: () => ipcRenderer.invoke('settings:load'),
  save: (settings) => ipcRenderer.invoke('settings:save', { settings }),
  getDefaults: () => ipcRenderer.invoke('settings:defaults'),
  onChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, settings: import('../main/settings-store').Settings) => {
      callback(settings)
    }
    ipcRenderer.on('settings:changed', handler)
    return () => ipcRenderer.removeListener('settings:changed', handler)
  }
}

contextBridge.exposeInMainWorld('settings', settingsAPI)

// ── Terminal Tiles Persistence API ────────────────────────

export interface TerminalTileLayout {
  sessionId: string
  position: { x: number; y: number }
  width: number
  height: number
  workspaceId: string
}

export interface PersistedTerminalInfo {
  sessionId: string
  label: string
  cwd: string
  position: { x: number; y: number }
  width: number
  height: number
  workspaceId: string
  metadata: Record<string, unknown>
  createdAt: number
}

export interface TerminalTilesAPI {
  saveLayout: (layout: TerminalTileLayout[]) => void
  load: () => Promise<PersistedTerminalInfo[]>
}

const terminalTilesAPI: TerminalTilesAPI = {
  saveLayout: (layout) => ipcRenderer.sendSync('terminal-tiles:save-layout', layout),
  load: () => ipcRenderer.invoke('terminal-tiles:load')
}

contextBridge.exposeInMainWorld('terminalTiles', terminalTilesAPI)

// ── Diff API ────────────────────────────────────────────

export interface DiffAPI {
  compute: (cwd: string) => Promise<import('../main/diff-service').DiffResult>
}

const diffAPI: DiffAPI = {
  compute: (cwd) => ipcRenderer.invoke('diff:compute', { cwd })
}

contextBridge.exposeInMainWorld('diff', diffAPI)

// Debug APIs
contextBridge.exposeInMainWorld('debug', {
  profile: (durationMs = 3000) => ipcRenderer.invoke('debug:profile', durationMs),
  eval: (code: string) => ipcRenderer.invoke('debug:eval', code),
  togglePerf: () => ipcRenderer.invoke('perf:toggle'),
  getPerfStats: () => ipcRenderer.invoke('perf:stats')
})
