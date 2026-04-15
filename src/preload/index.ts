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
  rename: (id: string, label: string) => Promise<void>
  onTileRename: (callback: (sessionId: string, label: string) => void) => () => void
  onTerminalSpawn: (callback: (info: {
    terminalId: string; label?: string; cwd?: string; command?: string;
    linkedTerminalId?: string; width?: number; height?: number;
    metadata?: Record<string, unknown>
  }) => void) => () => void
  onTemplateSpawn: (callback: (info: {
    templateId?: string; templateName?: string;
    origin?: { x: number; y: number }
  }) => void) => () => void
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
  },

  rename: (id, label) => ipcRenderer.invoke('terminal:rename', { id, label }),

  onTileRename: (callback) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      { sessionId, label }: { sessionId: string; label: string }
    ) => {
      callback(sessionId, label)
    }
    ipcRenderer.on('canvas:tile-rename', handler)
    return () => ipcRenderer.removeListener('canvas:tile-rename', handler)
  },

  onTerminalSpawn: (callback) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      info: {
        terminalId: string; label?: string; cwd?: string; command?: string;
        linkedTerminalId?: string; width?: number; height?: number;
        metadata?: Record<string, unknown>
      }
    ) => {
      callback(info)
    }
    ipcRenderer.on('canvas:terminal-spawn', handler)
    return () => ipcRenderer.removeListener('canvas:terminal-spawn', handler)
  },
  onTemplateSpawn: (callback) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      info: { templateId?: string; templateName?: string; origin?: { x: number; y: number } }
    ) => {
      callback(info)
    }
    ipcRenderer.on('canvas:template-spawn', handler)
    return () => ipcRenderer.removeListener('canvas:template-spawn', handler)
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
  onRefreshFocused: (callback: () => void) => () => void
  attachCdp: (sessionId: string, webContentsId: number, linkedTerminalId?: string) => Promise<{ port?: number; error?: string }>
  detachCdp: (sessionId: string) => Promise<void>
  sendCdpCommand: (sessionId: string, method: string, params: Record<string, unknown>) => Promise<unknown>
  listExtensions: () => Promise<Array<{ id: string; name: string; path: string; version: string }>>
  openExtensionsDir: () => Promise<void>
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

  onRefreshFocused: (callback) => {
    const handler = () => callback()
    ipcRenderer.on('browser:refresh-focused', handler)
    return () => ipcRenderer.removeListener('browser:refresh-focused', handler)
  },

  attachCdp: (sessionId, webContentsId, linkedTerminalId?) =>
    ipcRenderer.invoke('browser:attachCdp', { sessionId, webContentsId, linkedTerminalId }),
  detachCdp: (sessionId) =>
    ipcRenderer.invoke('browser:detachCdp', { sessionId }),
  sendCdpCommand: (sessionId, method, params) =>
    ipcRenderer.invoke('browser:cdpCommand', { sessionId, method, params }),
  listExtensions: () => ipcRenderer.invoke('browser:extensions'),
  openExtensionsDir: () => ipcRenderer.invoke('browser:openExtensionsDir')
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
  parentTaskInfo?: { noteId: string; taskId: string }
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
  export: (noteId: string, format: 'markdown' | 'json') => Promise<boolean>
}

const noteAPI: NoteAPI = {
  load: (noteId) => ipcRenderer.invoke('note:load', { noteId }),
  save: (noteId, meta, content) => ipcRenderer.invoke('note:save', { noteId, meta, content }),
  delete: (noteId) => ipcRenderer.invoke('note:delete', { noteId }),
  list: () => ipcRenderer.invoke('note:list'),
  export: (noteId, format) => ipcRenderer.invoke('note:export', { noteId, format })
}

contextBridge.exposeInMainWorld('note', noteAPI)

// ── Attachment API ───────────────────────────────────────

