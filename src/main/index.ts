import { app, BrowserWindow, ipcMain, shell, dialog, Menu, globalShortcut } from 'electron'
import { join } from 'path'
import { execFile, spawn } from 'child_process'
import { promisify } from 'util'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'

const execFileAsync = promisify(execFile)
import { TerminalManager } from './terminal-manager'
import { BrowserManager } from './browser-manager'
import { CdpProxy } from './cdp-proxy'
import { CanvasApi } from './canvas-api'
import { startPerfMonitor, stopPerfMonitor, getPerfStats, recordIpc, isPerfEnabled } from './perf-monitor'
import { loadWorkspaces, saveWorkspaces } from './workspace-store'
import { ensureNoteDir, loadNote, saveNote, deleteNote, listNotes } from './note-store'
import { ensureDrawDir, loadDraw, saveDraw, deleteDraw, listDraws } from './draw-store'
import { jsonToMarkdown } from './note-converter'
import { loadSettings, saveSettings, DEFAULT_SETTINGS, type Settings } from './settings-store'
import { loadTerminals, saveTerminals, type PersistedTerminal } from './terminal-store'
import { loadEdges, saveEdges } from './edge-store'
import { loadBrowsers, saveBrowsers, type PersistedBrowser } from './browser-store'
import { DiffService } from './diff-service'

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
const diffService = new DiffService()
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

  // DevTools tile: intercept webview attachment to call setDevToolsWebContents
  // BEFORE the guest navigates (required by Electron API).

  // Dev server in development, file:// in production
  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ── IPC Handlers ──────────────────────────────────────────

ipcMain.handle('terminal:create', async (_event, { id, label, cwd, metadata }) => {
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
    // Ensure CDP proxy is still listening on reconnect
    try {
      await cdpProxy.reserve(id, existingSession.cdpPort)
    } catch { /* already reserved or port conflict — safe to ignore */ }
    return { cdpPort: existingSession.cdpPort, isReconnect: true }
  }

  const currentSettings = loadSettings()
  const extraEnv: Record<string, string> = { ...currentSettings.terminal.customEnvVars }
  if (canvasApiPort) {
    extraEnv.AGENT_CANVAS_API = `http://127.0.0.1:${canvasApiPort}`
  }
  const cdpPort = await terminalManager.create(id, label, cwd, 80, 24, extraEnv, currentSettings.general.shell)

  // Eagerly start CDP proxy server so agent-browser can connect immediately.
  // Commands are queued until a browser tile attaches (Phase 2).
  try {
    await cdpProxy.reserve(id, cdpPort)
  } catch (err) {
    console.warn(`[CDP] Could not eagerly reserve port ${cdpPort} for terminal ${id}:`, err)
  }

  // Restore metadata if provided (e.g., worktree info from persisted session)
  if (metadata) {
    for (const [key, value] of Object.entries(metadata)) {
      terminalManager.setMetadata(id, key, value)
    }
  }

  // If there's persisted scrollback (from a previous app session), trigger
  // the reconnect path so useTerminal replays it into xterm
  if (scrollbackBuffers.has(id)) {
    pausedSessions.add(id)
    return { cdpPort, isReconnect: true }
  }

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
  cdpProxy.detach(id)
})

ipcMain.handle('terminal:resume', (_event, { id }) => {
  const scrollback = scrollbackBuffers.get(id) || ''
  pausedSessions.delete(id)
  return { scrollback }
})

ipcMain.handle('terminal:list', () => {
  return terminalManager.listSessions()
})

ipcMain.handle('terminal:set-metadata', (_event, { id, key, value }: { id: string; key: string; value: unknown }) => {
  terminalManager.setMetadata(id, key, value)
  return { ok: true }
})

ipcMain.handle('terminal:rename', (_event, { id, label }: { id: string; label: string }) => {
  return terminalManager.rename(id, label)
})

