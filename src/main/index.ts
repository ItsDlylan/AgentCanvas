import { app, BrowserWindow, ipcMain, shell, dialog, Menu, globalShortcut, protocol, net } from 'electron'
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
import {
  ensurePlanDir,
  createPlan as storeCreatePlan,
  loadPlan as storeLoadPlan,
  updatePlan as storeUpdatePlan,
  transition as storeTransition,
  approvePlan as storeApprovePlan,
  unapprovePlan as storeUnapprovePlan,
  attachVerifierTerminal as storeAttachVerifier,
  attachExecutorTerminal as storeAttachExecutor,
  attachPR as storeAttachPR,
  recordCritique as storeRecordCritique,
  completeStep as storeCompleteStep,
  markStepInProgress as storeMarkStepInProgress,
  addDeviation as storeAddDeviation,
  markPlanDone as storeMarkPlanDone,
  markExecutionFailed as storeMarkExecutionFailed,
  archivePlan as storeArchivePlan,
  deletePlan as storeDeletePlan,
  listPlans as storeListPlans,
  latestVersion as storeLatestVersion,
  getApprovedVersion as storeGetApprovedVersion,
  renderProgressSummary as storeRenderProgressSummary,
  type PlanBody,
  type PlanDoc,
  type Verdict
} from './plan-store'
import { isValidTiptapDoc } from './tiptap-validator'
import { saveAttachment, saveAttachmentFromPath, deleteAttachments, listAttachments, sweepNoteAttachments, sweepAllAttachments } from './attachment-store'
import { ensureDrawDir, loadDraw, saveDraw, deleteDraw, listDraws } from './draw-store'
import { loadImage, saveImage, deleteImage, listImages, storeImage } from './image-store'
import { jsonToMarkdown } from './note-converter'
import { loadSettings, saveSettings, DEFAULT_SETTINGS, type Settings } from './settings-store'
import { loadTerminals, saveTerminals, type PersistedTerminal } from './terminal-store'
import { loadEdges, saveEdges } from './edge-store'
import { loadPomodoro, savePomodoro } from './pomodoro-store'
import { loadBrowsers, saveBrowsers, type PersistedBrowser } from './browser-store'
import { DiffService } from './diff-service'
import { loadExtensions, getLoadedExtensions, getExtensionsDir } from './extension-loader'
import { TeamWatcher } from './team-watcher'
import { claudeUsageService } from './claude-usage-service'
import type { ClaudeUsageSnapshot } from '../renderer/types/claude-usage'

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
const teamWatcher = new TeamWatcher()
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
  // If no workspace path was provided, fall back to the user's defaultCwd setting.
  // Terminal manager falls back to os.homedir() after that.
  const effectiveCwd = cwd || currentSettings.general.defaultCwd || undefined
  const cdpPort = await terminalManager.create(id, label, effectiveCwd, 80, 24, extraEnv, currentSettings.general.shell)

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