export interface AttachmentAPI {
  save: (noteId: string, filename: string, data: ArrayBuffer) => Promise<string>
  saveFromPath: (noteId: string, sourcePath: string) => Promise<string>
  deleteAll: (noteId: string) => Promise<void>
  list: (noteId: string) => Promise<string[]>
  pickFile: () => Promise<string[] | null>
}

const attachmentAPI: AttachmentAPI = {
  save: (noteId, filename, data) => ipcRenderer.invoke('attachment:save', { noteId, filename, data }),
  saveFromPath: (noteId, sourcePath) => ipcRenderer.invoke('attachment:save-from-path', { noteId, sourcePath }),
  deleteAll: (noteId) => ipcRenderer.invoke('attachment:delete-all', { noteId }),
  list: (noteId) => ipcRenderer.invoke('attachment:list', { noteId }),
  pickFile: () => ipcRenderer.invoke('attachment:pick-file')
}

contextBridge.exposeInMainWorld('attachment', attachmentAPI)

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

// ── Project Templates API ──────────────────────────────

export interface TemplateAPI {
  loadProject: (workspaceId: string) => Promise<import('../main/settings-store').WorkspaceTemplate[]>
  saveProject: (workspaceId: string, templates: import('../main/settings-store').WorkspaceTemplate[]) => Promise<void>
  deleteProject: (workspaceId: string) => Promise<void>
}

const templateAPI: TemplateAPI = {
  loadProject: (workspaceId) => ipcRenderer.invoke('templates:load-project', { workspaceId }),
  saveProject: (workspaceId, templates) => ipcRenderer.invoke('templates:save-project', { workspaceId, templates }),
  deleteProject: (workspaceId) => ipcRenderer.invoke('templates:delete-project', { workspaceId })
}

contextBridge.exposeInMainWorld('templates', templateAPI)

// ── Pomodoro API ────────────────────────────────────────

export interface PomodoroAPI {
  load: () => Promise<import('../renderer/types/pomodoro').PomodoroData>
  save: (data: import('../renderer/types/pomodoro').PomodoroData) => Promise<void>
}

const pomodoroAPI: PomodoroAPI = {
  load: () => ipcRenderer.invoke('pomodoro:load'),
  save: (data) => ipcRenderer.invoke('pomodoro:save', { data })
}

contextBridge.exposeInMainWorld('pomodoro', pomodoroAPI)

// ── IDE API ──────────────────────────────────────────────

export interface IdeAPI {
  open: (path: string) => Promise<{ ok?: boolean; error?: string }>
}

const ideAPI: IdeAPI = {
  open: (path) => ipcRenderer.invoke('ide:open', { path })
}

contextBridge.exposeInMainWorld('ide', ideAPI)

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

// ── Browser Tiles Persistence API ────────────────────────

export interface BrowserTileLayout {
  sessionId: string
  label: string
  position: { x: number; y: number }
  width: number
  height: number
  workspaceId: string
  linkedTerminalId?: string
  initialPreset?: { name: string; width: number; height: number; mobile: boolean; dpr: number }
}

export interface PersistedBrowserInfo {
  sessionId: string
  label: string
  url: string
  position: { x: number; y: number }
  width: number
  height: number
  workspaceId: string
  linkedTerminalId?: string
  initialPreset?: { name: string; width: number; height: number; mobile: boolean; dpr: number }
  createdAt: number
}

export interface BrowserTilesAPI {
  saveLayout: (layout: BrowserTileLayout[]) => void
  load: () => Promise<PersistedBrowserInfo[]>
}

const browserTilesAPI: BrowserTilesAPI = {
  saveLayout: (layout) => ipcRenderer.sendSync('browser-tiles:save-layout', layout),
  load: () => ipcRenderer.invoke('browser-tiles:load')
}

contextBridge.exposeInMainWorld('browserTiles', browserTilesAPI)

// ── Edge Persistence API ─────────────────────────────────

export interface PersistedEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
  animated?: boolean
  style?: Record<string, unknown>
}

export interface EdgeAPI {
  save: (edges: PersistedEdge[]) => void
  load: () => Promise<PersistedEdge[]>
}

