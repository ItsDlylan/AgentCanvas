import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { TerminalManager } from './terminal-manager'
import { BrowserManager } from './browser-manager'
import { CdpProxy } from './cdp-proxy'
import { CanvasApi } from './canvas-api'
import { startPerfMonitor, stopPerfMonitor, getPerfStats, recordIpc, isPerfEnabled } from './perf-monitor'
import { loadWorkspaces, saveWorkspaces } from './workspace-store'
import { ensureNoteDir, loadNote, saveNote, deleteNote, listNotes } from './note-store'
import { loadSettings, saveSettings, DEFAULT_SETTINGS, type Settings } from './settings-store'

// GPU compositing flags for smooth panning
app.commandLine.appendSwitch('enable-gpu-rasterization')
app.commandLine.appendSwitch('enable-zero-copy')
app.commandLine.appendSwitch('ignore-gpu-blocklist')
// Treat all wheel listeners as passive so the compositor doesn't block
// on d3-zoom's { passive: false } wheel handler during pan
app.commandLine.appendSwitch('enable-features', 'PassiveEventListenerDefault')

const terminalManager = new TerminalManager()
const browserManager = new BrowserManager()
const cdpProxy = new CdpProxy()
const canvasApi = new CanvasApi()
let mainWindow: BrowserWindow | null = null
let canvasApiPort = 0

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
    if (is.dev) mainWindow?.webContents.openDevTools({ mode: 'detach' })
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Dev server in development, file:// in production
  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ── IPC Handlers ──────────────────────────────────────────

ipcMain.handle('terminal:create', async (_event, { id, label, cwd }) => {
  // Reconnect: session already exists (component remounted after workspace switch)
  const existingSession = terminalManager.getSession(id)
  if (existingSession) {
    pausedSessions.add(id)
    // Fold any pending unflushed data into scrollback before clearing
    const pending = dataBuffers.get(id) || ''
    if (pending) {
      let buf = (scrollbackBuffers.get(id) || '') + pending
      if (buf.length > MAX_SCROLLBACK) {
        const trimPoint = buf.indexOf('\n', buf.length - MAX_SCROLLBACK)
        buf = trimPoint >= 0 ? buf.slice(trimPoint + 1) : buf.slice(-MAX_SCROLLBACK)
      }
      scrollbackBuffers.set(id, buf)
      dataBuffers.delete(id)
    }
    return { cdpPort: existingSession.cdpPort, isReconnect: true }
  }

  const currentSettings = loadSettings()
  const extraEnv: Record<string, string> = { ...currentSettings.terminal.customEnvVars }
  if (canvasApiPort) {
    extraEnv.AGENT_CANVAS_API = `http://127.0.0.1:${canvasApiPort}`
  }
  const cdpPort = await terminalManager.create(id, label, cwd, 80, 24, extraEnv, currentSettings.general.shell)
  return { cdpPort }
})

ipcMain.handle('terminal:status', (_event, { id }) => {
  return terminalManager.getStatus(id)
})

ipcMain.handle('terminal:write', (_event, { id, data }) => {
  terminalManager.write(id, data)
})

ipcMain.handle('terminal:resize', (_event, { id, cols, rows }) => {
  terminalManager.resize(id, cols, rows)
})

ipcMain.handle('terminal:kill', (_event, { id }) => {
  terminalManager.kill(id)
})

ipcMain.handle('terminal:resume', (_event, { id }) => {
  const scrollback = scrollbackBuffers.get(id) || ''
  pausedSessions.delete(id)
  return { scrollback }
})

ipcMain.handle('terminal:list', () => {
  return terminalManager.listSessions()
})

// ── Browser IPC Handlers ─────────────────────────────────

ipcMain.handle('browser:create', (_event, { id, url }) => {
  browserManager.create(id, url)
})

ipcMain.handle('browser:updateStatus', (_event, { id, ...info }) => {
  browserManager.updateStatus(id, info)
})

ipcMain.handle('browser:destroy', (_event, { id }) => {
  browserManager.destroy(id)
})

ipcMain.handle('browser:list', () => {
  return browserManager.listSessions()
})

// ── CDP Proxy IPC Handlers ───────────────────────────────

ipcMain.handle('browser:attachCdp', async (_event, { sessionId, webContentsId, linkedTerminalId }) => {
  try {
    // If this browser is linked to a terminal, the API may have already reserved
    // a CDP server under the terminal's ID. Wire the debugger to it.
    const reservationId = linkedTerminalId || sessionId
    const port = await cdpProxy.wireDebugger(reservationId, webContentsId)
    return { port }
  } catch (err) {
    console.error(`[CDP] Failed to wire debugger for ${sessionId}:`, err)
    return { error: (err as Error).message }
  }
})

