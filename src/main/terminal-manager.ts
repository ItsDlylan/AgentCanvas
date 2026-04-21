import { EventEmitter } from 'events'
import { execSync, execFile } from 'child_process'
import { promisify } from 'util'
import { createServer } from 'net'
import os from 'os'
import { ClaudeLogWatcher, type ClaudeCacheEvent } from './claude-log-watcher'
import { findClaudePidForShell, readSessionRegistry } from './claude-session-registry'

const execFileAsync = promisify(execFile)

// node-pty is loaded at runtime (native module)
let pty: typeof import('node-pty')
try {
  pty = require('node-pty')
} catch {
  console.error('Failed to load node-pty — terminal sessions will not work')
}

export type TerminalStatus = 'idle' | 'running' | 'waiting'
export type CacheState = 'countdown' | 'expired' | null

export interface TerminalSessionInfo {
  id: string
  cwd: string
  status: TerminalStatus
  foregroundProcess: string
  foregroundCommandLine: string
  label: string
  createdAt: number
  cdpPort: number
  metadata: Record<string, unknown>
}

export interface TerminalSession {
  id: string
  label: string
  process: ReturnType<typeof pty.spawn>
  cols: number
  rows: number
  cwd: string
  status: TerminalStatus
  foregroundProcess: string
  foregroundCommandLine: string
  createdAt: number
  lastDataAt: number
  idleTimer: ReturnType<typeof setTimeout> | null
  cdpPort: number
  metadata: Record<string, unknown>
  // Claude Code prompt-cache tracking.
  // The countdown is triggered *only* by user message submission
  // (newline written to a Claude session), which is the moment Anthropic
  // cache TTL is refreshed. Other signals (keystroke echoes, poll
  // detection, status transitions) deliberately do not touch the timer.
  isClaudeSession: boolean
  cacheExpiresAt: number | null
  cacheState: CacheState
  keepAliveTimer: ReturnType<typeof setTimeout> | null
  expiryTimer: ReturnType<typeof setTimeout> | null
  warningTimer: ReturnType<typeof setTimeout> | null
  // How many auto keep-alives have fired since the last user message.
  // Used to respect the cap; reset to 0 on every user submission.
  autoKeepAliveCount: number
  // V2 session correlation: resolved from `~/.claude/sessions/<pid>.json`
  // via the TTY chain. Pins the log-watcher to the exact JSONL file for
  // this terminal's Claude process, avoiding cross-wire when two terminals
  // run Claude in the same cwd. Cleared when Claude exits.
  claudePid?: number
  claudeSessionUuid?: string
  sessionLookupAttempts: number
}

// Stop trying to resolve Claude's session UUID after this many polls
// (~50 s at the 5 s poll cadence). If the registry never appears, the
// watcher stays in v1 latest-mtime mode — worst case is v1 behavior.
const MAX_SESSION_LOOKUP_ATTEMPTS = 10

function isClaudeProcessName(name: string): boolean {
  const n = name.toLowerCase()
  return n === 'claude' || n === 'claude-code' || n.startsWith('claude ')
}

// Patterns that indicate the terminal is waiting for user input
const WAITING_PATTERNS = [
  /\?\s*$/, // "? " prompt (Claude, Codex, etc.)
  /\[Y\/n\]/i, // [Y/n] confirmation
  /\[y\/N\]/i,
  /\(y\/n\)/i,
  /continue\?\s*$/i,
  /proceed\?\s*$/i,
  /\(yes\/no\)/i,
  /Enter passphrase/i,
  /Password:/i,
  /approve|deny|allow/i
]

const IDLE_TIMEOUT_MS = 800

function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as { port: number }).port
      srv.close(() => resolve(port))
    })
    srv.on('error', reject)
  })
}

/**
 * Manages PTY sessions for all terminal tiles.
 *
 * Tracks per-session status (idle/running/waiting), CWD via OSC 7,
 * and foreground process name via `ps`.
 */