const edgeAPI: EdgeAPI = {
  save: (edges) => ipcRenderer.sendSync('edges:save', edges),
  load: () => ipcRenderer.invoke('edges:load')
}

contextBridge.exposeInMainWorld('edges', edgeAPI)

// ── Draw API ─────────────────────────────────────────────

export interface DrawMeta {
  drawId: string
  label: string
  workspaceId: string
  isSoftDeleted: boolean
  position: { x: number; y: number }
  width: number
  height: number
  linkedTerminalId?: string
  createdAt: number
  updatedAt: number
}

export interface DrawFile {
  meta: DrawMeta
  elements: unknown[]
  appState: Record<string, unknown>
}

export interface DrawAPI {
  load: (drawId: string) => Promise<DrawFile | null>
  save: (drawId: string, meta: Partial<DrawMeta>, elements?: unknown[], appState?: Record<string, unknown>) => Promise<void>
  delete: (drawId: string) => Promise<void>
  list: () => Promise<DrawFile[]>
  onSceneUpdate: (callback: (drawId: string, elements: unknown[], appState?: Record<string, unknown>) => void) => () => void
  onDrawOpen: (callback: (info: { terminalId?: string; label?: string }) => void) => () => void
  onDrawUpdate: (callback: (info: { sessionId: string; mermaid?: string; elements?: unknown[]; mode?: string }) => void) => () => void
}

const drawAPI: DrawAPI = {
  load: (drawId) => ipcRenderer.invoke('draw:load', { drawId }),
  save: (drawId, meta, elements, appState) => ipcRenderer.invoke('draw:save', { drawId, meta, elements, appState }),
  delete: (drawId) => ipcRenderer.invoke('draw:delete', { drawId }),
  list: () => ipcRenderer.invoke('draw:list'),

  onSceneUpdate: (callback) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      { drawId, elements, appState }: { drawId: string; elements: unknown[]; appState?: Record<string, unknown> }
    ) => {
      callback(drawId, elements, appState)
    }
    ipcRenderer.on('draw:scene-update', handler)
    return () => ipcRenderer.removeListener('draw:scene-update', handler)
  },

  onDrawOpen: (callback) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      info: { terminalId?: string; label?: string }
    ) => {
      callback(info)
    }
    ipcRenderer.on('canvas:draw-open', handler)
    return () => ipcRenderer.removeListener('canvas:draw-open', handler)
  },

  onDrawUpdate: (callback) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      info: { sessionId: string; mermaid?: string; elements?: unknown[]; mode?: string }
    ) => {
      callback(info)
    }
    ipcRenderer.on('canvas:draw-update', handler)
    return () => ipcRenderer.removeListener('canvas:draw-update', handler)
  }
}

contextBridge.exposeInMainWorld('draw', drawAPI)

// ── Notify API ──────────────────────────────────────────

export interface CanvasNotification {
  id: string
  title?: string
  body: string
  level: 'info' | 'success' | 'warning' | 'error'
  terminalId?: string
  duration: number
  sound: boolean
  timestamp: number
}

export interface NotifyAPI {
  onNotify: (callback: (notification: CanvasNotification) => void) => () => void
}

const notifyAPI: NotifyAPI = {
  onNotify: (callback) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      notification: CanvasNotification
    ) => {
      callback(notification)
    }
    ipcRenderer.on('canvas:notify', handler)
    return () => ipcRenderer.removeListener('canvas:notify', handler)
  }
}

contextBridge.exposeInMainWorld('notify', notifyAPI)

// ── Diff API ────────────────────────────────────────────

export interface DiffAPI {
  compute: (cwd: string) => Promise<import('../main/diff-service').DiffResult>
}

const diffAPI: DiffAPI = {
  compute: (cwd) => ipcRenderer.invoke('diff:compute', { cwd })
}

contextBridge.exposeInMainWorld('diff', diffAPI)

