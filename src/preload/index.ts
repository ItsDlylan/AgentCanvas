import { contextBridge, ipcRenderer } from 'electron'

export type TerminalStatus = 'idle' | 'running' | 'waiting'

export interface TerminalStatusInfo {
  status: TerminalStatus
  cwd: string
  foregroundProcess: string
}

export interface TerminalAPI {
  create: (id: string, label: string, cwd?: string) => Promise<void>
  write: (id: string, data: string) => Promise<void>
  resize: (id: string, cols: number, rows: number) => Promise<void>
  kill: (id: string) => Promise<void>
  getStatus: (id: string) => Promise<TerminalStatusInfo | undefined>
  list: () => Promise<Array<{ id: string; cwd: string; status: TerminalStatus; foregroundProcess: string; label: string; createdAt: number }>>
  onData: (callback: (id: string, data: string) => void) => () => void
  onExit: (callback: (id: string, exitCode: number) => void) => () => void
  onStatus: (callback: (id: string, info: TerminalStatusInfo) => void) => () => void
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
  }
}

contextBridge.exposeInMainWorld('terminal', terminalAPI)