export class TerminalManager extends EventEmitter {
  private sessions = new Map<string, TerminalSession>()
  private pollInterval: ReturnType<typeof setInterval> | null = null
  private polling = false
  private statusThrottleTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private pendingStatusEmit = new Map<string, boolean>()

  // Prompt cache settings (propagated from renderer settings)
  private cacheTtlSeconds = 300
  private cacheWarningThresholdSeconds = 60
  private autoKeepAliveEnabled = false
  private keepAliveMessage = '.'
  private maxAutoKeepAlives = 10  // 0 = unlimited
  private notifyOnWarning = true
  private notifyOnExpiry = true
  private detectTtlFromLogs = true

  // One log tailer per Claude-active terminal session.
  private logWatchers = new Map<string, ClaudeLogWatcher>()

  async create(id: string, label: string, cwd?: string, cols = 80, rows = 24, extraEnv?: Record<string, string>, customShell?: string): Promise<number> {
    if (this.sessions.has(id)) return this.sessions.get(id)!.cdpPort

    const cdpPort = await getAvailablePort()

    const shell =
      customShell || process.env.SHELL || (os.platform() === 'win32' ? 'powershell.exe' : '/bin/zsh')
    const workingDir = cwd || os.homedir()

    let userEnv = { ...process.env }
    try {
      const loginPath = execSync(`${shell} -ilc 'echo $PATH'`, {
        encoding: 'utf-8',
        timeout: 5000
      }).trim()
      if (loginPath) userEnv.PATH = loginPath
    } catch {
      // Fall back to process.env.PATH
    }

    const args = os.platform() === 'win32' ? [] : ['--login']

    const proc = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: workingDir,
      env: {
        ...userEnv,
        TERM: 'xterm-256color',
        TERM_PROGRAM: 'AgentCanvas',
        COLORTERM: 'truecolor',
        LANG: 'en_US.UTF-8',
        LC_ALL: 'en_US.UTF-8',
        AGENT_BROWSER_CDP_PORT: String(cdpPort),
        AGENT_BROWSER_CDP: `http://127.0.0.1:${cdpPort}`,
        AGENT_CANVAS_TERMINAL_ID: id,
        ...extraEnv
      } as Record<string, string>
    })

    const session: TerminalSession = {
      id,
      label,
      process: proc,
      cols,
      rows,
      cwd: workingDir,
      status: 'running',
      foregroundProcess: shell.split('/').pop() || 'shell',
      foregroundCommandLine: '',
      createdAt: Date.now(),
      lastDataAt: Date.now(),
      idleTimer: null,
      cdpPort,
      metadata: {},
      isClaudeSession: false,
      cacheExpiresAt: null,
      cacheState: null,
      keepAliveTimer: null,
      expiryTimer: null,
      warningTimer: null,
      autoKeepAliveCount: 0,
      sessionLookupAttempts: 0
    }

    this.sessions.set(id, session)

    proc.onData((data: string) => {
      session.lastDataAt = Date.now()

      // Parse OSC 7 for CWD updates: \x1b]7;file://hostname/path\x07
      const osc7Match = data.match(/\x1b\]7;file:\/\/[^/]*([^\x07\x1b]+)/)
      if (osc7Match) {
        const decoded = decodeURIComponent(osc7Match[1])
        if (decoded !== session.cwd) {
          session.cwd = decoded
          this.throttledEmitStatus(id)
          this.logWatchers.get(id)?.updateCwd(decoded)
        }
      }

      // Check for waiting patterns in the latest chunk
      const lastLine = data.split('\n').pop() || ''
      if (WAITING_PATTERNS.some((p) => p.test(lastLine))) {
        this.setStatus(id, 'waiting')
      } else {
        this.setStatus(id, 'running')
      }

      // Reset idle timer — if no more data comes, transition to idle
      if (session.idleTimer) clearTimeout(session.idleTimer)
      session.idleTimer = setTimeout(() => {
        this.setStatus(id, 'idle')
      }, IDLE_TIMEOUT_MS)

      this.emit('data', id, data)
    })

    proc.onExit(({ exitCode }) => {
      if (session.idleTimer) clearTimeout(session.idleTimer)
      this.clearCacheTimers(session)
      this.stopLogWatcher(id)
      this.sessions.delete(id)
      this.emit('exit', id, exitCode)
    })

    // Start polling foreground process if not already running
    if (!this.pollInterval) {
      this.pollInterval = setInterval(() => this.pollForegroundProcesses(), 5000)
    }

    this.emit('created', id)
    return cdpPort
  }

  private setStatus(id: string, status: TerminalStatus): void {
    const session = this.sessions.get(id)
    if (!session || session.status === status) return
    session.status = status
    this.throttledEmitStatus(id)
  }

  private emitStatus(id: string): void {
    const session = this.sessions.get(id)
    if (!session) return
    this.emit('status', id, {
      status: session.status,
      cwd: session.cwd,
      foregroundProcess: session.foregroundProcess,
      foregroundCommandLine: session.foregroundCommandLine,
      metadata: session.metadata
    })
  }

  /** Throttled status emission — at most once per 200ms per terminal */
  private throttledEmitStatus(id: string): void {
    this.pendingStatusEmit.set(id, true)
    if (this.statusThrottleTimers.has(id)) return

    // Emit immediately for the first update in the window
    this.emitStatus(id)
    this.pendingStatusEmit.delete(id)

    this.statusThrottleTimers.set(
      id,
      setTimeout(() => {
        this.statusThrottleTimers.delete(id)
        if (this.pendingStatusEmit.has(id)) {
          this.pendingStatusEmit.delete(id)
          this.emitStatus(id)
        }
      }, 200)
    )
  }

  private async pollForegroundProcesses(): Promise<void> {
    if (os.platform() === 'win32' || this.polling) return
    this.polling = true

    try {
      const polls = Array.from(this.sessions.entries()).map(async ([id, session]) => {
        try {
          const pid = session.process.pid

          // Resolve the shell's TTY, then list *every* process on that TTY in
          // a single `ps` call. Iterating the list (rather than `tail -1`-ing
          // it) is the only way to reliably detect Claude when it has spawned
          // children — node/bash/gh/agent-browser often land last in ps output
          // and would otherwise mask the claude process. Mirrors the pattern
          // in claude-session-registry.ts:findClaudePidForShell.
          const { stdout: ttyOut } = await execFileAsync(
            'ps',
            ['-o', 'tty=', '-p', String(pid)],
            { timeout: 2000 }
          )
          if (!this.sessions.has(id)) return
          const tty = ttyOut.trim()
          if (!tty) return

          const { stdout: listOut } = await execFileAsync(
            'ps',
            ['-t', tty, '-o', 'pid=,stat=,comm=,args='],
            { timeout: 2000 }
          )
          if (!this.sessions.has(id)) return

          const psLines = listOut.split('\n').filter((l) => l.trim().length > 0)
          // stat and comm are single tokens; args is the rest of the line.
          const entries = psLines
            .map((line) => {
              const m = line.match(/^\s*(\d+)\s+(\S+)\s+(\S+)\s+(.*)$/)
              if (!m) return null
              const entryPid = Number(m[1])
              if (entryPid === pid) return null // skip the shell itself
              return {
                pid: entryPid,
                stat: m[2],
                comm: (m[3].split('/').pop() || m[3]).trim(),
                args: m[4].trim()
              }
            })
            .filter((e): e is NonNullable<typeof e> => e !== null)

          const nowClaude = entries.some((e) => isClaudeProcessName(e.comm))

          // Pick a display entry for foregroundProcess / foregroundCommandLine.
          // Prefer entries in the foreground process group (stat contains '+'),
          // then any claude entry, else the last entry on the TTY.
          const fgEntries = entries.filter((e) => e.stat.includes('+'))
          const displayPool = fgEntries.length > 0 ? fgEntries : entries
          const claudeInPool = displayPool.find((e) => isClaudeProcessName(e.comm))
          const display = claudeInPool ?? displayPool[displayPool.length - 1]
          const name = display?.comm ?? ''
          const cmdLine = display?.args ?? ''

          let changed = false

          if (name && name !== session.foregroundProcess) {
            session.foregroundProcess = name
            changed = true
          }

          if (cmdLine && cmdLine !== session.foregroundCommandLine) {
            session.foregroundCommandLine = cmdLine
          }

          // Detect Claude Code entering/leaving the terminal.
          // We only flag the session — the countdown starts when the user
          // submits their first message (handled in write()), since that's
          // when the Anthropic prompt cache actually gets populated.
          const prevClaude = session.isClaudeSession
          if (nowClaude && !session.isClaudeSession) {
            session.isClaudeSession = true
            this.startLogWatcher(session)
            changed = true
          } else if (!nowClaude && session.isClaudeSession) {
            session.isClaudeSession = false
            this.clearCacheState(session)
            this.stopLogWatcher(id)
            // Reset V2 correlation state so a restart re-resolves cleanly.
            session.claudePid = undefined
            session.claudeSessionUuid = undefined
            session.sessionLookupAttempts = 0
            changed = true
          }

          if (prevClaude !== nowClaude && process.env.NODE_ENV !== 'production') {
            // eslint-disable-next-line no-console
            console.debug(
              `[cache-timer] ${session.id} isClaudeSession: ${prevClaude} → ${nowClaude}`,
              { psLines }
            )
          }

          // V2: while Claude is running but we haven't yet pinned the
          // watcher to its session UUID, retry the registry lookup each
          // poll. Handles the startup race where we see `claude` in the
          // foreground before it has flushed `~/.claude/sessions/<pid>.json`.
          if (
            session.isClaudeSession &&
            !session.claudeSessionUuid &&
            session.sessionLookupAttempts < MAX_SESSION_LOOKUP_ATTEMPTS
          ) {
            session.sessionLookupAttempts += 1
            // Fire-and-forget — don't block polling on this.
            void this.resolveClaudeSession(session)
          }

          // Fallback CWD: read from lsof if OSC 7 hasn't fired
          try {
            const { stdout: cwdResult } = await execFileAsync('lsof', [
              '-a', '-d', 'cwd', '-p', String(pid), '-Fn'
            ], { timeout: 2000 })

            if (!this.sessions.has(id)) return

            const nLine = cwdResult.split('\n').find((l) => l.startsWith('n'))
            const cwd = nLine ? nLine.slice(1).trim() : ''

            if (cwd && cwd !== session.cwd) {
              session.cwd = cwd
              changed = true
              this.logWatchers.get(id)?.updateCwd(cwd)
            }
          } catch {
            // lsof may fail
          }

          if (changed) this.emitStatus(id)
        } catch {
          // Process may have exited
        }
      })

      await Promise.allSettled(polls)
    } finally {
      this.polling = false
    }
  }

  // ── Prompt cache TTL tracking ──────────────────────────

  /** Update cache settings — called from main/index.ts on settings load/save. */
  setCacheSettings(s: {
    ttlSeconds?: number
    warningThresholdSeconds?: number
    autoKeepAlive?: boolean
    keepAliveMessage?: string
    maxAutoKeepAlives?: number
    notifyOnWarning?: boolean
    notifyOnExpiry?: boolean
    detectTtlFromLogs?: boolean
  }): void {
    const autoKeepAliveChanged =
      typeof s.autoKeepAlive === 'boolean' && s.autoKeepAlive !== this.autoKeepAliveEnabled
    const maxChanged =
      typeof s.maxAutoKeepAlives === 'number' && s.maxAutoKeepAlives !== this.maxAutoKeepAlives
    const detectChanged =
      typeof s.detectTtlFromLogs === 'boolean' && s.detectTtlFromLogs !== this.detectTtlFromLogs

    if (typeof s.ttlSeconds === 'number') this.cacheTtlSeconds = s.ttlSeconds
    if (typeof s.warningThresholdSeconds === 'number') this.cacheWarningThresholdSeconds = s.warningThresholdSeconds
    if (typeof s.autoKeepAlive === 'boolean') this.autoKeepAliveEnabled = s.autoKeepAlive
    if (typeof s.keepAliveMessage === 'string') this.keepAliveMessage = s.keepAliveMessage
    if (typeof s.maxAutoKeepAlives === 'number') this.maxAutoKeepAlives = Math.max(0, s.maxAutoKeepAlives)
    if (typeof s.notifyOnWarning === 'boolean') this.notifyOnWarning = s.notifyOnWarning
    if (typeof s.notifyOnExpiry === 'boolean') this.notifyOnExpiry = s.notifyOnExpiry
    if (typeof s.detectTtlFromLogs === 'boolean') this.detectTtlFromLogs = s.detectTtlFromLogs

    // When auto-keep-alive or its cap changes, re-evaluate the in-flight
    // timers so the setting takes effect immediately instead of only applying
    // to the next user submission.
    if (autoKeepAliveChanged || maxChanged) {
      for (const session of this.sessions.values()) {
        this.scheduleKeepAlive(session)
      }
    }

    // Toggling log-based TTL detection takes effect live: spin up or tear
    // down watchers for any currently-active Claude sessions.
    if (detectChanged) {
      if (this.detectTtlFromLogs) {
        for (const session of this.sessions.values()) {
          if (session.isClaudeSession) this.startLogWatcher(session)
        }
      } else {
        for (const id of Array.from(this.logWatchers.keys())) {
          this.stopLogWatcher(id)
        }
      }
    }
  }

  private startLogWatcher(session: TerminalSession): void {
    if (!this.detectTtlFromLogs) return
    if (this.logWatchers.has(session.id)) return
    const watcher = new ClaudeLogWatcher({
      terminalId: session.id,
      cwd: session.cwd,
      // Usually undefined on first call — v1 latest-mtime fallback is used
      // until resolveClaudeSession pins the UUID via setSessionUuid().
      sessionUuid: session.claudeSessionUuid
    })
    watcher.on('cache-event', (e: ClaudeCacheEvent) => this.applyDetectedCacheTtl(e))
    watcher.on('error', (err) => {
      console.warn(`[ClaudeLogWatcher:${session.id}]`, err)
    })
    watcher.start()
    this.logWatchers.set(session.id, watcher)
  }

  /**
   * Resolve the Claude session UUID for this terminal via the PID registry,
   * then late-bind it to the log watcher so subsequent records are read from
   * the correct `<uuid>.jsonl`. No-op if already locked.
   *
   * Called from pollForegroundProcesses while `isClaudeSession && !uuid`.
   * Silently returns on any failure — the next poll will retry (capped by
   * MAX_SESSION_LOOKUP_ATTEMPTS).
   */
  private async resolveClaudeSession(session: TerminalSession): Promise<void> {
    if (session.claudeSessionUuid) return
    const pid = await findClaudePidForShell(session.process.pid)
    if (!pid) return
    const info = readSessionRegistry(pid)
    if (!info) return
    // Re-check state after the awaits — session may have changed.
    if (!this.sessions.has(session.id) || !session.isClaudeSession) return
    session.claudePid = info.pid
    session.claudeSessionUuid = info.sessionId
    this.logWatchers.get(session.id)?.setSessionUuid(info.sessionId)
  }

  private stopLogWatcher(terminalId: string): void {
    const watcher = this.logWatchers.get(terminalId)
    if (!watcher) return
    watcher.stop()
    this.logWatchers.delete(terminalId)
  }

  /**
   * Override the optimistic countdown with the real TTL Anthropic served, as
   * reported by Claude Code's own JSONL log record. Anchored to the record's
   * own timestamp so the expiry is accurate regardless of parse delay.
   */
  private applyDetectedCacheTtl(e: ClaudeCacheEvent): void {
    const session = this.sessions.get(e.terminalId)
    if (!session) return
    if (!session.isClaudeSession) {
      // Rescue: a cache event whose UUID matches this terminal's pinned
      // session UUID is ground truth — Claude IS running, even if ps missed
      // it. claudeSessionUuid is only set after readSessionRegistry(pid)
      // succeeds for a live Claude PID on this TTY, and Claude Code writes a
      // new session file per PID, so a stale JSONL record carries a
      // different UUID and gets rejected here.
      if (!e.sessionUuid || e.sessionUuid !== session.claudeSessionUuid) return
      session.isClaudeSession = true
      this.throttledEmitStatus(session.id)
    }

    const expiresAt = e.timestampMs + e.ttlSeconds * 1000
    if (expiresAt <= Date.now()) return // already stale

    this.clearCacheTimers(session)

    session.cacheExpiresAt = expiresAt
    session.cacheState = 'countdown'
    session.metadata.cacheExpiresAt = expiresAt
    session.metadata.cacheState = 'countdown'
    session.metadata.cacheTtlSeconds = e.ttlSeconds
    session.metadata.cacheWarningThresholdSeconds = this.cacheWarningThresholdSeconds
    session.metadata.cacheSource = 'detected'

    this.throttledEmitStatus(e.terminalId)

    // Reschedule warning + expiry against the true expiry time.
    const warnMs = this.cacheWarningThresholdSeconds * 1000
    const warnDelay = expiresAt - Date.now() - warnMs
    if (warnDelay > 0 && this.notifyOnWarning) {
      session.warningTimer = setTimeout(() => {
        const s = this.sessions.get(e.terminalId)
        if (!s || s.cacheState !== 'countdown') return
        this.emitCacheNotification(s, 'warning')
      }, warnDelay)
    }

    const expiryDelay = expiresAt - Date.now()
    if (expiryDelay > 0) {
      session.expiryTimer = setTimeout(() => {
        const s = this.sessions.get(e.terminalId)
        if (!s || s.cacheState !== 'countdown') return
        s.cacheState = 'expired'
        s.metadata.cacheState = 'expired'
        this.throttledEmitStatus(e.terminalId)
        if (this.notifyOnExpiry) this.emitCacheNotification(s, 'expired')
      }, expiryDelay + 50)
    }

    this.scheduleKeepAlive(session)
  }

  /**
   * Reset the cache countdown to a fresh TTL. Called when the user submits
   * a message to a Claude session — that's the moment the Anthropic prompt
   * cache is refreshed. This is the *only* trigger; status transitions and
   * arbitrary PTY output deliberately don't restart the timer.
   */
  private refreshCacheCountdown(id: string): void {
    const session = this.sessions.get(id)
    if (!session || !session.isClaudeSession) return

    this.clearCacheTimers(session)

    const now = Date.now()
    const ttlMs = this.cacheTtlSeconds * 1000
    const warnMs = this.cacheWarningThresholdSeconds * 1000
    session.cacheExpiresAt = now + ttlMs
    session.cacheState = 'countdown'
    session.metadata.cacheExpiresAt = session.cacheExpiresAt
    session.metadata.cacheState = 'countdown'
    session.metadata.cacheTtlSeconds = this.cacheTtlSeconds
    session.metadata.cacheWarningThresholdSeconds = this.cacheWarningThresholdSeconds
    // Mark this as an optimistic reset — the log tailer may upgrade this to
    // 'detected' within 1-2s once Claude's JSONL record lands.
    session.metadata.cacheSource = 'assumed'

    this.throttledEmitStatus(id)

    // Schedule warning emission
    const warnDelay = ttlMs - warnMs
    if (warnDelay > 0 && this.notifyOnWarning) {
      session.warningTimer = setTimeout(() => {
        const s = this.sessions.get(id)
        if (!s || s.cacheState !== 'countdown') return
        this.emitCacheNotification(s, 'warning')
      }, warnDelay)
    }

    // Schedule expiry
    if (ttlMs > 0) {
      session.expiryTimer = setTimeout(() => {
        const s = this.sessions.get(id)
        if (!s || s.cacheState !== 'countdown') return
        s.cacheState = 'expired'
        s.metadata.cacheState = 'expired'
        this.throttledEmitStatus(id)
        if (this.notifyOnExpiry) this.emitCacheNotification(s, 'expired')
      }, ttlMs + 50)
    }

    // Schedule auto keep-alive. We fire 15s before expiry so there's
    // enough time for the keep-alive message to reach Claude, the API
    // call to happen, and the cache to refresh — before the old TTL lapses.
    this.scheduleKeepAlive(session)
  }

  private scheduleKeepAlive(session: TerminalSession): void {
    if (session.keepAliveTimer) {
      clearTimeout(session.keepAliveTimer)
      session.keepAliveTimer = null
    }
    if (!this.autoKeepAliveEnabled) return
    if (session.cacheState !== 'countdown' || !session.cacheExpiresAt) return
    // Respect the per-session cap. 0 means unlimited.
    if (this.maxAutoKeepAlives > 0 && session.autoKeepAliveCount >= this.maxAutoKeepAlives) return

    const LEAD_MS = 15_000
    const fireAt = session.cacheExpiresAt - LEAD_MS
    const delay = fireAt - Date.now()
    if (delay <= 0) return

    const id = session.id
    session.keepAliveTimer = setTimeout(() => {
      const s = this.sessions.get(id)
      if (!s || s.cacheState !== 'countdown') return
      this.keepAlive(id, true)
    }, delay)
  }

  /** Clear timers (warning, expiry, keep-alive) without touching state fields. */
  private clearCacheTimers(session: TerminalSession): void {
    if (session.warningTimer) {
      clearTimeout(session.warningTimer)
      session.warningTimer = null
    }
    if (session.expiryTimer) {
      clearTimeout(session.expiryTimer)
      session.expiryTimer = null
    }
    if (session.keepAliveTimer) {
      clearTimeout(session.keepAliveTimer)
      session.keepAliveTimer = null
    }
  }

  /** Fully clear cache state + metadata (called when Claude exits the terminal). */
  private clearCacheState(session: TerminalSession): void {
    this.clearCacheTimers(session)
    session.cacheState = null
    session.cacheExpiresAt = null
    delete session.metadata.cacheState
    delete session.metadata.cacheExpiresAt
    delete session.metadata.cacheTtlSeconds
    delete session.metadata.cacheWarningThresholdSeconds
    delete session.metadata.cacheSource
  }

  private emitCacheNotification(session: TerminalSession, kind: 'warning' | 'expired'): void {
    const remainingSec = session.cacheExpiresAt
      ? Math.max(0, Math.ceil((session.cacheExpiresAt - Date.now()) / 1000))
      : 0
    const payload = kind === 'warning'
      ? {
          title: 'Cache expiring soon',
          body: `${session.label} — ~${remainingSec}s until prompt cache expires`,
          level: 'warning',
          priority: 'high',
          duration: 0 // sticky
        }
      : {
          title: 'Cache expired',
          body: `${session.label} — next request will pay full cache cost`,
          level: 'error',
          priority: 'critical',
          duration: 0
        }
    this.emit('cache-notify', {
      terminalId: session.id,
      ...payload
    })
  }

  /**
   * Write the configured keep-alive message to the PTY. Triggers Claude to make
   * an API call, which refreshes the prompt cache.
   *
   * Uses `\r` (what xterm sends for Enter) as the submit signal because Claude
   * Code treats `\n` as a newline-within-input, not a message submission.
   *
   * The message text and `\r` are written as *two separate* PTY writes
   * separated by a short delay. Claude Code's TUI implements xterm bracketed
   * paste detection — when multiple bytes arrive in one read(), the `\r` is
   * treated as a literal newline inside a paste rather than an Enter
   * keystroke. Splitting the writes makes `\r` arrive in its own read(), so
   * Claude processes it as a real submit. Matches how xterm.js delivers real
   * user keystrokes (one `data` event per key).
   *
   * @param isAuto true when fired by the auto-keep-alive timer (counts toward
   *               the per-session cap). false for manual Refresh / API calls
   *               (resets the counter — user is actively engaged).
   */
  keepAlive(id: string, isAuto = false): boolean {
    const session = this.sessions.get(id)
    if (!session || !session.isClaudeSession) return false

    if (isAuto) {
      // Re-check the cap at fire time (setting may have changed since scheduling).
      if (this.maxAutoKeepAlives > 0 && session.autoKeepAliveCount >= this.maxAutoKeepAlives) {
        return false
      }
      session.autoKeepAliveCount += 1
    } else {
      // Manual keep-alive counts as user engagement — reset the counter.
      session.autoKeepAliveCount = 0
    }

    // Refresh the displayed countdown immediately for instant feedback.
    this.refreshCacheCountdown(id)
    session.process.write(this.keepAliveMessage)
    setTimeout(() => {
      const s = this.sessions.get(id)
      if (!s) return // session torn down during the delay
      s.process.write('\r')
    }, 30)
    return true
  }

  // ───────────────────────────────────────────────────────

  write(id: string, data: string): void {
    const session = this.sessions.get(id)
    if (!session) return
    // Enter in xterm sends "\r"; accept "\n" defensively for paste/hotkey
    // variants. Every user submission to a Claude session refreshes the cache
    // countdown to the full TTL immediately — no intermediate "active" state,
    // no waiting for Claude's response.
    if (session.isClaudeSession && (data.includes('\r') || data.includes('\n'))) {
      // User is actively engaged — reset the auto-keep-alive counter so the
      // cap applies to *continuous* idle sessions, not the whole process.
      session.autoKeepAliveCount = 0
      this.refreshCacheCountdown(id)
    }
    session.process.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    const session = this.sessions.get(id)
    if (!session) return
    session.process.resize(cols, rows)
    session.cols = cols
    session.rows = rows
  }

  kill(id: string): void {
    const session = this.sessions.get(id)
    if (!session) return
    if (session.idleTimer) clearTimeout(session.idleTimer)
    this.clearCacheTimers(session)
    this.stopLogWatcher(id)
    session.process.kill()
    this.sessions.delete(id)
    this.emit('exit', id, 0)

    if (this.sessions.size === 0 && this.pollInterval) {
      clearInterval(this.pollInterval)
      this.pollInterval = null
    }
  }

  getSession(id: string): TerminalSession | undefined {
    return this.sessions.get(id)
  }

  getStatus(id: string): TerminalSessionInfo | undefined {
    const s = this.sessions.get(id)
    if (!s) return undefined
    return {
      id: s.id,
      cwd: s.cwd,
      status: s.status,
      foregroundProcess: s.foregroundProcess,
      foregroundCommandLine: s.foregroundCommandLine,
      label: s.label,
      createdAt: s.createdAt,
      cdpPort: s.cdpPort,
      metadata: s.metadata
    }
  }

  listSessions(): TerminalSessionInfo[] {
    return Array.from(this.sessions.values()).map((s) => ({
      id: s.id,
      cwd: s.cwd,
      status: s.status,
      foregroundProcess: s.foregroundProcess,
      foregroundCommandLine: s.foregroundCommandLine,
      label: s.label,
      createdAt: s.createdAt,
      cdpPort: s.cdpPort,
      metadata: s.metadata
    }))
  }

  rename(id: string, label: string): boolean {
    const session = this.sessions.get(id)
    if (!session) return false
    session.label = label
    return true
  }

  setMetadata(id: string, key: string, value: unknown): boolean {
    const session = this.sessions.get(id)
    if (!session) return false
    session.metadata[key] = value
    this.throttledEmitStatus(id)
    return true
  }

  destroyAll(): void {
    for (const [id] of this.sessions) {
      this.kill(id)
    }
  }
}
