import { EventEmitter } from 'events'
import { execSync, execFile } from 'child_process'
import { promisify } from 'util'
import { createServer } from 'net'
import os from 'os'

const execFileAsync = promisify(execFile)

// node-pty is loaded at runtime (native module)
let pty: typeof import('node-pty')
try {
  pty = require('node-pty')
} catch {
  console.error('Failed to load node-pty — terminal sessions will not work')
}

export type TerminalStatus = 'idle' | 'running' | 'waiting'

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
      metadata: {}
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

          // Get foreground process name (async — does not block event loop)
          const { stdout: result } = await execFileAsync('/bin/sh', [
            '-c',
            `ps -o comm= -t $(ps -o tty= -p ${pid} 2>/dev/null) 2>/dev/null | tail -1`
          ], { timeout: 2000 })

          if (!this.sessions.has(id)) return // Session may have been killed during await

          const name = result.trim().split('/').pop() || ''
          let changed = false

          if (name && name !== session.foregroundProcess) {
            session.foregroundProcess = name
            changed = true
          }

          // Get full command line for persistence across restarts
          try {
            const { stdout: argsResult } = await execFileAsync('/bin/sh', [
              '-c',
              `ps -o args= -t $(ps -o tty= -p ${pid} 2>/dev/null) 2>/dev/null | tail -1`
            ], { timeout: 2000 })

            if (this.sessions.has(id)) {
              const cmdLine = argsResult.trim()
              if (cmdLine && cmdLine !== session.foregroundCommandLine) {
                session.foregroundCommandLine = cmdLine
              }
            }
          } catch {
            // ps may fail
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

  write(id: string, data: string): void {
    this.sessions.get(id)?.process.write(data)
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
