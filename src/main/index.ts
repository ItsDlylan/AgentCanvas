import { app, BrowserWindow, ipcMain, shell, dialog, Menu, globalShortcut, protocol, net } from 'electron'
import { join, dirname } from 'path'
import { execFile, spawn } from 'child_process'
import { promisify } from 'util'
import { randomUUID } from 'crypto'
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
import { markdownToTiptap } from './markdown-to-tiptap'
import { loadSettings, saveSettings, DEFAULT_SETTINGS, type Settings } from './settings-store'
import { loadTerminals, saveTerminals, type PersistedTerminal } from './terminal-store'
import { loadEdges, saveEdges, type EdgeKind, type PersistedEdge } from './edge-store'
import {
  ensureTaskDir,
  loadTask,
  saveTask,
  deleteTask as deleteTaskFile,
  listTasks,
  filterTasks,
  findTasksForSweep,
  type TaskClassification,
  type TaskMeta,
  type TaskTimeline,
  type TaskFile
} from './task-store'
import { classify as classifyTask } from './task-classifier'
import { deriveTaskState } from './task-state-derive'
import {
  ensureBenchDir,
  ensureTileStateDir,
  loadBenchmark,
  saveBenchmark,
  listBenchmarks,
  deleteBenchmark,
  readResults,
  readBrief,
  writeBrief,
  appendResult,
  loadRuntimeState,
  saveRuntimeState,
  validateWorktreePath,
  effectiveScoreTarget,
  goalReached,
  type BenchmarkMeta,
  type BenchmarkStatus,
  type BenchmarkStopReason,
  type NoiseClass,
  type ResultsRow
} from './benchmark-store'
import { compareScores, heldOutDiverged, acceptedScoresFromRows } from './benchmark-compare'
import { distillBrief, sanitizeForBrief } from './benchmark-brief'
import { buildHarnessDesignPrompt } from './benchmark-harness-prompt'
import { suggestTask, type SuggestInput as TaskSuggestInput } from './task-suggester'
import { readFileSync as fsReadFileSync, writeFileSync as fsWriteFileSync, mkdirSync as fsMkdirSync, watch as fsWatch, type FSWatcher } from 'fs'
import { loadPomodoro, savePomodoro } from './pomodoro-store'
import {
  loadTaskLensConfig,
  saveTaskLensConfig,
  type TaskLensUserConfig
} from './task-lens-config'
import { loadBrowsers, saveBrowsers, type PersistedBrowser } from './browser-store'
import { DiffService } from './diff-service'
import { loadExtensions, getLoadedExtensions, getExtensionsDir } from './extension-loader'
import { TeamWatcher } from './team-watcher'
import { getScrollbackIndex } from './scrollback-index'
import { claudeUsageService } from './claude-usage-service'
import type { ClaudeUsageSnapshot } from '../renderer/types/claude-usage'
import { initUpdater, reschedule as rescheduleUpdater } from './updater'

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
const scrollbackIndex = getScrollbackIndex()
let mainWindow: BrowserWindow | null = null

// ── Flow-mute mirror ───────────────────────────────────
// Renderer pushes current flow-mute state here so native OS notifications
// can be suppressed without IPC round-trip. See preload `flowMuteAPI`.
interface FlowMuteMirror {
  enabled: boolean
  active: boolean
  suppressNative: boolean
  flowGroupIds: string[]
}
let flowMuteMirror: FlowMuteMirror = {
  enabled: true,
  active: false,
  suppressNative: true,
  flowGroupIds: []
}

ipcMain.on('flow-mute:mirror', (_event, mirror: FlowMuteMirror) => {
  flowMuteMirror = mirror
})

function shouldSuppressNativeForFlow(payload: {
  level: string
  priority?: string
  terminalId?: string
}): boolean {
  if (!flowMuteMirror.enabled) return false
  if (!flowMuteMirror.active) return false
  if (!flowMuteMirror.suppressNative) return false
  if (payload.priority === 'critical') return false
  if (payload.level === 'error') return false
  if (payload.terminalId && flowMuteMirror.flowGroupIds.includes(payload.terminalId)) return false
  return true
}
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
  rescheduleUpdater()
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
  const normalized = edges.map((e: Record<string, unknown>) => ({
    ...e,
    kind: (e.kind as string | undefined) ?? 'legacy'
  }))
  saveEdges({ version: 2, edges: normalized })
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

// ── Task IPC Handlers ──────────────────────────────────

ipcMain.handle('task:load', (_event, { taskId }: { taskId: string }) => {
  return loadTask(taskId)
})

ipcMain.handle(
  'task:save',
  async (
    _event,
    {
      taskId,
      meta,
      intent,
      acceptanceCriteria
    }: {
      taskId: string
      meta: Partial<TaskMeta>
      intent?: string
      acceptanceCriteria?: Record<string, unknown>
    }
  ) => {
    await saveTask(taskId, meta, intent, acceptanceCriteria)
    checkTaskStateChange(taskId)
    if (meta.isSoftDeleted) {
      mainWindow?.webContents.send('canvas:task-close', { taskId })
    } else {
      mainWindow?.webContents.send('canvas:task-update', { taskId })
    }
  }
)

ipcMain.handle('task:delete', (_event, { taskId }: { taskId: string }) => {
  deleteTaskFile(taskId)
  lastTaskState.delete(taskId)
})

ipcMain.handle('task:list', () => {
  return listTasks()
})

ipcMain.handle('task:derive-state', (_event, { taskId }: { taskId: string }) => {
  const t = loadTask(taskId)
  if (!t) return null
  return computeTaskState(t)
})