ipcMain.handle('terminal:list-worktrees', async (_event, { cwd }: { cwd: string }) => {
  const gitEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  try {
    // Find the repo root first
    const { stdout: root } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd, env: gitEnv })
    const repoRoot = root.trim()

    const { stdout } = await execFileAsync('git', ['worktree', 'list', '--porcelain'], { cwd: repoRoot, env: gitEnv })
    const worktrees: Array<{ path: string; branch: string; head: string; bare: boolean }> = []
    let current: { path: string; branch: string; head: string; bare: boolean } | null = null

    for (const line of stdout.split('\n')) {
      if (line.startsWith('worktree ')) {
        if (current) worktrees.push(current)
        current = { path: line.slice(9), branch: '', head: '', bare: false }
      } else if (line.startsWith('HEAD ') && current) {
        current.head = line.slice(5)
      } else if (line.startsWith('branch ') && current) {
        current.branch = line.slice(7).replace('refs/heads/', '')
      } else if (line === 'bare' && current) {
        current.bare = true
      }
    }
    if (current) worktrees.push(current)

    // Exclude bare repos and the main working tree (always first, path matches repo root)
    return worktrees.filter(w => !w.bare && w.path !== repoRoot)
  } catch {
    return []
  }
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

// ── IDE IPC ──

// Map setting values to macOS app names for `open -a`
const IDE_APP_NAMES: Record<string, string> = {
  cursor: 'Cursor',
  code: 'Visual Studio Code',
  zed: 'Zed',
  subl: 'Sublime Text',
  idea: 'IntelliJ IDEA',
  webstorm: 'WebStorm',
  nova: 'Nova',
  fleet: 'Fleet'
}

ipcMain.handle('ide:open', async (_event, { path }: { path: string }) => {
  const currentSettings = loadSettings()
  const ideCommand = currentSettings.general.ideCommand
  if (!ideCommand) {
    return { error: 'no-ide-configured' }
  }

  const appName = IDE_APP_NAMES[ideCommand]
  const args = appName ? ['-a', appName, path] : [path]
  const bin = appName ? '/usr/bin/open' : ideCommand

  const child = spawn(bin, args, {
    detached: true,
    stdio: 'ignore'
  })
  return new Promise<{ ok?: boolean; error?: string }>((resolve) => {
    child.on('error', (err) => resolve({ error: err.message }))
    child.unref()
    setImmediate(() => resolve({ ok: true }))
  })
})

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

// ── Terminal Tiles Persistence ───────────────────────────
import { existsSync, writeFileSync } from 'fs'

ipcMain.on('terminal-tiles:save-layout', (event, layout: Array<{
  sessionId: string
  position: { x: number; y: number }
  width: number
  height: number
  workspaceId: string
}>) => {
  const sessions = terminalManager.listSessions()
  const sessionMap = new Map(sessions.map(s => [s.id, s]))

  const terminals: PersistedTerminal[] = layout
    .map(tile => {
      const session = sessionMap.get(tile.sessionId)
      if (!session) return null
      // Merge any pending data into the scrollback for this session
      const pending = dataBuffers.get(tile.sessionId) || ''
      const scrollback = (scrollbackBuffers.get(tile.sessionId) || '') + pending
      return {
        sessionId: tile.sessionId,
        label: session.label,
        cwd: session.cwd,
        position: tile.position,
        width: tile.width,
        height: tile.height,
        workspaceId: tile.workspaceId,
        metadata: session.metadata,
        createdAt: session.createdAt,
        scrollback: scrollback || undefined
      }
    })
    .filter((t): t is PersistedTerminal => t !== null)

  saveTerminals({ version: 1, terminals })
  event.returnValue = true
})

ipcMain.handle('terminal-tiles:load', () => {
  const data = loadTerminals()

  // Override CWD with worktree path when a worktree is assigned
  for (const t of data.terminals) {
    const wt = t.metadata?.worktree as { path?: string } | undefined
    if (wt?.path && existsSync(wt.path)) {
      t.cwd = wt.path
    }
  }

  const valid = data.terminals.filter(t => {
    try {
      return existsSync(t.cwd)
    } catch {
      return false
    }
  })

  // Pre-populate scrollback buffers so the reconnect path replays them
  for (const t of valid) {
    if (t.scrollback) {
      scrollbackBuffers.set(t.sessionId, t.scrollback)
    }
  }

  return valid
})

// ── Browser Tiles Persistence ────────────────────────────

