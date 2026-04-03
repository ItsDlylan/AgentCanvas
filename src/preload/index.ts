import { contextBridge, ipcRenderer } from 'electron'

export interface TerminalAPI {
  create: (id: string, cwd?: string) => Promise<void>
  write: (id: string, data: string) => Promise<void>
  resize: (id: string, cols: number, rows: number) => Promise<void>
  kill: (id: string) => Promise<void>
  list: () => Promise<Array<{ id: string; cwd: string; createdAt: number }>>
  onData: (callback: (id: string, data: string) => void) => () => void
  onExit: (callback: (id: string, exitCode: number) => void) => () => void
}

const terminalAPI: TerminalAPI = {
  create: (id, cwd) => ipcRenderer.invoke('terminal:create', { id, cwd }),
  write: (id, data) => ipcRenderer.invoke('terminal:write', { id, data }),
  resize: (id, cols, rows) => ipcRenderer.invoke('terminal:resize', { id, cols, rows }),
  kill: (id) => ipcRenderer.invoke('terminal:kill', { id }),
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
  }
}

contextBridge.exposeInMainWorld('terminal', terminalAPI)