ipcMain.handle('browser:detachCdp', (_event, { sessionId }) => {
  cdpProxy.detach(sessionId)
})

ipcMain.handle('browser:cdpCommand', async (_event, { sessionId, method, params }) => {
  return cdpProxy.sendCommand(sessionId, method, params)
})

// ── Workspace IPC Handlers ───────────────────────────────

// ── Settings IPC ──
ipcMain.handle('settings:load', () => loadSettings())
ipcMain.handle('settings:save', (_event, { settings }: { settings: Settings }) => {
  saveSettings(settings)
  mainWindow?.webContents.send('settings:changed', settings)
})
ipcMain.handle('settings:defaults', () => DEFAULT_SETTINGS)

ipcMain.handle('workspace:load', () => {
  return loadWorkspaces()
})

ipcMain.handle('workspace:save', (_event, { workspaces, activeWorkspaceId }) => {
  saveWorkspaces({ workspaces, activeWorkspaceId })
})

ipcMain.handle('workspace:pickDirectory', async () => {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Project Directory'
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

// ── Note IPC Handlers ───────────────────────────────────

ipcMain.handle('note:load', (_event, { noteId }) => {
  return loadNote(noteId)
})

ipcMain.handle('note:save', (_event, { noteId, meta, content }) => {
  saveNote(noteId, meta, content)
})

ipcMain.handle('note:delete', (_event, { noteId }) => {
  deleteNote(noteId)
})

ipcMain.handle('note:list', () => {
  return listNotes()
})

// ── Performance Monitor IPC ──────────────────────────────
ipcMain.handle('perf:toggle', () => {
  if (isPerfEnabled()) {
    stopPerfMonitor()
    return { enabled: false }
  } else {
    startPerfMonitor()
    return { enabled: true }
  }
})

ipcMain.handle('perf:stats', () => {
  return getPerfStats()
})

// Debug: execute JS in the renderer and return result
ipcMain.handle('debug:eval', async (_event, code: string) => {
  return mainWindow?.webContents.executeJavaScript(code)
})

// Debug: capture performance profile
ipcMain.handle('debug:profile', async (_event, durationMs: number) => {
  const wc = mainWindow?.webContents
  if (!wc) return null

  // Start frame monitoring
  const result = await wc.executeJavaScript(`
    new Promise(resolve => {
      const frames = [];
      let lastTime = performance.now();
      let renderCount = 0;

      // Monitor frames
      function onFrame(ts) {
        const delta = ts - lastTime;
        frames.push(delta);
        lastTime = ts;
        if (frames.length < ${Math.ceil(durationMs / 16)}) {
          requestAnimationFrame(onFrame);
        } else {
          const avg = frames.reduce((a, b) => a + b, 0) / frames.length;
          const max = Math.max(...frames);
          const jank = frames.filter(f => f > 33).length;
          resolve({
            frameCount: frames.length,
            avgFrameMs: Math.round(avg * 100) / 100,
            maxFrameMs: Math.round(max * 100) / 100,
            jankFrames: jank,
            fps: Math.round(1000 / avg),
            nodeCount: document.querySelectorAll('.react-flow__node').length,
            webglContexts: document.querySelectorAll('canvas').length,
            domNodeCount: document.querySelectorAll('*').length
          });
        }
      }
      requestAnimationFrame(onFrame);
    })
  `)
  return result
})

// ── Batched PTY Output ────────────────────────────────────
// Buffer PTY data per session and flush every 4ms to avoid
// flooding the IPC channel (Solo uses the same 4ms interval).
const dataBuffers = new Map<string, string>()
let flushScheduled = false
const FLUSH_INTERVAL_MS = 4

// ── Scrollback Buffers (for workspace-switch reconnect) ──
const scrollbackBuffers = new Map<string, string>()
const pausedSessions = new Set<string>()
const MAX_SCROLLBACK = 1_048_576 // 1MB

function scheduleFlush(): void {
  if (flushScheduled) return
  flushScheduled = true
  setTimeout(() => {
    flushScheduled = false
    for (const [id, data] of dataBuffers) {
      mainWindow?.webContents.send('terminal:data', { id, data })
      recordIpc('terminal:data')
    }
    dataBuffers.clear()
  }, FLUSH_INTERVAL_MS)
}

terminalManager.on('data', (id: string, data: string) => {
  // Always accumulate in scrollback buffer (for reconnect after workspace switch)
  let buf = (scrollbackBuffers.get(id) || '') + data
  if (buf.length > MAX_SCROLLBACK) {
    const trimPoint = buf.indexOf('\n', buf.length - MAX_SCROLLBACK)
    buf = trimPoint >= 0 ? buf.slice(trimPoint + 1) : buf.slice(-MAX_SCROLLBACK)
  }
  scrollbackBuffers.set(id, buf)

  // Only buffer for IPC if not paused (paused during reconnect)
  if (pausedSessions.has(id)) return
  const existing = dataBuffers.get(id) || ''
  dataBuffers.set(id, existing + data)
  scheduleFlush()
})

terminalManager.on('exit', (id: string, exitCode: number) => {
  scrollbackBuffers.delete(id)
  pausedSessions.delete(id)
  dataBuffers.delete(id)
  mainWindow?.webContents.send('terminal:exit', { id, exitCode })
})

terminalManager.on('status', (id: string, info: { status: string; cwd: string; foregroundProcess: string; metadata?: Record<string, unknown> }) => {
  mainWindow?.webContents.send('terminal:status', { id, ...info })
  recordIpc('terminal:status')
})

// ── Canvas API Events ────────────────────────────────────
// Forward HTTP API requests to the renderer as browser-request events

canvasApi.on('browser-open', async (info: { url: string; terminalId?: string; width?: number; height?: number }, reply: (result: unknown) => void) => {
  const terminalId = info.terminalId || 'api'

  // Always reserve a CDP port IMMEDIATELY so agent-browser can connect
  // before the webview even mounts. Use the terminal's pre-allocated port
  // if available, otherwise allocate a new one.
  let cdpPort: number
  const reservationId = terminalId !== 'api' ? terminalId : `browser-${Date.now()}`

  if (terminalId !== 'api') {
    const termSession = terminalManager.getSession(terminalId)
    cdpPort = termSession?.cdpPort ?? 0
  } else {
    cdpPort = 0 // Let the OS assign
  }

  try {
    cdpPort = await cdpProxy.reserve(reservationId, cdpPort)
  } catch (err) {
    console.warn(`[CDP] Could not reserve port:`, err)
  }

  mainWindow?.webContents.send('terminal:browser-request', {
    terminalId,
    url: info.url,
    reservationId,
    width: info.width,
    height: info.height
  })
  reply({ ok: true, cdpPort, message: `Browser tile opening for ${info.url}` })
})

canvasApi.on('browser-resize', (info: { sessionId: string; width: number; height: number }, reply: (result: unknown) => void) => {
  mainWindow?.webContents.send('canvas:browser-resize', {
    sessionId: info.sessionId,
    width: info.width,
    height: info.height
  })
  reply({ ok: true })
})

canvasApi.on('browser-close', (info: { sessionId: string }, reply: (result: unknown) => void) => {
  mainWindow?.webContents.send('canvas:browser-close', { sessionId: info.sessionId })
  reply({ ok: true })
})

canvasApi.on('terminal-metadata', (info: { terminalId: string; key: string; value: unknown }, reply: (result: unknown) => void) => {
  const ok = terminalManager.setMetadata(info.terminalId, info.key, info.value)
  reply(ok ? { ok: true } : { ok: false, error: 'Terminal not found' })
})

canvasApi.on('status-request', (reply: (data: unknown) => void) => {
  const terminals = terminalManager.listSessions()
  const browsers = browserManager.listSessions()
  reply({ terminals, browsers })
})

// ── App Lifecycle ─────────────────────────────────────────

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.agentcanvas.app')

  // Accept self-signed certificates for local dev domains (.test, .local, localhost)
  app.on('certificate-error', (event, _webContents, url, _error, _cert, callback) => {
    const hostname = new URL(url).hostname
    if (hostname.endsWith('.test') || hostname.endsWith('.local') || hostname === 'localhost') {
      event.preventDefault()
      callback(true)
    } else {
      callback(false)
    }
  })

  // Ensure ~/AgentCanvas/tmp/ exists for note storage
  ensureNoteDir()

  // Start the local control API before creating the window/terminals
  canvasApiPort = await canvasApi.start()

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  terminalManager.destroyAll()
  browserManager.destroyAll()
  cdpProxy.destroyAll()
  canvasApi.stop()
  if (process.platform !== 'darwin') app.quit()
})