ipcMain.handle('terminal:keep-alive', (_event, { id }: { id: string }) => {
  return { ok: terminalManager.keepAlive(id) }
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

ipcMain.handle('browser:extensions', () => {
  return getLoadedExtensions().map(ext => ({
    id: ext.id, name: ext.name, path: ext.path, version: ext.version
  }))
})

ipcMain.handle('browser:openExtensionsDir', () => {
  shell.openPath(getExtensionsDir())
})

// ── Workspace IPC Handlers ───────────────────────────────

// ── Settings IPC ──
function applyPromptCacheSettings(settings: Settings): void {
  const pc = settings.promptCache
  if (!pc) return
  terminalManager.setCacheSettings({
    ttlSeconds: pc.ttlSeconds,
    warningThresholdSeconds: pc.warningThresholdSeconds,
    autoKeepAlive: pc.autoKeepAlive,
    keepAliveMessage: pc.keepAliveMessage,
    maxAutoKeepAlives: pc.maxAutoKeepAlives,
    notifyOnWarning: pc.notifyOnWarning,
    notifyOnExpiry: pc.notifyOnExpiry,
    detectTtlFromLogs: pc.detectTtlFromLogs
  })
}

// Apply initial prompt cache settings on startup
applyPromptCacheSettings(loadSettings())

ipcMain.handle('settings:load', () => loadSettings())
ipcMain.handle('settings:save', (_event, { settings }: { settings: Settings }) => {
  saveSettings(settings)
  applyPromptCacheSettings(settings)
  mainWindow?.webContents.send('settings:changed', settings)
})
ipcMain.handle('settings:defaults', () => DEFAULT_SETTINGS)

// ── Project Templates IPC ──

import { loadProjectTemplates, saveProjectTemplates, deleteProjectTemplates } from './template-store'

ipcMain.handle('templates:load-project', (_event, { workspaceId }: { workspaceId: string }) =>
  loadProjectTemplates(workspaceId)
)
ipcMain.handle('templates:save-project', (_event, { workspaceId, templates }: { workspaceId: string; templates: import('./settings-store').WorkspaceTemplate[] }) => {
  saveProjectTemplates(workspaceId, templates)
})
ipcMain.handle('templates:delete-project', (_event, { workspaceId }: { workspaceId: string }) => {
  deleteProjectTemplates(workspaceId)
})

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

// ── Pomodoro IPC ──────────────────────────────────────────
ipcMain.handle('pomodoro:load', () => loadPomodoro())
ipcMain.handle('pomodoro:save', (_event, { data }) => savePomodoro(data))

// ── Claude Code Usage IPC ────────────────────────────────
ipcMain.handle('claude-usage:load', () => claudeUsageService.getSnapshot())
claudeUsageService.on('changed', (snapshot: ClaudeUsageSnapshot) => {
  mainWindow?.webContents.send('claude-usage:changed', snapshot)
})
claudeUsageService.start()

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

const SHELL_NAMES = new Set(['zsh', 'bash', 'fish', 'sh', 'csh', 'tcsh', 'dash', 'ksh', 'login', '-zsh', '-bash', '-fish', '-sh'])

ipcMain.on('terminal-tiles:save-layout', (event, layout: Array<{
  sessionId: string
  position: { x: number; y: number }
  width: number
  height: number
  workspaceId: string
  command?: string
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

      // Persist command: prefer explicit command from node data, fall back to
      // detected foreground command line (skip if it's just the shell)
      const isShell = SHELL_NAMES.has(session.foregroundProcess) ||
        SHELL_NAMES.has(session.foregroundProcess.replace(/^-/, ''))
      const detectedCmd = (!isShell && session.foregroundCommandLine) || undefined
      const command = tile.command || detectedCmd

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
        scrollback: scrollback || undefined,
        command
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

ipcMain.handle('note:save', async (_event, { noteId, meta, content }) => {
  await saveNote(noteId, meta, content)
})

ipcMain.handle('note:delete', (_event, { noteId }) => {
  deleteNote(noteId)
  deleteAttachments(noteId)
})

ipcMain.handle('note:list', () => {
  return listNotes()
})

// ── Plan IPC Handlers (renderer → main) ──

ipcMain.handle('plan:load', (_event, { planId }: { planId: string }) => {
  return storeLoadPlan(planId)
})

ipcMain.handle('plan:list', () => {
  return storeListPlans().map((p) => p.meta)
})

ipcMain.handle('plan:create', async (_event, input: {
  label?: string; content?: string | Partial<PlanBody>;
  linkedTerminalId?: string; position?: { x: number; y: number };
  width?: number; height?: number; workspaceId?: string
}) => {
  try {
    const doc = await storeCreatePlan(input)
    mainWindow?.webContents.send('canvas:plan-open', { planId: doc.meta.planId, meta: doc.meta })
    return { ok: true, planId: doc.meta.planId, meta: doc.meta }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
})

ipcMain.handle('plan:update', async (_event, { planId, patch }: { planId: string; patch: Partial<PlanBody> }) => {
  try {
    const doc = await storeUpdatePlan(planId, patch, 'human')
    const version = storeLatestVersion(doc).version
    mainWindow?.webContents.send('canvas:plan-updated', { planId, version, state: doc.meta.state })
    return { ok: true, version }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
})

ipcMain.handle('plan:move', async (_event, { planId, position }: { planId: string; position: { x: number; y: number } }) => {
  const { movePlan } = await import('./plan-store')
  await movePlan(planId, position)
})

ipcMain.handle('plan:resize', async (_event, { planId, width, height }: { planId: string; width: number; height: number }) => {
  const { resizePlan } = await import('./plan-store')
  await resizePlan(planId, width, height)
})

ipcMain.handle('plan:rename', async (_event, { planId, label }: { planId: string; label: string }) => {
  const { renamePlan } = await import('./plan-store')
  const doc = await renamePlan(planId, label)
  mainWindow?.webContents.send('canvas:plan-updated', { planId, label: doc.meta.label })
})

ipcMain.handle('plan:verify', async (_event, { planId, model }: { planId: string; model?: 'sonnet' | 'opus' }) => {
  return new Promise((resolve) => {
    canvasApi.emit('plan-verify', { planId, model }, resolve)
  })
})

ipcMain.handle('plan:approve', async (_event, { planId }: { planId: string }) => {
  return new Promise((resolve) => {
    canvasApi.emit('plan-approve', { planId }, resolve)
  })
})

ipcMain.handle('plan:unapprove', async (_event, { planId }: { planId: string }) => {
  return new Promise((resolve) => {
    canvasApi.emit('plan-unapprove', { planId }, resolve)
  })
})

ipcMain.handle('plan:execute', async (_event, { planId, cwd }: { planId: string; cwd?: string }) => {
  return new Promise((resolve) => {
    canvasApi.emit('plan-execute', { planId, cwd }, resolve)
  })
})

ipcMain.handle('plan:resume', async (_event, { planId }: { planId: string }) => {
  return new Promise((resolve) => {
    canvasApi.emit('plan-resume', { planId }, resolve)
  })
})

ipcMain.handle('plan:archive', async (_event, { planId }: { planId: string }) => {
  return new Promise((resolve) => {
    canvasApi.emit('plan-archive', { planId }, resolve)
  })
})

ipcMain.handle('plan:delete', async (_event, { planId }: { planId: string }) => {
  storeDeletePlan(planId)
  mainWindow?.webContents.send('canvas:plan-deleted', { planId })
})

ipcMain.handle('plan:link-pr', async (_event, { planId, pr }: { planId: string; pr: string }) => {
  return new Promise((resolve) => {
    canvasApi.emit('plan-link-pr', { planId, pr }, resolve)
  })
})

ipcMain.handle('plan:mark-done', async (_event, { planId }: { planId: string }) => {
  return new Promise((resolve) => {
    canvasApi.emit('plan-mark-done', { planId }, resolve)
  })
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

// ── Attachment IPC Handlers ──────────────────────────────

ipcMain.handle('attachment:save', (_event, { noteId, filename, data }: { noteId: string; filename: string; data: ArrayBuffer }) => {
  return saveAttachment(noteId, filename, Buffer.from(data))
})

ipcMain.handle('attachment:save-from-path', (_event, { noteId, sourcePath }: { noteId: string; sourcePath: string }) => {
  return saveAttachmentFromPath(noteId, sourcePath)
})

ipcMain.handle('attachment:delete-all', (_event, { noteId }: { noteId: string }) => {
  deleteAttachments(noteId)
})

ipcMain.handle('attachment:list', (_event, { noteId }: { noteId: string }) => {
  return listAttachments(noteId)
})

function resolveAttachmentSrc(src: string): string | null {
  const PREFIX = 'agentcanvas://attachment/'
  if (src.startsWith(PREFIX)) {
    const { join } = require('path')
    const { homedir } = require('os')
    return join(homedir(), 'AgentCanvas', 'attachments', src.slice(PREFIX.length))
  }
  if (src.startsWith('file://')) return decodeURI(src.slice('file://'.length))
  if (src.startsWith('/')) return src
  return null
}

ipcMain.handle('attachment:resolve-path', (_event, { src }: { src: string }) => {
  return resolveAttachmentSrc(src)
})

ipcMain.handle('attachment:reveal', (_event, { src }: { src: string }) => {
  const path = resolveAttachmentSrc(src)
  if (!path) return false
  shell.showItemInFolder(path)
  return true
})

ipcMain.handle('attachment:sweep-note', (_event, { noteId }: { noteId: string }) => {
  return sweepNoteAttachments(noteId)
})

ipcMain.handle('attachment:pick-file', async () => {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Insert Media',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'] },
      { name: 'Videos', extensions: ['mp4', 'webm', 'mov', 'avi', 'mkv'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  })
  if (result.canceled) return null
  return result.filePaths
})

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

// ── Image IPC Handlers ──────────────────────────────────

ipcMain.handle('image:load', (_event, { imageId }) => {
  return loadImage(imageId)
})

ipcMain.handle('image:save', (_event, { imageId, meta }) => {
  saveImage(imageId, meta)
})

ipcMain.handle('image:delete', (_event, { imageId }) => {
  deleteImage(imageId)
})

ipcMain.handle('image:list', () => {
  return listImages()
})

ipcMain.handle('image:store', (_event, { sourcePath }: { sourcePath: string }) => {
  return storeImage(sourcePath)
})

ipcMain.handle('image:getUrl', (_event, { imageId }: { imageId: string }) => {
  const img = loadImage(imageId)
  if (!img?.meta.storedFilename) return null
  return `agentcanvas://image/${img.meta.storedFilename}`
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

// ── Voice IPC Handlers ────────────────────────────────────
import { transcribe, downloadModel, getModelStatus } from './voice/whisper-stt'

ipcMain.handle('voice:transcribe', async (_event, { audio, provider, model }: { audio: Buffer; provider?: string; model?: string }) => {
  // Copy into an aligned ArrayBuffer — Node.js Buffers use a pooled ArrayBuffer
  // whose byteOffset may not be 4-byte aligned, breaking Float32Array reads
  const aligned = new ArrayBuffer(audio.byteLength)
  new Uint8Array(aligned).set(new Uint8Array(audio.buffer, audio.byteOffset, audio.byteLength))
  const float32 = new Float32Array(aligned)
  const samples = Array.from(float32)
  return transcribe(samples, (model as 'tiny' | 'base' | 'small') ?? 'tiny')
})

ipcMain.handle('voice:load-model', async (_event, { model }: { model: string }) => {
  return downloadModel(model as 'tiny' | 'base' | 'small', (progress) => {
    mainWindow?.webContents.send('voice:model-progress', model, progress)
  })
})

ipcMain.handle('voice:model-status', async () => {
  return getModelStatus()
})

// ── Wake Word IPC Handlers ────────────────────────────────
import {
  processAudioFrame,
  loadWakeWordEngine,
  unloadWakeWordEngine,
  downloadWakeWordModels,
  getWakeWordModelStatus,
  isWakeWordReady,
  resetDetectionBuffers
} from './voice/wake-word'

let wakeWordActive = false
let wakeWordErrorLogged = false
let lastDetectionTime = 0
const DETECTION_THRESHOLD = 0.6
const WINDOW_SIZE = 5          // Sliding window of recent classifications
const REQUIRED_HITS = 3        // Must have N hits within the window
const DETECTION_COOLDOWN_MS = 3000 // 3s debounce between detections
const recentProbabilities: number[] = []

ipcMain.on('wake-word:audio-frame', async (_event, frame: Buffer) => {
  if (!wakeWordActive) return

  try {
    // Reconstruct Float32Array from Buffer
    const aligned = new ArrayBuffer(frame.byteLength)
    new Uint8Array(aligned).set(new Uint8Array(frame))
    const samples = new Float32Array(aligned)

    const probability = await processAudioFrame(samples)
    if (probability !== null) {
      // Sliding window: track last N classifications
      recentProbabilities.push(probability)
      if (recentProbabilities.length > WINDOW_SIZE) recentProbabilities.shift()

      const hits = recentProbabilities.filter((p) => p > DETECTION_THRESHOLD).length
      if (hits >= REQUIRED_HITS) {
        const now = Date.now()
        if (now - lastDetectionTime > DETECTION_COOLDOWN_MS) {
          lastDetectionTime = now
          console.log(`[wake-word] Detected! probability=${probability.toFixed(3)} (${hits}/${WINDOW_SIZE} above ${DETECTION_THRESHOLD})`)
          mainWindow?.webContents.send('wake-word:detected')
          resetDetectionBuffers()
          recentProbabilities.length = 0
        }
      }
    }
  } catch (err) {
    if (!wakeWordErrorLogged) {
      console.error('[wake-word] Frame processing error:', (err as Error).message)
      wakeWordErrorLogged = true
    }
  }
})

ipcMain.handle('wake-word:load-model', async (_event, { wakeWord }: { wakeWord: string }) => {
  return downloadWakeWordModels(wakeWord)
})

ipcMain.handle('wake-word:start', async (_event, { wakeWord }: { wakeWord: string }) => {
  if (!isWakeWordReady(wakeWord)) {
    const dl = await downloadWakeWordModels(wakeWord)
    if (!dl.ok) return dl
  }
  const result = await loadWakeWordEngine(wakeWord)
  if (result.ok) {
    wakeWordActive = true
    wakeWordErrorLogged = false
    recentProbabilities.length = 0
  }
  return result
})

ipcMain.on('wake-word:stop', () => {
  wakeWordActive = false
  unloadWakeWordEngine()
})

ipcMain.handle('wake-word:model-status', async () => {
  return getWakeWordModelStatus()
})

// ── LLM Discovery IPC Handlers ────────────────────────────
import { discoverLLMEndpoints, getCachedDiscovery } from './voice/llm-discovery'

ipcMain.handle('llm:discover', async (_event, { endpoint, model }: { endpoint?: string; model?: string } = {}) => {
  return discoverLLMEndpoints(endpoint, model)
})

ipcMain.handle('llm:status', async () => {
  return getCachedDiscovery()
})

ipcMain.handle('llm:chat', async (_event, { apiUrl, body }: { apiUrl: string; body: object }) => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)

  try {
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    })
    clearTimeout(timeout)
    if (!res.ok) return { ok: false, status: res.status, error: res.statusText }
    const json = await res.json()
    return { ok: true, data: json }
  } catch (err) {
    clearTimeout(timeout)
    return { ok: false, error: (err as Error).message }
  }
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

terminalManager.on('cache-notify', (info: {
  terminalId: string; title: string; body: string; level: string; priority: string; duration: number
}) => {
  const notifySettings = loadSettings().notifications
  if (notifySettings && !notifySettings.enabled) return
  const id = `cache-${info.terminalId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const payload = {
    id,
    title: info.title,
    body: info.body,
    level: info.level,
    priority: info.priority,
    terminalId: info.terminalId,
    duration: info.duration,
    sound: info.level === 'error',
    timestamp: Date.now()
  }
  mainWindow?.webContents.send('canvas:notify', payload)

  if (mainWindow && !mainWindow.isFocused() && (!notifySettings || notifySettings.nativeWhenUnfocused)) {
    const { Notification: ElectronNotification } = require('electron')
    if (ElectronNotification.isSupported()) {
      new ElectronNotification({
        title: payload.title,
        body: payload.body,
        silent: true
      }).show()
    }
  }
})

browserManager.on('status', (id: string, info: Record<string, unknown>) => {
  mainWindow?.webContents.send('browser:status', { id, ...info })
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

canvasApi.on('terminal-spawn', (info: {
  label?: string; cwd?: string; command?: string; linkedTerminalId?: string;
  width?: number; height?: number; metadata?: Record<string, unknown>
}, reply: (result: unknown) => void) => {
  const terminalId = crypto.randomUUID()
  mainWindow?.webContents.send('canvas:terminal-spawn', {
    terminalId,
    label: info.label,
    cwd: info.cwd,
    command: info.command,
    linkedTerminalId: info.linkedTerminalId,
    width: info.width,
    height: info.height,
    metadata: info.metadata
  })
  reply({ ok: true, terminalId })
})

canvasApi.on('terminal-write', (info: { terminalId: string; data: string }, reply: (result: unknown) => void) => {
  terminalManager.write(info.terminalId, info.data)
  reply({ ok: true })
})

canvasApi.on('terminal-keep-alive', (info: { terminalId: string }, reply: (result: unknown) => void) => {
  const ok = terminalManager.keepAlive(info.terminalId)
  reply(ok ? { ok: true } : { ok: false, error: 'Terminal not found or not a Claude session' })
})

canvasApi.on('template-spawn', (info: { templateId?: string; templateName?: string; origin?: { x: number; y: number } }, reply: (result: unknown) => void) => {
  mainWindow?.webContents.send('canvas:template-spawn', info)
  reply({ ok: true })
})

canvasApi.on('notify', (info: {
  id: string; title?: string; body: string; level: string; priority?: string;
  terminalId?: string; duration: number; sound: boolean; timestamp: number
}, reply: (result: unknown) => void) => {
  const notifySettings = loadSettings().notifications
  if (notifySettings && !notifySettings.enabled) {
    reply({ ok: true, id: info.id, suppressed: true })
    return
  }

  mainWindow?.webContents.send('canvas:notify', info)

  // Native OS notification when window is unfocused
  if (mainWindow && !mainWindow.isFocused() && (!notifySettings || notifySettings.nativeWhenUnfocused)) {
    const { Notification: ElectronNotification } = require('electron')
    if (ElectronNotification.isSupported()) {
      new ElectronNotification({
        title: info.title || 'Agent Canvas',
        body: info.body,
        silent: true
      }).show()
    }
  }

  reply({ ok: true, id: info.id })
})

canvasApi.on('status-request', (reply: (data: unknown) => void) => {
  const terminals = terminalManager.listSessions()
  const browsers = browserManager.listSessions()
  const notes = listNotes()
    .filter((n) => !n.meta.isSoftDeleted)
    .map((n) => ({
      noteId: n.meta.noteId,
      label: n.meta.label,
      workspaceId: n.meta.workspaceId,
      linkedTerminalId: n.meta.linkedTerminalId,
      linkedNoteId: n.meta.linkedNoteId,
      createdAt: n.meta.createdAt,
      updatedAt: n.meta.updatedAt
    }))
  reply({ terminals, browsers, notes })
})

// ── Note API endpoints ──

canvasApi.on('note-open', async (info: {
  noteId: string; label?: string; content?: Record<string, unknown>;
  linkedTerminalId?: string; linkedNoteId?: string;
  position?: { x: number; y: number }; width?: number; height?: number
}, reply: (result: unknown) => void) => {
  if (info.content !== undefined && !isValidTiptapDoc(info.content)) {
    reply({ ok: false, error: 'Invalid TipTap content' })
    return
  }
  await saveNote(info.noteId, {
    noteId: info.noteId,
    label: info.label || 'Note',
    workspaceId: 'default',
    isSoftDeleted: false,
    position: info.position || { x: 100, y: 100 },
    width: info.width || 400,
    height: info.height || 400,
    linkedTerminalId: info.linkedTerminalId,
    linkedNoteId: info.linkedNoteId,
    createdAt: Date.now(),
    updatedAt: Date.now()
  }, info.content)
  mainWindow?.webContents.send('canvas:note-open', info)
  reply({ ok: true, noteId: info.noteId })
})

canvasApi.on('note-update', async (info: { noteId: string; content: Record<string, unknown> }, reply: (result: unknown) => void) => {
  if (!isValidTiptapDoc(info.content)) {
    reply({ ok: false, error: 'Invalid TipTap content' })
    return
  }
  await saveNote(info.noteId, {}, info.content)
  mainWindow?.webContents.send('canvas:note-update', { noteId: info.noteId })
  reply({ ok: true })
})

canvasApi.on('note-read', (info: { noteId: string }, reply: (result: unknown) => void) => {
  const noteFile = loadNote(info.noteId)
  if (!noteFile) {
    reply({ ok: false, error: 'Note not found' })
    return
  }
  reply({
    ok: true,
    noteId: info.noteId,
    meta: noteFile.meta,
    content: noteFile.content,
    markdown: jsonToMarkdown(noteFile.content)
  })
})

canvasApi.on('note-close', (info: { noteId: string }, reply: (result: unknown) => void) => {
  mainWindow?.webContents.send('canvas:note-close', { noteId: info.noteId })
  reply({ ok: true })
})

canvasApi.on('note-delete', (info: { noteId: string }, reply: (result: unknown) => void) => {
  mainWindow?.webContents.send('canvas:note-delete', { noteId: info.noteId })
  reply({ ok: true })
})

canvasApi.on('notes-list', (reply: (data: unknown) => void) => {
  const notes = listNotes()
    .filter((n) => !n.meta.isSoftDeleted)
    .map((n) => ({
      noteId: n.meta.noteId,
      label: n.meta.label,
      workspaceId: n.meta.workspaceId,
      linkedTerminalId: n.meta.linkedTerminalId,
      linkedNoteId: n.meta.linkedNoteId,
      createdAt: n.meta.createdAt,
      updatedAt: n.meta.updatedAt
    }))
  reply({ ok: true, notes })
})

// ── Plan handlers ──

ensurePlanDir()

// Per-plan last-verify timestamps for 30s debounce.
const lastVerifyAt = new Map<string, number>()
const VERIFY_DEBOUNCE_MS = 30_000

function broadcastPlan(planId: string, kind: string, extra: Record<string, unknown> = {}): void {
  mainWindow?.webContents.send(`canvas:plan-${kind}`, { planId, ...extra })
}

function fail(reply: (r: unknown) => void, error: string): void {
  reply({ ok: false, error })
}

canvasApi.on('plan-open', async (info: {
  label?: string; content?: string | Record<string, unknown>;
  linkedTerminalId?: string; position?: { x: number; y: number };
  width?: number; height?: number; workspaceId?: string;
  author?: 'human' | 'capture-hook' | 'revision'
}, reply: (result: unknown) => void) => {
  try {
    const contentForStore: string | Partial<PlanBody> | undefined =
      typeof info.content === 'string'
        ? info.content
        : (info.content as Partial<PlanBody> | undefined)
    const doc = await storeCreatePlan({
      label: info.label,
      workspaceId: info.workspaceId,
      content: contentForStore,
      linkedTerminalId: info.linkedTerminalId,
      position: info.position,
      width: info.width,
      height: info.height,
      author: info.author
    })
    broadcastPlan(doc.meta.planId, 'open', { meta: doc.meta })
    reply({ ok: true, planId: doc.meta.planId, meta: doc.meta })
  } catch (e) {
    fail(reply, (e as Error).message)
  }
})

canvasApi.on('plan-read', (info: { planId: string }, reply: (result: unknown) => void) => {
  const doc = storeLoadPlan(info.planId)
  if (!doc) {
    fail(reply, 'Plan not found')
    return
  }
  reply({ ok: true, planId: info.planId, doc })
})

canvasApi.on('plan-update', async (info: {
  planId: string; patch: Record<string, unknown>;
  author?: 'human' | 'capture-hook' | 'revision'
}, reply: (result: unknown) => void) => {
  try {
    const doc = await storeUpdatePlan(info.planId, info.patch as Partial<PlanBody>, info.author ?? 'human')
    broadcastPlan(info.planId, 'updated', { version: storeLatestVersion(doc).version, state: doc.meta.state })
    reply({ ok: true, version: storeLatestVersion(doc).version })
  } catch (e) {
    fail(reply, (e as Error).message)
  }
})

canvasApi.on('plan-verify', async (info: {
  planId: string; model?: 'sonnet' | 'opus'
}, reply: (result: unknown) => void) => {
  try {
    const doc = storeLoadPlan(info.planId)
    if (!doc) {
      fail(reply, 'Plan not found')
      return
    }
    const now = Date.now()
    const last = lastVerifyAt.get(info.planId) ?? 0
    if (now - last < VERIFY_DEBOUNCE_MS) {
      fail(reply, 'Verify debounced; try again in a moment')
      return
    }
    lastVerifyAt.set(info.planId, now)

    const flipped = await storeTransition(info.planId, 'under_critique')

    const verifierTerminalId = crypto.randomUUID()
    await storeAttachVerifier(info.planId, verifierTerminalId)

    const model = info.model ?? 'sonnet'
    const planMarkdown = renderPlanAsMarkdown(flipped)
    const verifierPromptPath = join(app.getAppPath(), 'scripts', 'plan-verifier-prompt.md')

    // Spawn verifier terminal via the existing terminal-spawn broadcast pathway.
    mainWindow?.webContents.send('canvas:terminal-spawn', {
      terminalId: verifierTerminalId,
      label: `Plan Verifier · ${flipped.meta.label}`,
      cwd: undefined, // inherit from linked authoring terminal (renderer resolves)
      command: [
        `export AGENT_CANVAS_PLAN_ID='${info.planId}'`,
        `export AGENT_CANVAS_PLAN_ROLE='verifier'`,
        `claude --model ${model} --permission-mode plan --append-system-prompt "$(cat ${shellQuote(verifierPromptPath)})" ${shellQuote(planMarkdown)}`
      ].join(' && ') + '\n',
      linkedTerminalId: flipped.meta.linkedTerminalId,
      metadata: {
        team: { role: 'plan-verifier', teamName: 'plan-review' },
        planId: info.planId,
        planRole: 'verifier'
      }
    })
    broadcastPlan(info.planId, 'state', { state: 'under_critique', verifierTerminalId })
    reply({ ok: true, verifierTerminalId })
  } catch (e) {
    fail(reply, (e as Error).message)
  }
})

canvasApi.on('plan-verify-complete', async (info: {
  planId: string; verdict: Verdict; critiqueMarkdown?: string
}, reply: (result: unknown) => void) => {
  try {
    const doc = storeLoadPlan(info.planId)
    if (!doc) {
      fail(reply, 'Plan not found')
      return
    }
    // Create a linked critique Note Tile via note-store directly.
    const { randomUUID } = await import('crypto')
    const critiqueNoteId = randomUUID()
    const { markdownToTiptap } = await import('./markdown-to-tiptap')
    const markdown = info.critiqueMarkdown ?? renderVerdictAsMarkdown(info.verdict)
    await saveNote(critiqueNoteId, {
      noteId: critiqueNoteId,
      label: `Critique · ${doc.meta.label} · v${storeLatestVersion(doc).version}`,
      workspaceId: doc.meta.workspaceId,
      isSoftDeleted: false,
      position: { x: doc.meta.position.x + doc.meta.width + 40, y: doc.meta.position.y },
      width: 420,
      height: 420,
      linkedNoteId: undefined, // the plan is not a note; the amber edge is rendered by Canvas from plan.critiqueNoteIds
      createdAt: Date.now(),
      updatedAt: Date.now()
    }, markdownToTiptap(markdown))
    mainWindow?.webContents.send('canvas:note-open', { noteId: critiqueNoteId })

    const updated = await storeRecordCritique(info.planId, {
      version: storeLatestVersion(doc).version,
      noteId: critiqueNoteId,
      verdict: info.verdict,
      timestamp: Date.now()
    })
    broadcastPlan(info.planId, 'state', { state: updated.meta.state, critiqueNoteId })
    reply({ ok: true, critiqueNoteId })
  } catch (e) {
    fail(reply, (e as Error).message)
  }
})

canvasApi.on('plan-approve', async (info: { planId: string }, reply: (result: unknown) => void) => {
  try {
    const doc = await storeApprovePlan(info.planId)
    broadcastPlan(info.planId, 'state', { state: doc.meta.state, approvedVersion: doc.meta.approvedVersion })
    reply({ ok: true, approvedVersion: doc.meta.approvedVersion })
  } catch (e) {
    fail(reply, (e as Error).message)
  }
})

canvasApi.on('plan-unapprove', async (info: { planId: string }, reply: (result: unknown) => void) => {
  try {
    const doc = await storeUnapprovePlan(info.planId)
    broadcastPlan(info.planId, 'state', { state: doc.meta.state })
    reply({ ok: true })
  } catch (e) {
    fail(reply, (e as Error).message)
  }
})

canvasApi.on('plan-execute', async (info: { planId: string; cwd?: string }, reply: (result: unknown) => void) => {
  try {
    const doc = storeLoadPlan(info.planId)
    if (!doc) { fail(reply, 'Plan not found'); return }
    if (doc.meta.state !== 'approved') {
      fail(reply, `Cannot execute in state: ${doc.meta.state}`)
      return
    }
    const approved = storeGetApprovedVersion(doc)
    if (!approved) { fail(reply, 'No approved version'); return }

    const flipped = await storeTransition(info.planId, 'executing')
    const executorTerminalId = crypto.randomUUID()
    await storeAttachExecutor(info.planId, executorTerminalId)

    const executorPromptPath = join(app.getAppPath(), 'scripts', 'plan-executor-prompt.md')
    const planMarkdown = renderPlanAsMarkdown(flipped)

    mainWindow?.webContents.send('canvas:terminal-spawn', {
      terminalId: executorTerminalId,
      label: `Executing · ${flipped.meta.label}`,
      cwd: info.cwd,
      command: [
        `export AGENT_CANVAS_PLAN_ID='${info.planId}'`,
        `export AGENT_CANVAS_PLAN_ROLE='executor'`,
        `claude --permission-mode acceptEdits --append-system-prompt "$(cat ${shellQuote(executorPromptPath)})" ${shellQuote(planMarkdown)}`
      ].join(' && ') + '\n',
      linkedTerminalId: flipped.meta.linkedTerminalId,
      metadata: {
        team: { role: 'plan-executor', teamName: 'plan-execution' },
        planId: info.planId,
        planRole: 'executor'
      }
    })
    broadcastPlan(info.planId, 'state', { state: 'executing', executorTerminalId })
    reply({ ok: true, executorTerminalId })
  } catch (e) {
    fail(reply, (e as Error).message)
  }
})

canvasApi.on('plan-step-complete', async (info: { planId: string; stepId: string; notes?: string }, reply: (result: unknown) => void) => {
  try {
    const doc = await storeCompleteStep(info.planId, info.stepId, info.notes)
    broadcastPlan(info.planId, 'step-updated', { stepId: info.stepId, status: 'done', notes: info.notes })
    const approved = storeGetApprovedVersion(doc)
    if (approved && approved.plan.steps.every((s) => s.status === 'done' || s.status === 'skipped') && !doc.meta.linkedPR) {
      // Auto-complete when all steps are done and no PR gate is set.
      try {
        const done = await storeMarkPlanDone(info.planId)
        broadcastPlan(info.planId, 'state', { state: done.meta.state })
      } catch { /* swallow: user may prefer manual */ }
    }
    reply({ ok: true })
  } catch (e) {
    fail(reply, (e as Error).message)
  }
})

canvasApi.on('plan-step-in-progress', async (info: { planId: string; stepId: string }, reply: (result: unknown) => void) => {
  try {
    await storeMarkStepInProgress(info.planId, info.stepId)
    broadcastPlan(info.planId, 'step-updated', { stepId: info.stepId, status: 'in-progress' })
    reply({ ok: true })
  } catch (e) {
    fail(reply, (e as Error).message)
  }
})

canvasApi.on('plan-deviation', async (info: { planId: string; stepId: string; reason: string; proposed_change: string }, reply: (result: unknown) => void) => {
  try {
    const doc = await storeAddDeviation(info.planId, info.stepId, info.reason, info.proposed_change)
    broadcastPlan(info.planId, 'state', { state: doc.meta.state })
    // Sticky warning toast
    mainWindow?.webContents.send('canvas:notify', {
      id: `plan-dev-${info.planId}-${Date.now()}`,
      title: 'Plan deviation',
      body: `Step ${info.stepId} needs replan: ${info.reason}`,
      level: 'warning',
      priority: 'high',
      terminalId: doc.meta.linkedExecutorTerminalId,
      duration: 0,
      sound: true,
      timestamp: Date.now()
    })
    reply({ ok: true })
  } catch (e) {
    fail(reply, (e as Error).message)
  }
})

canvasApi.on('plan-resume', async (info: { planId: string }, reply: (result: unknown) => void) => {
  try {
    const doc = storeLoadPlan(info.planId)
    if (!doc) { fail(reply, 'Plan not found'); return }
    if (doc.meta.state !== 'execution_failed' && doc.meta.state !== 'paused_needs_replan') {
      fail(reply, `Cannot resume from state: ${doc.meta.state}`)
      return
    }
    const approved = storeGetApprovedVersion(doc)
    if (!approved) { fail(reply, 'No approved version to resume'); return }

    const flipped = await storeTransition(info.planId, 'executing')
    const executorTerminalId = crypto.randomUUID()
    await storeAttachExecutor(info.planId, executorTerminalId)

    const executorPromptPath = join(app.getAppPath(), 'scripts', 'plan-executor-prompt.md')
    const planMarkdown = renderPlanAsMarkdown(flipped)
    const progress = storeRenderProgressSummary(flipped)
    const resumePreamble = [
      'RESUMING PREVIOUS EXECUTION.',
      'Progress so far:',
      progress,
      '',
      'Continue from the next pending step. Do NOT redo already-done steps.'
    ].join('\n')

    mainWindow?.webContents.send('canvas:terminal-spawn', {
      terminalId: executorTerminalId,
      label: `Resuming · ${flipped.meta.label}`,
      cwd: undefined,
      command: [
        `export AGENT_CANVAS_PLAN_ID='${info.planId}'`,
        `export AGENT_CANVAS_PLAN_ROLE='executor'`,
        `claude --permission-mode acceptEdits --append-system-prompt "$(cat ${shellQuote(executorPromptPath)})" ${shellQuote(resumePreamble + '\n\n' + planMarkdown)}`
      ].join(' && ') + '\n',
      linkedTerminalId: flipped.meta.linkedTerminalId,
      metadata: {
        team: { role: 'plan-executor', teamName: 'plan-execution' },
        planId: info.planId,
        planRole: 'executor'
      }
    })
    broadcastPlan(info.planId, 'state', { state: 'executing', executorTerminalId })
    reply({ ok: true, executorTerminalId })
  } catch (e) {
    fail(reply, (e as Error).message)
  }
})

canvasApi.on('plan-archive', async (info: { planId: string }, reply: (result: unknown) => void) => {
  try {
    const doc = await storeArchivePlan(info.planId)
    broadcastPlan(info.planId, 'state', { state: doc.meta.state })
    reply({ ok: true })
  } catch (e) {
    fail(reply, (e as Error).message)
  }
})

canvasApi.on('plan-delete', (info: { planId: string }, reply: (result: unknown) => void) => {
  storeDeletePlan(info.planId)
  broadcastPlan(info.planId, 'deleted')
  reply({ ok: true })
})

canvasApi.on('plan-link-pr', async (info: { planId: string; pr: string }, reply: (result: unknown) => void) => {
  try {
    await storeAttachPR(info.planId, info.pr)
    broadcastPlan(info.planId, 'updated', { linkedPR: info.pr })
    reply({ ok: true })
  } catch (e) {
    fail(reply, (e as Error).message)
  }
})

canvasApi.on('plan-mark-done', async (info: { planId: string }, reply: (result: unknown) => void) => {
  try {
    const doc = await storeMarkPlanDone(info.planId)
    broadcastPlan(info.planId, 'state', { state: doc.meta.state })
    reply({ ok: true })
  } catch (e) {
    fail(reply, (e as Error).message)
  }
})

canvasApi.on('plans-list', (reply: (data: unknown) => void) => {
  const plans = storeListPlans().map((p) => p.meta)
  reply({ ok: true, plans })
})

// ── Plan helpers ──

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`
}

function tiptapToPlainText(doc: unknown): string {
  const walk = (node: unknown): string => {
    if (!node || typeof node !== 'object') return ''
    const n = node as { text?: string; content?: unknown[]; type?: string }
    if (n.type === 'text' && typeof n.text === 'string') return n.text
    if (Array.isArray(n.content)) {
      const parts = n.content.map(walk)
      // Add newlines between block-level nodes.
      if (n.type === 'paragraph' || n.type === 'heading') return parts.join('') + '\n\n'
      return parts.join('')
    }
    return ''
  }
  return walk(doc).trim()
}

function renderPlanAsMarkdown(doc: PlanDoc): string {
  const v = storeGetApprovedVersion(doc) ?? storeLatestVersion(doc)
  const p = v.plan
  const lines: string[] = []
  lines.push(`# ${doc.meta.label}`)
  lines.push('')
  const problem = tiptapToPlainText(p.problem_statement)
  if (problem) { lines.push('## Problem', problem, '') }
  const approach = tiptapToPlainText(p.approach)
  if (approach) { lines.push('## Approach', approach, '') }
  if (p.steps.length) {
    lines.push('## Steps')
    for (const s of p.steps) {
      const check = s.status === 'done' ? '[x]' : s.status === 'skipped' ? '[-]' : '[ ]'
      lines.push(`- ${check} \`${s.id}\` ${s.text}${s.notes ? ` — ${s.notes}` : ''}`)
    }
    lines.push('')
  }
  if (p.risks.length) {
    lines.push('## Risks')
    for (const r of p.risks) lines.push(`- ${r}`)
    lines.push('')
  }
  if (p.open_questions.length) {
    lines.push('## Open Questions')
    for (const q of p.open_questions) {
      lines.push(`- ${q.text}${q.resolution ? ` — Answer: ${q.resolution}` : ''}`)
    }
    lines.push('')
  }
  if (p.acceptance_criteria) {
    lines.push('## Acceptance Criteria', p.acceptance_criteria, '')
  }
  return lines.join('\n')
}

function renderVerdictAsMarkdown(verdict: Verdict): string {
  const lines: string[] = []
  lines.push(`# Critique — severity: ${verdict.severity}`)
  lines.push('')
  lines.push(verdict.summary)
  lines.push('')
  if (verdict.findings.length) {
    lines.push('## Findings')
    for (const f of verdict.findings) {
      lines.push(`- **[${f.severity}]** ${f.text}`)
    }
  }
  return lines.join('\n')
}

// ── Plan-related terminal exit watcher ──
// If a plan's executor terminal exits while the plan is 'executing', flip to execution_failed.
terminalManager.on('exit', async (id: string) => {
  const plans = storeListPlans()
  for (const p of plans) {
    if (p.meta.linkedExecutorTerminalId === id && p.meta.state === 'executing') {
      try {
        const updated = await storeMarkExecutionFailed(p.meta.planId)
        broadcastPlan(p.meta.planId, 'state', { state: updated.meta.state })
        mainWindow?.webContents.send('canvas:notify', {
          id: `plan-exec-fail-${p.meta.planId}-${Date.now()}`,
          title: 'Plan execution failed',
          body: `Executor terminal exited for "${p.meta.label}". Click Resume on the plan tile to continue.`,
          level: 'error',
          priority: 'high',
          duration: 0,
          sound: true,
          timestamp: Date.now()
        })
      } catch { /* swallow */ }
    }
  }
})

// ── PR merge poll ──
// Periodically checks `gh pr view` for any plan in `executing` state with linkedPR.
// If MERGED, flips state to `done`.
const PR_POLL_INTERVAL_MS = 60_000
setInterval(async () => {
  const plans = storeListPlans().filter(
    (p) => p.meta.state === 'executing' && p.meta.linkedPR
  )
  for (const p of plans) {
    try {
      const pr = p.meta.linkedPR!
      const { stdout } = await execFileAsync('gh', ['pr', 'view', pr, '--json', 'state'], { timeout: 10_000 })
      const parsed = JSON.parse(stdout) as { state?: string }
      if (parsed.state === 'MERGED') {
        try {
          const doc = await storeMarkPlanDone(p.meta.planId)
          broadcastPlan(p.meta.planId, 'state', { state: doc.meta.state })
          mainWindow?.webContents.send('canvas:notify', {
            id: `plan-done-${p.meta.planId}-${Date.now()}`,
            title: 'Plan complete',
            body: `PR ${pr} merged — "${p.meta.label}" is done.`,
            level: 'success',
            priority: 'normal',
            duration: 6000,
            sound: true,
            timestamp: Date.now()
          })
        } catch { /* swallow */ }
      }
    } catch {
      // gh not installed, network error, or PR gone — skip silently.
    }
  }
}, PR_POLL_INTERVAL_MS).unref()

// ── Team Watcher (passive detection of Claude Code Agent Teams) ──

teamWatcher.on('teammate-added', ({ teamName, member }: { teamName: string; member: { name: string; agentId: string; agentType?: string } }) => {
  mainWindow?.webContents.send('canvas:terminal-spawn', {
    terminalId: crypto.randomUUID(),
    label: member.name,
    metadata: {
      team: {
        role: member.agentType || 'worker',
        teamName,
        isLead: false,
        agentId: member.agentId
      }
    }
  })
})

teamWatcher.start()

// ── Custom Protocol ──────────────────────────────────────

// Must be registered before app.whenReady()
protocol.registerSchemesAsPrivileged([
  { scheme: 'agentcanvas', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])

// ── App Lifecycle ─────────────────────────────────────────

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.agentcanvas.app')

  // Garbage-collect orphan note attachments (deleted images, orphan dirs).
  // Async via setImmediate so it never blocks window creation.
  setImmediate(() => {
    try {
      const result = sweepAllAttachments()
      if (result.filesRemoved > 0 || result.orphanDirsRemoved > 0) {
        console.log(`[attachments] startup sweep: ${result.filesRemoved} files, ${result.orphanDirsRemoved} orphan dirs removed across ${result.notesScanned} notes`)
      }
    } catch (err) {
      console.error('[attachments] startup sweep failed:', err)
    }
  })

  // Serve local files via agentcanvas:// protocol
  protocol.handle('agentcanvas', (request) => {
    const url = new URL(request.url)
    const host = url.host
    const parts = url.pathname.replace(/^\/+/, '').split('/')
    const { join } = require('path')
    const { homedir } = require('os')

    // agentcanvas://image/{filename}
    if (host === 'image') {
      const filename = parts.join('/')
      if (!filename) return new Response('Not found', { status: 404 })
      const imagesBase = join(homedir(), 'AgentCanvas', 'images')
      const filePath = join(imagesBase, filename)
      if (!filePath.startsWith(imagesBase)) return new Response('Forbidden', { status: 403 })
      return net.fetch(`file://${filePath}`)
    }

    // agentcanvas://attachment/{noteId}/{filename}
    if (parts.length < 2) return new Response('Not found', { status: 404 })
    const noteId = parts[0]
    const filename = parts.slice(1).join('/')
    const attachmentsBase = join(homedir(), 'AgentCanvas', 'attachments')
    const filePath = join(attachmentsBase, noteId, filename)
    if (!filePath.startsWith(attachmentsBase)) return new Response('Forbidden', { status: 403 })
    return net.fetch(`file://${filePath}`)
  })

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

  // Load Chrome extensions into the persistent browser session
  await loadExtensions()

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
  teamWatcher.stop()
  claudeUsageService.stop()
  if (process.platform !== 'darwin') app.quit()
})