ipcMain.on('browser-tiles:save-layout', (event, layout: Array<{
  sessionId: string
  label: string
  position: { x: number; y: number }
  width: number
  height: number
  workspaceId: string
  linkedTerminalId?: string
  initialPreset?: { name: string; width: number; height: number; mobile: boolean; dpr: number }
}>) => {
  const browsers: PersistedBrowser[] = layout
    .map(tile => {
      const session = browserManager.getSession(tile.sessionId)
      if (!session) return null
      return {
        sessionId: tile.sessionId,
        label: tile.label,
        url: session.url,
        position: tile.position,
        width: tile.width,
        height: tile.height,
        workspaceId: tile.workspaceId,
        linkedTerminalId: tile.linkedTerminalId,
        initialPreset: tile.initialPreset,
        createdAt: session.createdAt
      }
    })
    .filter((b): b is PersistedBrowser => b !== null)

  saveBrowsers({ version: 1, browsers })
  event.returnValue = true
})

ipcMain.handle('browser-tiles:load', () => {
  const data = loadBrowsers()
  const terminalData = loadTerminals()
  const validTerminalIds = new Set(terminalData.terminals.map(t => t.sessionId))

  return data.browsers.map(b => ({
    ...b,
    linkedTerminalId: b.linkedTerminalId && validTerminalIds.has(b.linkedTerminalId)
      ? b.linkedTerminalId
      : undefined
  }))
})

// ── Edge Persistence ─────────────────────────────────────

ipcMain.on('edges:save', (event, edges) => {
  saveEdges({ version: 1, edges })
  event.returnValue = true
})

ipcMain.handle('edges:load', () => {
  return loadEdges().edges
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

ipcMain.handle(
  'note:export',
  async (_event, { noteId, format }: { noteId: string; format: 'markdown' | 'json' }) => {
    if (!mainWindow) return false
    const note = loadNote(noteId)
    if (!note) return false

    const ext = format === 'markdown' ? 'md' : 'json'
    const filterName = format === 'markdown' ? 'Markdown' : 'JSON'
    const defaultName = `${note.meta.label || 'note'}.${ext}`

    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export Note',
      defaultPath: defaultName,
      filters: [{ name: filterName, extensions: [ext] }]
    })

    if (result.canceled || !result.filePath) return false

    const output =
      format === 'markdown'
        ? jsonToMarkdown(note.content)
        : JSON.stringify(note.content, null, 2)

    writeFileSync(result.filePath, output, 'utf-8')
    return true
  }
)

// ── Draw IPC Handlers ───────────────────────────────────

ipcMain.handle('draw:load', (_event, { drawId }) => {
  return loadDraw(drawId)
})

ipcMain.handle('draw:save', (_event, { drawId, meta, elements, appState }) => {
  saveDraw(drawId, meta, elements, appState)
})

ipcMain.handle('draw:delete', (_event, { drawId }) => {
  deleteDraw(drawId)
})

ipcMain.handle('draw:list', () => {
  return listDraws()
})

// ── Diff IPC Handler ─────────────────────────────────────

ipcMain.handle('diff:compute', (_event, { cwd }: { cwd: string }) => {
  return diffService.computeDiff(cwd)
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
  cdpProxy.detach(id)
  mainWindow?.webContents.send('terminal:exit', { id, exitCode })
})

terminalManager.on('status', (id: string, info: { status: string; cwd: string; foregroundProcess: string; metadata?: Record<string, unknown> }) => {
  mainWindow?.webContents.send('terminal:status', { id, ...info })
  recordIpc('terminal:status')
})