ipcMain.handle('task:classify', async (_event, { intent, acceptance }: { intent: string; acceptance?: string }) => {
  try {
    const result = await classifyTask(intent, acceptance ?? '')
    return { ok: true, result }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
})

ipcMain.handle(
  'task:link',
  (
    _event,
    { sourceId, targetId, kind }: { sourceId: string; targetId: string; kind: EdgeKind }
  ) => {
    if (!VALID_EDGE_KINDS.includes(kind)) return { ok: false, error: 'Invalid edge kind' }
    const data = loadEdges()
    const newEdge: PersistedEdge = {
      id: `e-${randomUUID()}`,
      source: sourceId,
      target: targetId,
      kind
    }
    data.edges.push(newEdge)
    saveEdges(data)
    mainWindow?.webContents.send('canvas:task-link', newEdge)
    return { ok: true, edge: newEdge }
  }
)

ipcMain.handle(
  'task:convert-from-note',
  async (
    _event,
    {
      noteId,
      classification,
      timelinePressure
    }: { noteId: string; classification: TaskClassification; timelinePressure?: TaskTimeline }
  ) => {
    const note = loadNote(noteId)
    if (!note) return { ok: false, error: 'Note not found' }
    if (!VALID_CLASSIFICATIONS.includes(classification)) {
      return { ok: false, error: 'Invalid classification' }
    }
    const taskId = randomUUID()
    const markdownFromNote = jsonToMarkdown(note.content)
    await saveTask(
      taskId,
      {
        taskId,
        label: note.meta.label,
        workspaceId: note.meta.workspaceId,
        classification,
        timelinePressure: timelinePressure ?? 'whenever',
        manualReviewDone: false,
        position: note.meta.position,
        width: note.meta.width,
        height: note.meta.height,
        isSoftDeleted: false,
        createdAt: Date.now(),
        updatedAt: Date.now()
      },
      markdownFromNote,
      note.content
    )
    await saveNote(noteId, { isSoftDeleted: true })
    mainWindow?.webContents.send('canvas:task-open', { taskId })
    mainWindow?.webContents.send('canvas:note-close', { noteId })
    return { ok: true, taskId }
  }
)

ipcMain.handle('task:review-all', async () => {
  const notes = listNotes().filter((n) => !n.meta.isSoftDeleted)
  const proposals: Array<{
    noteId: string
    label: string
    proposedClassification: TaskClassification
    confidence: string
  }> = []
  for (const n of notes) {
    const md = jsonToMarkdown(n.content)
    try {
      const result = await classifyTask(md, '', { disableLlm: true })
      proposals.push({
        noteId: n.meta.noteId,
        label: n.meta.label,
        proposedClassification: result.classification,
        confidence: result.confidence
      })
    } catch {
      proposals.push({
        noteId: n.meta.noteId,
        label: n.meta.label,
        proposedClassification: 'QUICK',
        confidence: 'low'
      })
    }
  }
  return { ok: true, proposals }
})

ipcMain.handle(
  'task:create',
  async (
    _event,
    input: {
      label?: string
      intent?: string
      acceptanceCriteria?: string
      classification?: TaskClassification
      timelinePressure?: TaskTimeline
      workspaceId?: string
      position?: { x: number; y: number }
    }
  ) => {
    const taskId = randomUUID()
    const intent = input.intent ?? ''
    let acceptanceDoc: Record<string, unknown> = {}
    if (input.acceptanceCriteria) {
      try {
        acceptanceDoc = markdownToTiptap(input.acceptanceCriteria)
      } catch {
        return { ok: false, error: 'Invalid acceptance markdown' }
      }
    }

    let classification: TaskClassification
    if (input.classification && VALID_CLASSIFICATIONS.includes(input.classification)) {
      classification = input.classification
    } else {
      try {
        const r = await classifyTask(intent, input.acceptanceCriteria ?? '')
        classification = r.classification
      } catch {
        classification = 'QUICK'
      }
    }

    const timelinePressure =
      input.timelinePressure && VALID_TIMELINES.includes(input.timelinePressure)
        ? input.timelinePressure
        : 'whenever'

    const meta: TaskMeta = {
      taskId,
      label: input.label ?? 'Task',
      workspaceId: input.workspaceId ?? 'default',
      classification,
      timelinePressure,
      manualReviewDone: false,
      position: input.position ?? { x: 100, y: 100 },
      width: 420,
      height: 440,
      isSoftDeleted: false,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    await saveTask(taskId, meta, intent, acceptanceDoc)
    mainWindow?.webContents.send('canvas:task-open', { taskId, meta })
    return { ok: true, taskId, classification }
  }
)

ipcMain.handle(
  'task:apply-markdown-draft',
  async (
    _event,
    input: {
      taskId: string
      label?: string
      intent?: string
      acceptanceMarkdown?: string
      classification?: TaskClassification
    }
  ) => {
    const file = loadTask(input.taskId)
    if (!file) return { ok: false, error: 'Task not found' }
    const meta: TaskMeta = {
      ...file.meta,
      label: input.label ?? file.meta.label,
      classification: input.classification ?? file.meta.classification,
      updatedAt: Date.now()
    }
    let acceptanceDoc: Record<string, unknown> | undefined = undefined
    if (typeof input.acceptanceMarkdown === 'string') {
      try {
        acceptanceDoc = markdownToTiptap(input.acceptanceMarkdown)
      } catch {
        return { ok: false, error: 'Invalid acceptance markdown' }
      }
    }
    const nextIntent = typeof input.intent === 'string' ? input.intent : file.intent
    await saveTask(input.taskId, meta, nextIntent, acceptanceDoc ?? file.acceptanceCriteria)
    mainWindow?.webContents.send('canvas:task-update', { taskId: input.taskId })
    return { ok: true }
  }
)

// ── Benchmark IPC Handlers (renderer → main) ──

ipcMain.handle('benchmark:load', (_event, { benchmarkId }: { benchmarkId: string }) => {
  const b = loadBenchmark(benchmarkId)
  if (!b) return null
  const runtime = loadRuntimeState(b.meta)
  const rows = readResults(b.meta)
  const brief = readBrief(b.meta)
  return { meta: b.meta, runtime, rows, brief }
})

ipcMain.handle('benchmark:list', () => {
  return listBenchmarks().map((b) => b.meta)
})

ipcMain.handle(
  'benchmark:update',
  async (_event, input: Partial<BenchmarkMeta> & { benchmarkId: string }) => {
    const b = loadBenchmark(input.benchmarkId)
    if (!b) return { ok: false, error: 'Benchmark not found' }
    const { benchmarkId, ...patch } = input
    await saveBenchmark(benchmarkId, patch)
    mainWindow?.webContents.send('canvas:benchmark-update', { benchmarkId })
    return { ok: true }
  }
)

ipcMain.handle(
  'benchmark:hint',
  (_event, { benchmarkId, hint }: { benchmarkId: string; hint: string }) => {
    const b = loadBenchmark(benchmarkId)
    if (!b) return { ok: false, error: 'Benchmark not found' }
    const state = loadRuntimeState(b.meta)
    state.pendingHint = sanitizeForBrief(hint ?? '').slice(0, 500)
    saveRuntimeState(b.meta, state)
    mainWindow?.webContents.send('canvas:benchmark-state-change', { benchmarkId })
    return { ok: true }
  }
)

ipcMain.handle(
  'benchmark:control',
  async (
    _event,
    {
      benchmarkId,
      action
    }: {
      benchmarkId: string
      action: 'start' | 'pause' | 'resume' | 'stop' | 'unfreeze'
    }
  ) => {
    const b = loadBenchmark(benchmarkId)
    if (!b) return { ok: false, error: 'Benchmark not found' }
    const state = loadRuntimeState(b.meta)
    const now = Date.now()
    switch (action) {
      case 'start':
        state.status = 'running'
        state.startedAt = state.startedAt ?? now
        await saveBenchmark(benchmarkId, { status: 'running' })
        break
      case 'pause':
        state.status = 'paused'
        await saveBenchmark(benchmarkId, { status: 'paused' })
        break
      case 'resume':
        state.status = 'running'
        await saveBenchmark(benchmarkId, { status: 'running' })
        break
      case 'stop':
        state.status = 'stopped'
        state.stopReason = 'user'
        await saveBenchmark(benchmarkId, { status: 'stopped', stopReason: 'user' })
        break
      case 'unfreeze':
        state.frozen = false
        state.frozenReason = undefined
        state.status = 'paused'
        await saveBenchmark(benchmarkId, { status: 'paused' })
        break
      default:
        return { ok: false, error: `Unknown action: ${action}` }
    }
    saveRuntimeState(b.meta, state)
    mainWindow?.webContents.send('canvas:benchmark-state-change', { benchmarkId })
    return { ok: true, state }
  }
)

ipcMain.handle('benchmark:close', async (_event, { benchmarkId }: { benchmarkId: string }) => {
  await saveBenchmark(benchmarkId, { isSoftDeleted: true, softDeletedAt: Date.now() })
  stopWatchingBenchmarkResults(benchmarkId)
  mainWindow?.webContents.send('canvas:benchmark-close', { benchmarkId })
  return { ok: true }
})

ipcMain.handle('benchmark:delete', async (_event, { benchmarkId }: { benchmarkId: string }) => {
  const b = loadBenchmark(benchmarkId)
  if (b) await removeBenchmarkWorktree(b.meta)
  deleteBenchmark(benchmarkId)
  stopWatchingBenchmarkResults(benchmarkId)
  mainWindow?.webContents.send('canvas:benchmark-delete', { benchmarkId })
  return { ok: true }
})

ipcMain.handle(
  'benchmark:handoff-plan',
  async (
    _event,
    { benchmarkId, stopReason }: { benchmarkId: string; stopReason?: BenchmarkStopReason }
  ) => {
    return new Promise((resolve) => {
      canvasApi.emit('benchmark-handoff-plan', { benchmarkId, stopReason }, resolve)
    })
  }
)

ipcMain.handle(
  'benchmark:convert-from-task',
  async (_event, input: Record<string, unknown>) => {
    return new Promise((resolve) => {
      canvasApi.emit('benchmark-convert-from-task', input, resolve)
    })
  }
)

ipcMain.handle(
  'benchmark:design-harness',
  async (
    _event,
    input: {
      taskId: string
      sourceRepoPath: string
      targetFiles?: string[]
      acceptanceCriteria: string
      noiseClass?: 'low' | 'medium' | 'high'
      higherIsBetter?: boolean
      templateKind?:
        | 'web-page-load'
        | 'api-latency'
        | 'bundle-size'
        | 'test-suite-time'
        | 'pure-function'
      targetUrl?: string
    }
  ) => {
    const task = loadTask(input.taskId)
    if (!task) return { ok: false, error: 'Task not found' }
    if (task.meta.classification !== 'BENCHMARK') {
      return { ok: false, error: 'Only BENCHMARK-classified tasks can have a harness designed' }
    }
    if (!input.sourceRepoPath) return { ok: false, error: 'sourceRepoPath is required' }
    if (!input.acceptanceCriteria || !input.acceptanceCriteria.trim()) {
      return { ok: false, error: 'acceptanceCriteria is required' }
    }

    // Auto-create an isolated worktree. Reuse the same helper as the real run
    // so layout is consistent; the branch name prefix makes intent visible in git.
    let worktreePath: string
    let branchName: string
    try {
      const created = await createBenchmarkWorktree({
        sourceRepoPath: input.sourceRepoPath,
        benchmarkId: input.taskId, // reuse task id for stable branch slug
        label: `harness-${task.meta.label}`
      })
      worktreePath = created.worktreePath
      branchName = created.branchName
    } catch (err) {
      return { ok: false, error: `worktree creation failed: ${(err as Error).message}` }
    }

    // Persist the worktree on the task so the Harness modal can auto-pick it.
    await saveTask(input.taskId, {
      harnessWorktreePath: worktreePath,
      harnessBranch: branchName
    })

    // Build the harness-design prompt and stuff it into the terminal's stdin via
    // a heredoc-style command. Using /tmp avoids quoting pain.
    const prompt = buildHarnessDesignPrompt({
      taskLabel: task.meta.label,
      acceptanceCriteria: input.acceptanceCriteria,
      targetFiles: input.targetFiles ?? [],
      noiseClass: input.noiseClass ?? 'medium',
      higherIsBetter: input.higherIsBetter ?? true,
      templateKind: input.templateKind,
      targetUrl: input.targetUrl
    })
    const promptFile = join(app.getPath('userData'), 'agentcanvas', `harness-prompt-${input.taskId}.md`)
    try {
      fsMkdirSync(dirname(promptFile), { recursive: true })
      fsWriteFileSync(promptFile, prompt)
    } catch (err) {
      return { ok: false, error: `writing prompt failed: ${(err as Error).message}` }
    }
    const command = `cat ${quoteShell(promptFile)} | claude -p --model claude-opus-4-7\n`

    const terminalId = randomUUID()
    mainWindow?.webContents.send('canvas:terminal-spawn', {
      terminalId,
      label: `Harness design: ${task.meta.label}`,
      cwd: worktreePath,
      command,
      linkedTerminalId: undefined,
      width: 720,
      height: 420,
      metadata: { taskId: input.taskId, role: 'harness-design' }
    })

    // Edge: task → harness-design terminal (executing-in), deferred so ReactFlow
    // measures the spawned terminal before the edge resolves.
    const edges = loadEdges()
    const taskTermEdge: PersistedEdge = {
      id: `e-${randomUUID()}`,
      source: input.taskId,
      target: terminalId,
      kind: 'executing-in'
    }
    edges.edges.push(taskTermEdge)
    saveEdges(edges)
    setTimeout(() => {
      mainWindow?.webContents.send('canvas:task-link', taskTermEdge)
    }, 700)

    mainWindow?.webContents.send('canvas:task-update', { taskId: input.taskId })
    return {
      ok: true,
      terminalId,
      worktreePath,
      branchName,
      promptFile
    }
  }
)

ipcMain.handle('task:suggest', async (_event, input: TaskSuggestInput) => {
  try {
    return await suggestTask(input)
  } catch (err) {
    return { ok: false, error: (err as Error).message || String(err) }
  }
})

ipcMain.handle(
  'benchmark:launch-runner',
  async (_event, { benchmarkId }: { benchmarkId: string }) => {
    const b = loadBenchmark(benchmarkId)
    if (!b) return { ok: false, error: 'Benchmark not found' }
    // Arm the run (status → running) before spawning so the runner sees a live tile.
    const state = loadRuntimeState(b.meta)
    state.status = 'running'
    state.startedAt = state.startedAt ?? Date.now()
    saveRuntimeState(b.meta, state)
    await saveBenchmark(benchmarkId, { status: 'running' })

    // Prefer the app's shipped runner script (works in dev AND packaged build).
    // Fall back to <worktree>/scripts/benchmark-runner.mjs if the AgentCanvas
    // checkout happens to be the same repo.
    const shippedRunner = join(app.getAppPath(), 'scripts', 'benchmark-runner.mjs')
    const fallbackRunner = join(b.meta.worktreePath, 'scripts', 'benchmark-runner.mjs')
    const runnerPath = existsSync(shippedRunner) ? shippedRunner : fallbackRunner
    const command = `node ${quoteShell(runnerPath)} --benchmark-id ${benchmarkId}\n`

    const terminalId = randomUUID()
    mainWindow?.webContents.send('canvas:terminal-spawn', {
      terminalId,
      label: `Runner: ${b.meta.label}`,
      cwd: b.meta.worktreePath,
      command,
      linkedTerminalId: undefined,
      width: 720,
      height: 420,
      metadata: { benchmarkId, role: 'benchmark-runner' }
    })

    // Link benchmark → runner-terminal via executing-in edge.
    const edges = loadEdges()
    const benchTermEdge: PersistedEdge = {
      id: `e-${randomUUID()}`,
      source: benchmarkId,
      target: terminalId,
      kind: 'executing-in'
    }
    edges.edges.push(benchTermEdge)
    saveEdges(edges)

    // Defer the edge broadcast slightly so the renderer has time to mount the
    // spawned terminal tile before ReactFlow tries to resolve handles.
    setTimeout(() => {
      mainWindow?.webContents.send('canvas:task-link', benchTermEdge)
    }, 700)

    mainWindow?.webContents.send('canvas:benchmark-state-change', { benchmarkId })
    return { ok: true, terminalId, command }
  }
)

function quoteShell(s: string): string {
  if (!/[\s'"\\$`!]/.test(s)) return s
  return `'${s.replace(/'/g, `'\\''`)}'`
}

// ── Task Lens IPC ──────────────────────────────────────────
ipcMain.handle('tasklens:load', () => loadTaskLensConfig())
ipcMain.handle('tasklens:save', (_event, { config }: { config: TaskLensUserConfig }) => {
  saveTaskLensConfig(config)
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

ipcMain.handle(
  'search:scrollback',
  (_event, args: { query: string; terminalIds?: string[]; limit?: number }) => {
    return scrollbackIndex.searchScrollback(args)
  }
)

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

  // Feed the FTS5 scrollback index (line-buffered, 500ms flush)
  scrollbackIndex.appendPtyData(id, data)

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
  scrollbackIndex.dropTerminal(id)
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
    if (shouldSuppressNativeForFlow(payload)) return
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

canvasApi.on('task-suggest', async (info: TaskSuggestInput, reply: (result: unknown) => void) => {
  try {
    const result = await suggestTask(info)
    reply(result)
  } catch (err) {
    reply({ ok: false, error: (err as Error).message || String(err) })
  }
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
    if (!shouldSuppressNativeForFlow(info)) {
      const { Notification: ElectronNotification } = require('electron')
      if (ElectronNotification.isSupported()) {
        new ElectronNotification({
          title: info.title || 'Agent Canvas',
          body: info.body,
          silent: true
        }).show()
      }
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

// ── Task handlers ──

ensureTaskDir()

const VALID_CLASSIFICATIONS: TaskClassification[] = ['QUICK', 'NEEDS_RESEARCH', 'DEEP_FOCUS', 'BENCHMARK']
const VALID_TIMELINES: TaskTimeline[] = ['urgent', 'this-week', 'this-month', 'whenever']
const VALID_EDGE_KINDS: EdgeKind[] = [
  'has-plan',
  'executing-in',
  'research-output',
  'linked-pr',
  'depends-on',
  'legacy'
]

function computeTaskState(task: TaskFile): { state: string; reason: string } {
  const edges = loadEdges().edges
  return deriveTaskState({
    taskId: task.meta.taskId,
    classification: task.meta.classification,
    manualReviewDone: task.meta.manualReviewDone,
    edges,
    getPlanState: (planId) => storeLoadPlan(planId)?.meta.state,
    getTerminalStatus: (terminalId) => {
      const info = terminalManager.getStatus(terminalId)
      if (!info) return undefined
      return { running: info.status === 'running' || info.status === 'waiting' }
    }
  })
}

canvasApi.on(
  'task-open',
  async (
    info: {
      label?: string
      intent?: string
      acceptanceCriteria?: string | Record<string, unknown>
      classification?: string
      timelinePressure?: string
      workspaceId?: string
      linkedTerminalId?: string
      parentTaskId?: string
      position?: { x: number; y: number }
      width?: number
      height?: number
      skipClassifier?: boolean
    },
    reply: (result: unknown) => void
  ) => {
    const taskId = randomUUID()
    const intent = info.intent ?? ''
    let acceptanceDoc: Record<string, unknown> = {}
    if (info.acceptanceCriteria) {
      try {
        acceptanceDoc =
          typeof info.acceptanceCriteria === 'string'
            ? markdownToTiptap(info.acceptanceCriteria)
            : info.acceptanceCriteria
      } catch {
        reply({ ok: false, error: 'Invalid acceptanceCriteria markdown' })
        return
      }
    }

    let classification: TaskClassification
    let classifierResult: Awaited<ReturnType<typeof classifyTask>> | null = null
    if (info.classification && VALID_CLASSIFICATIONS.includes(info.classification as TaskClassification)) {
      classification = info.classification as TaskClassification
    } else if (info.skipClassifier) {
      classification = 'QUICK'
    } else {
      try {
        classifierResult = await classifyTask(intent, info.acceptanceCriteria?.toString() ?? '')
        classification = classifierResult.classification
      } catch {
        classification = 'QUICK'
      }
    }

    const timelinePressure: TaskTimeline = VALID_TIMELINES.includes(
      info.timelinePressure as TaskTimeline
    )
      ? (info.timelinePressure as TaskTimeline)
      : 'whenever'

    const meta: TaskMeta = {
      taskId,
      label: info.label || 'Task',
      workspaceId: info.workspaceId || 'default',
      classification,
      timelinePressure,
      manualReviewDone: false,
      position: info.position || { x: 100, y: 100 },
      width: info.width || 400,
      height: info.height || 400,
      isSoftDeleted: false,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    await saveTask(taskId, meta, intent, acceptanceDoc)

    mainWindow?.webContents.send('canvas:task-open', { taskId, meta })
    reply({
      ok: true,
      taskId,
      classification,
      classifierResult,
      needsConfirm: classifierResult?.source !== undefined && classifierResult.source !== 'heuristic'
    })
  }
)

canvasApi.on(
  'task-read',
  (info: { taskId: string }, reply: (result: unknown) => void) => {
    const t = loadTask(info.taskId)
    if (!t) {
      reply({ ok: false, error: 'Task not found' })
      return
    }
    const derived = computeTaskState(t)
    reply({ ok: true, meta: t.meta, intent: t.intent, acceptanceCriteria: t.acceptanceCriteria, derivedState: derived })
  }
)

canvasApi.on(
  'task-update',
  async (
    info: {
      taskId: string
      label?: string
      intent?: string
      acceptanceCriteria?: string | Record<string, unknown>
      timelinePressure?: string
      classification?: string
      manualReviewDone?: boolean
    },
    reply: (result: unknown) => void
  ) => {
    const existing = loadTask(info.taskId)
    if (!existing) {
      reply({ ok: false, error: 'Task not found' })
      return
    }
    let acceptanceDoc: Record<string, unknown> | undefined
    if (info.acceptanceCriteria !== undefined) {
      try {
        acceptanceDoc =
          typeof info.acceptanceCriteria === 'string'
            ? markdownToTiptap(info.acceptanceCriteria)
            : info.acceptanceCriteria
      } catch {
        reply({ ok: false, error: 'Invalid acceptanceCriteria markdown' })
        return
      }
    }
    const patch: Partial<TaskMeta> = {}
    if (info.label !== undefined) patch.label = info.label
    if (
      info.timelinePressure &&
      VALID_TIMELINES.includes(info.timelinePressure as TaskTimeline)
    ) {
      patch.timelinePressure = info.timelinePressure as TaskTimeline
    }
    if (
      info.classification &&
      VALID_CLASSIFICATIONS.includes(info.classification as TaskClassification)
    ) {
      patch.classification = info.classification as TaskClassification
    }
    if (info.manualReviewDone !== undefined) patch.manualReviewDone = info.manualReviewDone

    await saveTask(info.taskId, patch, info.intent, acceptanceDoc)
    mainWindow?.webContents.send('canvas:task-update', { taskId: info.taskId })

    const updated = loadTask(info.taskId)
    const derived = updated ? computeTaskState(updated) : null
    reply({ ok: true, taskId: info.taskId, derivedState: derived })
  }
)

canvasApi.on(
  'task-close',
  async (info: { taskId: string }, reply: (result: unknown) => void) => {
    await saveTask(info.taskId, { isSoftDeleted: true, softDeletedAt: Date.now() })
    mainWindow?.webContents.send('canvas:task-close', { taskId: info.taskId })
    reply({ ok: true })
  }
)

canvasApi.on(
  'task-delete',
  (info: { taskId: string }, reply: (result: unknown) => void) => {
    deleteTaskFile(info.taskId)
    mainWindow?.webContents.send('canvas:task-delete', { taskId: info.taskId })
    reply({ ok: true })
  }
)

canvasApi.on(
  'task-classify',
  async (
    info: { taskId?: string; intent?: string; acceptance?: string },
    reply: (result: unknown) => void
  ) => {
    let intent = info.intent ?? ''
    let acceptance = info.acceptance ?? ''
    if (info.taskId) {
      const t = loadTask(info.taskId)
      if (t) {
        intent = intent || t.intent
      }
    }
    try {
      const result = await classifyTask(intent, acceptance)
      reply({ ok: true, result })
    } catch (err) {
      reply({ ok: false, error: String(err) })
    }
  }
)

canvasApi.on(
  'task-link',
  (
    info: { sourceTaskId: string; targetId: string; kind: string },
    reply: (result: unknown) => void
  ) => {
    if (!VALID_EDGE_KINDS.includes(info.kind as EdgeKind)) {
      reply({ ok: false, error: `Invalid edge kind: ${info.kind}` })
      return
    }
    const data = loadEdges()
    const newEdge: PersistedEdge = {
      id: `e-${randomUUID()}`,
      source: info.sourceTaskId,
      target: info.targetId,
      kind: info.kind as EdgeKind
    }
    data.edges.push(newEdge)
    saveEdges(data)
    mainWindow?.webContents.send('canvas:task-link', newEdge)
    reply({ ok: true, edge: newEdge })
  }
)

canvasApi.on(
  'task-state-derive',
  (info: { taskId: string }, reply: (result: unknown) => void) => {
    const t = loadTask(info.taskId)
    if (!t) {
      reply({ ok: false, error: 'Task not found' })
      return
    }
    const derived = computeTaskState(t)
    reply({ ok: true, taskId: info.taskId, ...derived })
  }
)

canvasApi.on(
  'task-convert-from-note',
  async (
    info: { noteId: string; classification: string; timelinePressure?: string },
    reply: (result: unknown) => void
  ) => {
    const note = loadNote(info.noteId)
    if (!note) {
      reply({ ok: false, error: 'Note not found' })
      return
    }
    if (!VALID_CLASSIFICATIONS.includes(info.classification as TaskClassification)) {
      reply({ ok: false, error: 'Invalid classification' })
      return
    }
    const taskId = randomUUID()
    const timelinePressure: TaskTimeline = VALID_TIMELINES.includes(
      info.timelinePressure as TaskTimeline
    )
      ? (info.timelinePressure as TaskTimeline)
      : 'whenever'

    const markdownFromNote = jsonToMarkdown(note.content)
    await saveTask(
      taskId,
      {
        taskId,
        label: note.meta.label,
        workspaceId: note.meta.workspaceId,
        classification: info.classification as TaskClassification,
        timelinePressure,
        manualReviewDone: false,
        position: note.meta.position,
        width: note.meta.width,
        height: note.meta.height,
        isSoftDeleted: false,
        createdAt: Date.now(),
        updatedAt: Date.now()
      },
      markdownFromNote,
      note.content
    )
    // Soft-close the original note
    await saveNote(info.noteId, { isSoftDeleted: true })
    mainWindow?.webContents.send('canvas:task-open', { taskId })
    mainWindow?.webContents.send('canvas:note-close', { noteId: info.noteId })
    reply({ ok: true, taskId })
  }
)

canvasApi.on(
  'task-review-all',
  async (reply: (result: unknown) => void) => {
    const notes = listNotes().filter((n) => !n.meta.isSoftDeleted)
    const proposals: Array<{
      noteId: string
      label: string
      proposedClassification: TaskClassification
      confidence: string
    }> = []
    for (const n of notes) {
      const md = jsonToMarkdown(n.content)
      try {
        const result = await classifyTask(md, '', { disableLlm: true })
        proposals.push({
          noteId: n.meta.noteId,
          label: n.meta.label,
          proposedClassification: result.classification,
          confidence: result.confidence
        })
      } catch {
        proposals.push({
          noteId: n.meta.noteId,
          label: n.meta.label,
          proposedClassification: 'QUICK',
          confidence: 'low'
        })
      }
    }
    reply({ ok: true, proposals })
  }
)

canvasApi.on(
  'tasks-list',
  (info: { filter?: Record<string, string> }, reply: (result: unknown) => void) => {
    const all = listTasks()
    const f = info.filter ?? {}
    const filtered = filterTasks(all, {
      classification: f.classification as TaskClassification | undefined,
      workspaceId: f.workspaceId,
      timeline: f.timeline as TaskTimeline | undefined,
      includeSoftDeleted: f.includeDone === 'true'
    })
    const tasks = filtered.map((t) => ({
      meta: t.meta,
      derivedState: computeTaskState(t)
    }))
    if (f.state) {
      reply({ ok: true, tasks: tasks.filter((t) => t.derivedState.state === f.state) })
      return
    }
    reply({ ok: true, tasks })
  }
)

// Soft-delete sweep: run on start and every 24h
function sweepTasks(): void {
  const candidates = findTasksForSweep(listTasks())
  for (const taskId of candidates) {
    deleteTaskFile(taskId)
    mainWindow?.webContents.send('canvas:task-delete', { taskId })
  }
}
sweepTasks()
setInterval(sweepTasks, 24 * 60 * 60 * 1000)

// Fire notify on →review transitions
const lastTaskState = new Map<string, string>()
function checkTaskStateChange(taskId: string): void {
  const t = loadTask(taskId)
  if (!t) return
  const { state } = computeTaskState(t)
  const prev = lastTaskState.get(taskId)
  if (prev !== state) {
    lastTaskState.set(taskId, state)
    if (state === 'review' && prev !== undefined && prev !== 'review') {
      mainWindow?.webContents.send('canvas:notify', {
        id: randomUUID(),
        title: 'Task ready for review',
        body: t.meta.label,
        level: 'success',
        duration: 6000,
        sound: false,
        timestamp: Date.now()
      })
    }
    mainWindow?.webContents.send('canvas:task-state-change', { taskId, state })
  }
}

// Initial prime of lastTaskState
for (const t of listTasks()) {
  const { state } = computeTaskState(t)
  lastTaskState.set(t.meta.taskId, state)
}

// ── Benchmark handlers ──
//
// Benchmark Tile (inspired by karpathy/autoresearch) is a first-class tile
// type: given a user-owned evaluator that returns a numeric score, it orchestrates
// an iterative optimization loop. The tile holds identity/meta; the actual
// iteration state (results.tsv, brief.md, state.json) lives inside the user's
// git worktree under .benchmark-tile/. See CLAUDE.md for the HTTP surface.

ensureBenchDir()

const VALID_NOISE_CLASSES: NoiseClass[] = ['low', 'medium', 'high']
const VALID_BENCHMARK_STATUSES: BenchmarkStatus[] = [
  'unstarted', 'running', 'paused', 'frozen', 'stopped', 'done'
]

/**
 * Auto-create an isolated git worktree for a benchmark run. Pattern matches
 * the project convention: worktrees live at `<repo-parent>/AgentCanvas-worktrees/bench-<short-id>`
 * on a fresh branch `bench/<slug>-<short-id>` branched from the source repo's
 * current HEAD. Returns the worktree path + branch name.
 *
 * If the source path isn't a git repo, throws. If the worktree directory
 * already exists, we fail fast rather than risk stepping on prior work.
 */
async function createBenchmarkWorktree(input: {
  sourceRepoPath: string
  benchmarkId: string
  label: string
}): Promise<{ worktreePath: string; branchName: string }> {
  const { stdout: topLevel } = await execFileAsync('git', ['-C', input.sourceRepoPath, 'rev-parse', '--show-toplevel'])
  const repoRoot = topLevel.trim()
  if (!repoRoot) throw new Error(`${input.sourceRepoPath} is not a git repository`)
  const parent = dirname(repoRoot)
  const basename = parent.split('/').pop() ?? 'repo'
  const worktreesDir = join(parent, `${basename}-worktrees`)
  if (!existsSync(worktreesDir)) fsMkdirSync(worktreesDir, { recursive: true })

  const slug = slugForBranch(input.label)
  const shortId = input.benchmarkId.slice(0, 8)
  const worktreePath = join(worktreesDir, `bench-${shortId}`)
  const branchName = `bench/${slug}-${shortId}`

  if (existsSync(worktreePath)) {
    throw new Error(`worktree target already exists: ${worktreePath}`)
  }
  await execFileAsync('git', ['-C', repoRoot, 'worktree', 'add', worktreePath, '-b', branchName])
  return { worktreePath, branchName }
}

function slugForBranch(s: string): string {
  return (s || 'run')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'run'
}

/**
 * Remove the worktree we created, if any. Called from hard-delete.
 * Best-effort — failures are logged and ignored so delete never blocks.
 */
async function removeBenchmarkWorktree(meta: BenchmarkMeta): Promise<void> {
  if (!meta.autoCreatedWorktree || !meta.worktreePath || !meta.sourceRepoPath) return
  try {
    await execFileAsync('git', ['-C', meta.sourceRepoPath, 'worktree', 'remove', '--force', meta.worktreePath])
    console.log(`[benchmark] removed worktree ${meta.worktreePath}`)
  } catch (err) {
    console.warn(`[benchmark] worktree removal failed for ${meta.worktreePath}:`, (err as Error).message)
  }
  if (meta.worktreeBranch) {
    try {
      await execFileAsync('git', ['-C', meta.sourceRepoPath, 'branch', '-D', meta.worktreeBranch])
    } catch {
      // branch may already be gone — non-fatal
    }
  }
}

/**
 * Enforce the required acceptance contract at creation time. A benchmark
 * without a human-readable goal AND a quantifiable target is a loop with
 * no shutoff — the whole point of the primitive is to drive toward a
 * measurable success condition.
 */
function validateAcceptanceContract(info: {
  acceptanceCriteria?: string
  baselineScore?: number
  improvementPct?: number
  scoreTarget?: number
}): string | null {
  const ac = (info.acceptanceCriteria ?? '').trim()
  if (ac.length === 0) {
    return 'acceptanceCriteria is required — state the success condition in plain language, e.g. "reduce p95 latency by 30%"'
  }
  if (info.baselineScore === undefined || !Number.isFinite(info.baselineScore)) {
    return 'baselineScore is required — measure the evaluator against HEAD once and pass that number'
  }
  const hasTarget = info.scoreTarget !== undefined && Number.isFinite(info.scoreTarget)
  const hasPct = info.improvementPct !== undefined && Number.isFinite(info.improvementPct)
  if (!hasTarget && !hasPct) {
    return 'one of { scoreTarget, improvementPct } is required — the run needs a quantifiable target to shut off on'
  }
  if (hasPct && (info.improvementPct! <= 0)) {
    return 'improvementPct must be positive (interpretation: % improvement over baseline)'
  }
  return null
}
const resultsWatchers = new Map<string, FSWatcher>()

function watchBenchmarkResults(meta: BenchmarkMeta): void {
  try {
    const existing = resultsWatchers.get(meta.benchmarkId)
    if (existing) existing.close()
    const tileDir = join(meta.worktreePath, '.benchmark-tile')
    if (!existsSync(tileDir)) return
    const watcher = fsWatch(tileDir, { persistent: false }, (eventType, filename) => {
      if (!filename) return
      if (filename === 'results.tsv' || filename === 'state.json') {
        mainWindow?.webContents.send('canvas:benchmark-state-change', {
          benchmarkId: meta.benchmarkId
        })
      }
    })
    resultsWatchers.set(meta.benchmarkId, watcher)
  } catch (err) {
    console.warn(`[benchmark] watch failed for ${meta.benchmarkId}:`, err)
  }
}

function stopWatchingBenchmarkResults(benchmarkId: string): void {
  const w = resultsWatchers.get(benchmarkId)
  if (w) {
    try { w.close() } catch { /* noop */ }
    resultsWatchers.delete(benchmarkId)
  }
}

// Prime watchers for any benchmarks persisted from a previous session.
for (const b of listBenchmarks()) {
  if (!b.meta.isSoftDeleted) watchBenchmarkResults(b.meta)
}

canvasApi.on(
  'benchmark-open',
  async (
    info: {
      label?: string
      workspaceId?: string
      /** Source repo to branch off. If present without worktreePath, we auto-create a worktree. */
      sourceRepoPath?: string
      /** Explicit worktree path. If set, auto-worktree is skipped and this path is used directly. */
      worktreePath?: string
      /** Force skip auto-worktree creation (default: auto-create if only sourceRepoPath is given). */
      autoWorktree?: boolean
      evaluatorPath?: string
      targetFiles?: string[]
      programPath?: string
      noiseClass?: string
      stopConditions?: { scoreTarget?: number; stagnationN?: number; wallClockMs?: number }
      heldOutMetric?: { evaluatorPath: string; baselineScore?: number; regressionThreshold: number }
      linkedTaskId?: string
      position?: { x: number; y: number }
      width?: number
      height?: number
      acceptanceCriteria?: string
      baselineScore?: number
      improvementPct?: number
      scoreTarget?: number
      higherIsBetter?: boolean
    },
    reply: (result: unknown) => void
  ) => {
    const contractErr = validateAcceptanceContract(info)
    if (contractErr) {
      reply({ ok: false, error: contractErr })
      return
    }
    const noiseClass: NoiseClass = VALID_NOISE_CLASSES.includes(info.noiseClass as NoiseClass)
      ? (info.noiseClass as NoiseClass)
      : 'medium'

    const benchmarkId = randomUUID()

    // Resolve the worktree. Default behavior: if the caller supplied sourceRepoPath
    // (or only worktreePath that happens to be a repo root) and didn't opt out via
    // autoWorktree:false, we create an isolated worktree so the run never mutates main.
    let worktreePath = info.worktreePath
    let sourceRepoPath = info.sourceRepoPath ?? info.worktreePath
    let worktreeBranch: string | undefined
    let autoCreatedWorktree = false
    const shouldAuto = info.autoWorktree !== false && (info.sourceRepoPath !== undefined || !info.worktreePath)

    if (!worktreePath && !sourceRepoPath) {
      reply({ ok: false, error: 'sourceRepoPath (or worktreePath) is required' })
      return
    }

    if (shouldAuto && sourceRepoPath) {
      try {
        const created = await createBenchmarkWorktree({
          sourceRepoPath,
          benchmarkId,
          label: info.label || 'Benchmark'
        })
        worktreePath = created.worktreePath
        worktreeBranch = created.branchName
        autoCreatedWorktree = true
      } catch (err) {
        reply({ ok: false, error: `worktree creation failed: ${(err as Error).message}` })
        return
      }
    }

    const pathErr = validateWorktreePath(worktreePath!)
    if (pathErr) {
      reply({ ok: false, error: pathErr })
      return
    }

    const meta: BenchmarkMeta = {
      benchmarkId,
      label: info.label || 'Benchmark',
      workspaceId: info.workspaceId || 'default',
      sourceRepoPath,
      worktreePath: worktreePath!,
      worktreeBranch,
      autoCreatedWorktree,
      evaluatorPath: info.evaluatorPath || 'benchmark/evaluator.sh',
      targetFiles: info.targetFiles ?? [],
      programPath: info.programPath || 'benchmark/program.md',
      noiseClass,
      stopConditions: info.stopConditions ?? {},
      heldOutMetric: info.heldOutMetric,
      status: 'unstarted',
      linkedTaskId: info.linkedTaskId,
      isSoftDeleted: false,
      position: info.position || { x: 120, y: 120 },
      width: info.width || 560,
      height: info.height || 460,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      acceptanceCriteria: (info.acceptanceCriteria ?? '').trim(),
      baselineScore: info.baselineScore!,
      improvementPct: info.improvementPct,
      scoreTarget: info.scoreTarget,
      higherIsBetter: info.higherIsBetter ?? true
    }
    await saveBenchmark(benchmarkId, meta)
    try {
      ensureTileStateDir(meta)
      copyProgramTemplateIfMissing(meta)
    } catch (err) {
      console.warn(`[benchmark] ensureTileStateDir failed for ${benchmarkId}:`, err)
    }
    watchBenchmarkResults(meta)
    mainWindow?.webContents.send('canvas:benchmark-open', { benchmarkId, meta })
    reply({ ok: true, benchmarkId, meta })
  }
)

canvasApi.on(
  'benchmark-read',
  (info: { benchmarkId: string }, reply: (result: unknown) => void) => {
    const b = loadBenchmark(info.benchmarkId)
    if (!b) {
      reply({ ok: false, error: 'Benchmark not found' })
      return
    }
    const runtime = loadRuntimeState(b.meta)
    const rows = readResults(b.meta)
    const brief = readBrief(b.meta)
    reply({ ok: true, meta: b.meta, runtime, rows, brief })
  }
)

canvasApi.on(
  'benchmark-update',
  async (
    info: Partial<BenchmarkMeta> & { benchmarkId: string },
    reply: (result: unknown) => void
  ) => {
    const b = loadBenchmark(info.benchmarkId)
    if (!b) {
      reply({ ok: false, error: 'Benchmark not found' })
      return
    }
    if (info.noiseClass && !VALID_NOISE_CLASSES.includes(info.noiseClass)) {
      reply({ ok: false, error: 'Invalid noiseClass' })
      return
    }
    if (info.status && !VALID_BENCHMARK_STATUSES.includes(info.status)) {
      reply({ ok: false, error: 'Invalid status' })
      return
    }
    const { benchmarkId, ...patch } = info
    await saveBenchmark(benchmarkId, patch)
    mainWindow?.webContents.send('canvas:benchmark-update', { benchmarkId })
    reply({ ok: true })
  }
)

canvasApi.on(
  'benchmark-append-result',
  (
    info: {
      benchmarkId: string
      temp: number
      score: number
      runtimeMs: number
      heldOutScore?: number
      commitSha?: string
      rationale?: string
      candidateReplicates?: number[]
      baselineReplicates?: number[]
    },
    reply: (result: unknown) => void
  ) => {
    const b = loadBenchmark(info.benchmarkId)
    if (!b) {
      reply({ ok: false, error: 'Benchmark not found' })
      return
    }
    const state = loadRuntimeState(b.meta)
    const prevRows = readResults(b.meta)
    const history = acceptedScoresFromRows(prevRows)

    const cmp = compareScores({
      bestScore: state.bestScore,
      candidateScore: info.score,
      candidateReplicates: info.candidateReplicates,
      baselineReplicates: info.baselineReplicates,
      noiseClass: b.meta.noiseClass,
      history
    })

    let heldOutFlag = false
    if (b.meta.heldOutMetric && info.heldOutScore !== undefined) {
      heldOutFlag = heldOutDiverged({
        baseline: b.meta.heldOutMetric.baselineScore ?? state.heldOutBaseline,
        latest: info.heldOutScore,
        regressionThreshold: b.meta.heldOutMetric.regressionThreshold,
        primaryImproved: cmp.accepted
      })
    }

    const now = Date.now()
    const nextIter = state.iterationN + 1

    const row: ResultsRow = {
      iter: nextIter,
      tsMs: now,
      temp: info.temp,
      score: cmp.effectiveCandidate,
      delta:
        cmp.effectiveBaseline === null ? null : cmp.effectiveCandidate - cmp.effectiveBaseline,
      accepted: cmp.accepted && !heldOutFlag,
      runtimeMs: info.runtimeMs,
      heldOutScore: info.heldOutScore ?? null,
      commitSha: info.commitSha ?? null,
      rationale: sanitizeForBrief(info.rationale ?? ''),
      rejectionReason: cmp.accepted && !heldOutFlag ? '' : heldOutFlag ? 'held-out regressed' : cmp.reason
    }
    appendResult(b.meta, row)

    const newBest = cmp.accepted && !heldOutFlag
      ? Math.max(state.bestScore ?? -Infinity, cmp.effectiveCandidate)
      : state.bestScore

    const nextState = {
      ...state,
      iterationN: nextIter,
      tempCycleIdx: state.tempCycleIdx + 1,
      bestScore: newBest === -Infinity ? null : newBest,
      stagnationCounter: row.accepted ? 0 : state.stagnationCounter + 1,
      frozen: state.frozen || cmp.flaggedAnomaly,
      frozenReason: state.frozen ? state.frozenReason : (cmp.flaggedAnomaly ? cmp.reason : undefined),
      status: (cmp.flaggedAnomaly ? 'frozen' : state.status) as BenchmarkStatus,
      lastIterationAt: now,
      startedAt: state.startedAt ?? now,
      keptCount: row.accepted ? state.keptCount + 1 : state.keptCount,
      revertedCount: row.accepted ? state.revertedCount : state.revertedCount + 1,
      heldOutLatest: info.heldOutScore,
      heldOutDivergence: heldOutFlag || state.heldOutDivergence,
      scoreSamples: [...state.scoreSamples.slice(-99), cmp.effectiveCandidate],
      scoreStddev: cmp.observedStddev ?? state.scoreStddev,
      pendingHint: undefined // consumed by the runner; surface resets after each iteration
    }

    // Evaluate stop conditions
    const stopReason = evaluateStopConditions(b.meta, nextState, now)
    if (stopReason && nextState.status === 'running') {
      nextState.status = stopReason === 'frozen' ? 'frozen' : 'stopped'
      nextState.stopReason = stopReason
    }

    saveRuntimeState(b.meta, nextState)

    // Refresh brief
    const refreshedRows = readResults(b.meta)
    const brief = distillBrief({
      state: nextState,
      rows: refreshedRows,
      userHint: state.pendingHint,
      goal: {
        acceptanceCriteria: b.meta.acceptanceCriteria,
        baselineScore: b.meta.baselineScore,
        target: effectiveScoreTarget(b.meta),
        higherIsBetter: b.meta.higherIsBetter !== false,
        improvementPct: b.meta.improvementPct
      }
    })
    writeBrief(b.meta, brief)

    if (cmp.flaggedAnomaly || heldOutFlag) {
      mainWindow?.webContents.send('canvas:notify', {
        id: randomUUID(),
        title: cmp.flaggedAnomaly
          ? 'Benchmark frozen: anomalous jump'
          : 'Benchmark flagged: held-out regressed',
        body: `${b.meta.label} — ${cmp.flaggedAnomaly ? cmp.anomalyDetail ?? cmp.reason : 'primary improved but held-out dropped'}`,
        level: 'error',
        timestamp: Date.now()
      })
    }

    mainWindow?.webContents.send('canvas:benchmark-state-change', {
      benchmarkId: info.benchmarkId
    })
    reply({
      ok: true,
      accepted: row.accepted,
      frozen: nextState.frozen,
      heldOutDivergence: nextState.heldOutDivergence,
      compare: cmp,
      iteration: nextIter,
      bestScore: nextState.bestScore,
      stopReason
    })
  }
)

function evaluateStopConditions(
  meta: BenchmarkMeta,
  state: {
    status: BenchmarkStatus
    stagnationCounter: number
    bestScore: number | null
    startedAt: number | null
    frozen: boolean
  },
  now: number
): BenchmarkStopReason | null {
  if (state.frozen) return 'frozen'
  // Declared acceptance target (scoreTarget or baseline + improvementPct) takes
  // precedence over any legacy stopConditions.scoreTarget.
  if (goalReached(meta, state.bestScore)) return 'target'
  const { stagnationN, wallClockMs } = meta.stopConditions
  if (stagnationN !== undefined && state.stagnationCounter >= stagnationN) {
    return 'stagnation'
  }
  if (wallClockMs !== undefined && state.startedAt !== null && now - state.startedAt >= wallClockMs) {
    return 'wallclock'
  }
  return null
}

canvasApi.on(
  'benchmark-hint',
  (info: { benchmarkId: string; hint: string }, reply: (result: unknown) => void) => {
    const b = loadBenchmark(info.benchmarkId)
    if (!b) {
      reply({ ok: false, error: 'Benchmark not found' })
      return
    }
    const state = loadRuntimeState(b.meta)
    state.pendingHint = sanitizeForBrief(info.hint ?? '').slice(0, 500)
    saveRuntimeState(b.meta, state)
    mainWindow?.webContents.send('canvas:benchmark-state-change', {
      benchmarkId: info.benchmarkId
    })
    reply({ ok: true })
  }
)

canvasApi.on(
  'benchmark-control',
  async (
    info: {
      benchmarkId: string
      action: 'start' | 'pause' | 'resume' | 'stop' | 'unfreeze'
    },
    reply: (result: unknown) => void
  ) => {
    const b = loadBenchmark(info.benchmarkId)
    if (!b) {
      reply({ ok: false, error: 'Benchmark not found' })
      return
    }
    const state = loadRuntimeState(b.meta)
    const now = Date.now()
    switch (info.action) {
      case 'start':
        state.status = 'running'
        state.startedAt = state.startedAt ?? now
        await saveBenchmark(info.benchmarkId, { status: 'running' })
        break
      case 'pause':
        state.status = 'paused'
        await saveBenchmark(info.benchmarkId, { status: 'paused' })
        break
      case 'resume':
        state.status = 'running'
        await saveBenchmark(info.benchmarkId, { status: 'running' })
        break
      case 'stop':
        state.status = 'stopped'
        state.stopReason = 'user'
        await saveBenchmark(info.benchmarkId, { status: 'stopped', stopReason: 'user' })
        break
      case 'unfreeze':
        state.frozen = false
        state.frozenReason = undefined
        state.status = 'paused' // require explicit resume
        await saveBenchmark(info.benchmarkId, { status: 'paused' })
        break
      default:
        reply({ ok: false, error: `Unknown action: ${info.action}` })
        return
    }
    saveRuntimeState(b.meta, state)
    mainWindow?.webContents.send('canvas:benchmark-state-change', {
      benchmarkId: info.benchmarkId
    })
    reply({ ok: true, state })
  }
)

canvasApi.on(
  'benchmark-convert-from-task',
  async (
    info: {
      taskId: string
      sourceRepoPath?: string
      worktreePath?: string
      autoWorktree?: boolean
      evaluatorPath?: string
      targetFiles?: string[]
      noiseClass?: string
      stopConditions?: { scoreTarget?: number; stagnationN?: number; wallClockMs?: number }
      heldOutMetric?: { evaluatorPath: string; baselineScore?: number; regressionThreshold: number }
      position?: { x: number; y: number }
      acceptanceCriteria?: string
      baselineScore?: number
      improvementPct?: number
      scoreTarget?: number
      higherIsBetter?: boolean
    },
    reply: (result: unknown) => void
  ) => {
    const t = loadTask(info.taskId)
    if (!t) {
      reply({ ok: false, error: 'Task not found' })
      return
    }
    if (t.meta.classification !== 'BENCHMARK') {
      reply({ ok: false, error: 'Only BENCHMARK-classified tasks can be harnessed' })
      return
    }
    const sourceRepoPath = info.sourceRepoPath ?? info.worktreePath
    let worktreePath = info.worktreePath
    let worktreeBranch: string | undefined
    let autoCreatedWorktree = false
    const benchmarkIdPre = randomUUID()
    const shouldAuto = info.autoWorktree !== false && (info.sourceRepoPath !== undefined || !info.worktreePath)
    if (shouldAuto && sourceRepoPath) {
      try {
        const created = await createBenchmarkWorktree({
          sourceRepoPath,
          benchmarkId: benchmarkIdPre,
          label: t.meta.label
        })
        worktreePath = created.worktreePath
        worktreeBranch = created.branchName
        autoCreatedWorktree = true
      } catch (err) {
        reply({ ok: false, error: `worktree creation failed: ${(err as Error).message}` })
        return
      }
    }
    if (!worktreePath) {
      reply({ ok: false, error: 'sourceRepoPath (or worktreePath) is required' })
      return
    }
    const pathErr = validateWorktreePath(worktreePath)
    if (pathErr) {
      reply({ ok: false, error: pathErr })
      return
    }
    // Inherit human-readable acceptance from the parent task's acceptanceCriteria
    // (TipTap JSON → markdown) if the caller didn't override.
    const inheritedAcceptance = info.acceptanceCriteria ?? jsonToMarkdown(t.acceptanceCriteria)
    const contractErr = validateAcceptanceContract({
      acceptanceCriteria: inheritedAcceptance,
      baselineScore: info.baselineScore,
      improvementPct: info.improvementPct,
      scoreTarget: info.scoreTarget
    })
    if (contractErr) {
      reply({ ok: false, error: contractErr })
      return
    }
    const noiseClass: NoiseClass = VALID_NOISE_CLASSES.includes(info.noiseClass as NoiseClass)
      ? (info.noiseClass as NoiseClass)
      : 'medium'

    const benchmarkId = benchmarkIdPre
    const meta: BenchmarkMeta = {
      benchmarkId,
      label: t.meta.label,
      workspaceId: t.meta.workspaceId,
      sourceRepoPath,
      worktreePath,
      worktreeBranch,
      autoCreatedWorktree,
      evaluatorPath: info.evaluatorPath || 'benchmark/evaluator.sh',
      targetFiles: info.targetFiles ?? [],
      programPath: 'benchmark/program.md',
      noiseClass,
      stopConditions: info.stopConditions ?? {},
      heldOutMetric: info.heldOutMetric,
      status: 'unstarted',
      linkedTaskId: info.taskId,
      isSoftDeleted: false,
      position: info.position || { x: t.meta.position.x + 40, y: t.meta.position.y + 40 },
      width: 560,
      height: 460,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      acceptanceCriteria: inheritedAcceptance.trim(),
      baselineScore: info.baselineScore!,
      improvementPct: info.improvementPct,
      scoreTarget: info.scoreTarget,
      higherIsBetter: info.higherIsBetter ?? true
    }
    await saveBenchmark(benchmarkId, meta)
    try {
      ensureTileStateDir(meta)
      copyProgramTemplateIfMissing(meta)
    } catch (err) {
      console.warn(`[benchmark] ensureTileStateDir failed for ${benchmarkId}:`, err)
    }

    // Link task → benchmark via executing-in edge (task's terminal-like executor)
    const edges = loadEdges()
    const taskBenchEdge: PersistedEdge = {
      id: `e-${randomUUID()}`,
      source: info.taskId,
      target: benchmarkId,
      kind: 'executing-in'
    }
    edges.edges.push(taskBenchEdge)
    saveEdges(edges)

    watchBenchmarkResults(meta)
    mainWindow?.webContents.send('canvas:benchmark-open', { benchmarkId, meta })
    // Re-use the canvas:task-link channel — it's the generic "an edge was added
    // at runtime" event the renderer already listens to for live rendering.
    mainWindow?.webContents.send('canvas:task-link', taskBenchEdge)
    reply({ ok: true, benchmarkId, meta })
  }
)

canvasApi.on(
  'benchmark-handoff-plan',
  async (
    info: { benchmarkId: string; stopReason?: BenchmarkStopReason },
    reply: (result: unknown) => void
  ) => {
    const b = loadBenchmark(info.benchmarkId)
    if (!b) {
      reply({ ok: false, error: 'Benchmark not found' })
      return
    }
    const state = loadRuntimeState(b.meta)
    const rows = readResults(b.meta)
    const accepted = rows.filter((r) => r.accepted)
    const best = accepted.length > 0
      ? accepted.reduce((a, c) => (c.score > a.score ? c : a), accepted[0])
      : null

    const summary = buildPlanHandoffMarkdown(b.meta, state, rows, best)
    const doc = await storeCreatePlan({
      label: `Winning plan: ${b.meta.label}`,
      workspaceId: b.meta.workspaceId,
      content: summary,
      position: { x: b.meta.position.x + 80, y: b.meta.position.y + 80 }
    })

    // Link benchmark → plan via has-plan edge
    const edges = loadEdges()
    const benchPlanEdge: PersistedEdge = {
      id: `e-${randomUUID()}`,
      source: info.benchmarkId,
      target: doc.meta.planId,
      kind: 'has-plan'
    }
    edges.edges.push(benchPlanEdge)
    saveEdges(edges)
    setTimeout(() => {
      mainWindow?.webContents.send('canvas:task-link', benchPlanEdge)
    }, 500)

    // Mark benchmark as done
    await saveBenchmark(info.benchmarkId, {
      status: 'done',
      stopReason: info.stopReason ?? state.stopReason
    })
    state.status = 'done'
    state.stopReason = info.stopReason ?? state.stopReason
    saveRuntimeState(b.meta, state)

    mainWindow?.webContents.send('canvas:benchmark-state-change', {
      benchmarkId: info.benchmarkId
    })
    mainWindow?.webContents.send('canvas:notify', {
      id: randomUUID(),
      title: 'Benchmark complete — Plan Tile created',
      body: `${b.meta.label} · best=${state.bestScore ?? 'n/a'}`,
      level: 'success',
      timestamp: Date.now()
    })
    reply({ ok: true, planId: doc.meta.planId, winningIter: best?.iter, bestScore: state.bestScore })
  }
)

function buildPlanHandoffMarkdown(
  meta: BenchmarkMeta,
  state: ReturnType<typeof loadRuntimeState>,
  rows: ResultsRow[],
  best: ResultsRow | null
): string {
  const accepted = rows.filter((r) => r.accepted)
  const ratio = rows.length === 0 ? 0 : accepted.length / rows.length
  const target = effectiveScoreTarget(meta)
  const goalMet = goalReached(meta, state.bestScore)
  const lines: string[] = []
  lines.push(`# Benchmark winning plan — ${meta.label}`)
  lines.push('')
  lines.push(`## Goal`)
  lines.push(meta.acceptanceCriteria || '(no human-readable acceptance criterion recorded)')
  lines.push('')
  lines.push(`- baseline: ${meta.baselineScore}`)
  lines.push(`- target: ${target ?? 'n/a'}${meta.improvementPct !== undefined ? ` (baseline ${meta.higherIsBetter === false ? '−' : '+'}${meta.improvementPct}%)` : ''}`)
  lines.push(`- direction: ${meta.higherIsBetter === false ? 'lower is better' : 'higher is better'}`)
  lines.push('')
  lines.push(`## Summary`)
  lines.push(`- iterations: ${state.iterationN}`)
  lines.push(`- best_score: ${state.bestScore ?? 'n/a'}  ${goalMet ? '✅ goal reached' : '⚠ goal NOT reached'}`)
  lines.push(`- stop_reason: ${state.stopReason ?? 'n/a'}`)
  lines.push(`- acceptance_rate: ${(ratio * 100).toFixed(1)}% (${accepted.length}/${rows.length})`)
  lines.push(`- noise_class: ${meta.noiseClass}`)
  lines.push(`- frozen: ${state.frozen ? 'yes' : 'no'}`)
  lines.push(`- held_out_divergence: ${state.heldOutDivergence ? 'yes' : 'no'}`)
  lines.push('')
  lines.push(`## Acceptance criteria`)
  lines.push(`- [${goalMet ? 'x' : ' '}] bestScore (${state.bestScore ?? 'n/a'}) ${meta.higherIsBetter === false ? '≤' : '≥'} target (${target ?? 'n/a'})`)
  lines.push(`- [ ] Reviewer has inspected the winning diff on disk`)
  lines.push(`- [ ] Reward-hack audit findings (see .benchmark-tile/audit_findings.md) are addressed`)
  lines.push('')
  if (best) {
    lines.push(`## Winning iteration (iter ${best.iter})`)
    lines.push(`- commit: ${best.commitSha ?? 'n/a'}`)
    lines.push(`- score: ${best.score}`)
    lines.push(`- delta: ${best.delta ?? 0}`)
    lines.push(`- rationale: ${best.rationale || '(none)'}`)
    lines.push('')
  }
  lines.push(`## Steps`)
  lines.push(`- [ ] Review winning diff and run evaluator manually against main`)
  lines.push(`- [ ] If clean, cherry-pick or rebase winning commits onto feature branch`)
  lines.push(`- [ ] Open PR with link to .benchmark-tile/results.tsv`)
  lines.push('')
  lines.push(`## Open Questions`)
  lines.push(`- Are the accepted improvements robust on data outside the pinned shard?`)
  lines.push('')
  lines.push(`## Risks`)
  lines.push(`- Metric gaming: even with sandboxed evaluator + held-out, some exploits can slip through`)
  if (state.frozen) lines.push(`- Run was frozen (${state.frozenReason ?? 'anomaly'}); review before shipping`)
  lines.push('')
  lines.push(`## References`)
  lines.push(`- worktree: ${meta.worktreePath}`)
  lines.push(`- evaluator: ${meta.evaluatorPath}`)
  lines.push(`- results: .benchmark-tile/results.tsv`)
  return lines.join('\n')
}

canvasApi.on(
  'benchmark-close',
  async (info: { benchmarkId: string }, reply: (result: unknown) => void) => {
    await saveBenchmark(info.benchmarkId, { isSoftDeleted: true, softDeletedAt: Date.now() })
    stopWatchingBenchmarkResults(info.benchmarkId)
    mainWindow?.webContents.send('canvas:benchmark-close', { benchmarkId: info.benchmarkId })
    reply({ ok: true })
  }
)

canvasApi.on(
  'benchmark-delete',
  async (info: { benchmarkId: string }, reply: (result: unknown) => void) => {
    const b = loadBenchmark(info.benchmarkId)
    if (b) await removeBenchmarkWorktree(b.meta)
    deleteBenchmark(info.benchmarkId)
    stopWatchingBenchmarkResults(info.benchmarkId)
    mainWindow?.webContents.send('canvas:benchmark-delete', { benchmarkId: info.benchmarkId })
    reply({ ok: true })
  }
)

canvasApi.on(
  'benchmarks-list',
  (reply: (data: unknown) => void) => {
    const all = listBenchmarks()
    reply({ ok: true, benchmarks: all.map((b) => b.meta) })
  }
)

function copyProgramTemplateIfMissing(meta: BenchmarkMeta): void {
  const targetDir = join(meta.worktreePath, 'benchmark')
  const target = join(meta.worktreePath, meta.programPath)
  if (existsSync(target)) return
  const bundled = join(app.getAppPath(), 'resources', 'benchmark', 'program.md')
  let content = ''
  try {
    content = fsReadFileSync(bundled, 'utf-8')
  } catch {
    content = DEFAULT_PROGRAM_MD_INLINE
  }
  try {
    fsMkdirSync(targetDir, { recursive: true })
  } catch {
    // ignore
  }
  try {
    fsWriteFileSync(target, content, { flag: 'wx' })
  } catch {
    // Already exists or write failed — non-fatal
  }
}

const DEFAULT_PROGRAM_MD_INLINE = `# Benchmark program

You are iterating on a score function. Read only the distilled brief, not raw history. Propose ONE targeted diff per iteration. Never edit the evaluator. Commit with \`bench: iter {N}\`.
`

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

  initUpdater(mainWindow!, () => loadSettings())

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