// Voice API
export interface VoiceModelStatus {
  model: string
  downloaded: boolean
  sizeMB: number
  path: string | null
}

export interface VoiceAPI {
  transcribe: (audio: Float32Array, provider?: string, model?: string) => Promise<{ text: string; durationMs: number }>
  loadModel: (model: string) => Promise<{ ok: boolean; error?: string }>
  getModelStatus: () => Promise<VoiceModelStatus[]>
  onModelProgress: (callback: (model: string, progress: number) => void) => () => void
  // Wake word
  sendAudioFrame: (frame: Float32Array) => void
  loadWakeWordModel: (wakeWord: string) => Promise<{ ok: boolean; error?: string }>
  startWakeWordEngine: (wakeWord: string) => Promise<{ ok: boolean; error?: string }>
  stopWakeWordEngine: () => void
  onWakeWordDetected: (callback: () => void) => () => void
  getWakeWordModelStatus: () => Promise<Array<{ model: string; downloaded: boolean }>>
  // LLM
  discoverLLM: (endpoint?: string, model?: string) => Promise<{ endpoints: Array<{ provider: string; baseUrl: string; models: string[] }>; defaultEndpoint: { provider: string; baseUrl: string; models: string[] } | null }>
  getLLMStatus: () => Promise<{ endpoints: Array<{ provider: string; baseUrl: string; models: string[] }>; defaultEndpoint: { provider: string; baseUrl: string; models: string[] } | null } | null>
  chatLLM: (apiUrl: string, body: object) => Promise<{ ok: boolean; data?: unknown; status?: number; error?: string }>
}

const voiceAPI: VoiceAPI = {
  transcribe: (audio, provider, model) => {
    // Copy raw bytes into a standalone Buffer
    const bytes = new Uint8Array(audio.buffer, audio.byteOffset, audio.byteLength)
    const buf = Buffer.from(bytes)
    return ipcRenderer.invoke('voice:transcribe', { audio: buf, provider, model })
  },
  loadModel: (model) => ipcRenderer.invoke('voice:load-model', { model }),
  getModelStatus: () => ipcRenderer.invoke('voice:model-status'),
  onModelProgress: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, model: string, progress: number) => callback(model, progress)
    ipcRenderer.on('voice:model-progress', handler)
    return () => ipcRenderer.removeListener('voice:model-progress', handler)
  },
  // Wake word
  sendAudioFrame: (frame) => {
    const bytes = new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength)
    ipcRenderer.send('wake-word:audio-frame', Buffer.from(bytes))
  },
  loadWakeWordModel: (wakeWord) => ipcRenderer.invoke('wake-word:load-model', { wakeWord }),
  startWakeWordEngine: (wakeWord) => ipcRenderer.invoke('wake-word:start', { wakeWord }),
  stopWakeWordEngine: () => { ipcRenderer.send('wake-word:stop') },
  onWakeWordDetected: (callback) => {
    const handler = () => callback()
    ipcRenderer.on('wake-word:detected', handler)
    return () => ipcRenderer.removeListener('wake-word:detected', handler)
  },
  getWakeWordModelStatus: () => ipcRenderer.invoke('wake-word:model-status'),
  // LLM
  discoverLLM: (endpoint?: string, model?: string) => ipcRenderer.invoke('llm:discover', { endpoint, model }),
  getLLMStatus: () => ipcRenderer.invoke('llm:status'),
  chatLLM: (apiUrl: string, body: object) => ipcRenderer.invoke('llm:chat', { apiUrl, body })
}

contextBridge.exposeInMainWorld('voice', voiceAPI)

// Debug APIs
contextBridge.exposeInMainWorld('debug', {
  profile: (durationMs = 3000) => ipcRenderer.invoke('debug:profile', durationMs),
  eval: (code: string) => ipcRenderer.invoke('debug:eval', code),
  togglePerf: () => ipcRenderer.invoke('perf:toggle'),
  getPerfStats: () => ipcRenderer.invoke('perf:stats')
})