// ── CDP Proxy Events ─────────────────────────────────────
// Auto-spawn a browser tile when agent-browser connects to a terminal's
// CDP proxy before any browser tile has been created via the Canvas API.
cdpProxy.on('client-connected-pending', ({ sessionId }: { sessionId: string }) => {
  const termSession = terminalManager.getSession(sessionId)
  if (!termSession) return
  mainWindow?.webContents.send('terminal:browser-request', {
    terminalId: sessionId,
    url: 'about:blank',
    reservationId: sessionId
  })
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

canvasApi.on('tile-rename', (info: { sessionId: string; label: string }, reply: (result: unknown) => void) => {
  // Update terminal session label if it's a terminal
  terminalManager.rename(info.sessionId, info.label)
  // Forward to renderer to update React node state
  mainWindow?.webContents.send('canvas:tile-rename', {
    sessionId: info.sessionId,
    label: info.label
  })
  reply({ ok: true })
})

canvasApi.on('draw-open', (info: { terminalId?: string; label?: string }, reply: (result: unknown) => void) => {
  mainWindow?.webContents.send('canvas:draw-open', info)
  reply({ ok: true })
})

canvasApi.on('draw-update', (info: { sessionId: string; mermaid?: string; elements?: unknown[]; mode?: string }, reply: (result: unknown) => void) => {
  mainWindow?.webContents.send('canvas:draw-update', info)
  reply({ ok: true })
})

canvasApi.on('draw-close', (info: { sessionId: string }, reply: (result: unknown) => void) => {
  mainWindow?.webContents.send('canvas:draw-close', { sessionId: info.sessionId })
  reply({ ok: true })
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

  // Custom application menu — removes default Cmd+R reload accelerator so it
  // doesn't bypass before-input-event and reload the Electron shell.
  const isMac = process.platform === 'darwin'
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    { role: 'editMenu' as const },
    {
      label: 'View',
      submenu: [
        // Deliberately omit { role: 'reload' } and { role: 'forceReload' }
        { role: 'toggleDevTools' as const },
        { type: 'separator' as const },
        { role: 'resetZoom' as const },
        { role: 'zoomIn' as const },
        { role: 'zoomOut' as const },
        { type: 'separator' as const },
        { role: 'togglefullscreen' as const }
      ]
    },
    { role: 'windowMenu' as const }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))

  // Ensure ~/AgentCanvas/tmp/ exists for note/draw storage
  ensureNoteDir()
  ensureDrawDir()

  // Start the local control API before creating the window/terminals
  canvasApiPort = await canvasApi.start()

  app.on('browser-window-created', (_, window) => {
    window.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return

      // Cmd+R / Ctrl+R (but NOT Cmd+Shift+R — leave hard-refresh for dev)
      const isRefresh =
        (input.code === 'KeyR' && (input.control || input.meta) && !input.shift) ||
        (input.code === 'F5' && !input.control && !input.meta && !input.shift)
      if (isRefresh) {
        event.preventDefault()
        mainWindow?.webContents.send('browser:refresh-focused')
        return
      }

      // F12 DevTools toggle (dev only) — replaces optimizer.watchWindowShortcuts
      if (is.dev && input.code === 'F12') {
        const wc = window.webContents
        if (wc.isDevToolsOpened()) wc.closeDevTools()
        else wc.openDevTools({ mode: 'undocked' })
        event.preventDefault()
      }
    })
  })

  createWindow()

  // Register Cmd+R / F5 as global shortcuts while the window is focused.
  // globalShortcut fires at the OS level — before NSMenu accelerators and
  // before Chromium's input pipeline — so it reliably prevents the Electron
  // shell from reloading.
  const registerRefreshShortcuts = (): void => {
    if (!globalShortcut.isRegistered('CommandOrControl+R')) {
      globalShortcut.register('CommandOrControl+R', () => {
        mainWindow?.webContents.send('browser:refresh-focused')
      })
    }
    if (!globalShortcut.isRegistered('F5')) {
      globalShortcut.register('F5', () => {
        mainWindow?.webContents.send('browser:refresh-focused')
      })
    }
  }
  const unregisterRefreshShortcuts = (): void => {
    globalShortcut.unregister('CommandOrControl+R')
    globalShortcut.unregister('F5')
  }

  mainWindow!.on('focus', registerRefreshShortcuts)
  mainWindow!.on('blur', unregisterRefreshShortcuts)
  // Window already has focus right after creation
  registerRefreshShortcuts()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  globalShortcut.unregisterAll()
  terminalManager.destroyAll()
  browserManager.destroyAll()
  cdpProxy.destroyAll()
  canvasApi.stop()
  if (process.platform !== 'darwin') app.quit()
})
