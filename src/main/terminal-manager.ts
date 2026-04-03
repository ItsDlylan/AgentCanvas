import { EventEmitter } from 'events'
import { execSync } from 'child_process'
import os from 'os'

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
  label: string
  createdAt: number
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
  createdAt: number
  lastDataAt: number
  idleTimer: ReturnType<typeof setTimeout> | null
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

/**
 * Manages PTY sessions for all terminal tiles.
 *
 * Tracks per-session status (idle/running/waiting), CWD via OSC 7,
 * and foreground process name via `ps`.
 */
export class TerminalManager extends EventEmitter {
  private sessions = new Map<string, TerminalSession>()
  private pollInterval: ReturnType<typeof setInterval> | null = null

  create(id: string, label: string, cwd?: string, cols = 80, rows = 24): void {
    if (this.sessions.has(id)) return

    const shell =
      process.env.SHELL || (os.platform() === 'win32' ? 'powershell.exe' : '/bin/zsh')
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
        LC_ALL: 'en_US.UTF-8'
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
      createdAt: Date.now(),
      lastDataAt: Date.now(),
      idleTimer: null
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
          this.emitStatus(id)
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
      this.pollInterval = setInterval(() => this.pollForegroundProcesses(), 2000)
    }

    this.emit('created', id)
  }

  private setStatus(id: string, status: TerminalStatus): void {
    const session = this.sessions.get(id)
    if (!session || session.status === status) return
    session.status = status
    this.emitStatus(id)
  }

  private emitStatus(id: string): void {
    const session = this.sessions.get(id)
    if (!session) return
    this.emit('status', id, {
      status: session.status,
      cwd: session.cwd,
      foregroundProcess: session.foregroundProcess
    })
  }

  private pollForegroundProcesses(): void {
    if (os.platform() === 'win32') return

    for (const [id, session] of this.sessions) {
      try {
        const pid = session.process.pid

        // Get foreground process name
        const result = execSync(
          `ps -o comm= -t $(ps -o tty= -p ${pid} 2>/dev/null) 2>/dev/null | tail -1`,
          { encoding: 'utf-8', timeout: 1000 }
        ).trim()

        const name = result.split('/').pop() || ''
        let changed = false

        if (name && name !== session.foregroundProcess) {
          session.foregroundProcess = name
          changed = true
        }

        // Fallback CWD: read from /proc or lsof if OSC 7 hasn't fired
        try {
          const cwdResult = execSync(
            `lsof -a -d cwd -p ${pid} -Fn 2>/dev/null | grep '^n' | head -1 | cut -c2-`,
            { encoding: 'utf-8', timeout: 1000 }
          ).trim()

          if (cwdResult && cwdResult !== session.cwd) {
            session.cwd = cwdResult
            changed = true
          }
        } catch {
          // lsof may fail
        }

        if (changed) this.emitStatus(id)
      } catch {
        // Process may have exited
      }
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
      label: s.label,
      createdAt: s.createdAt
    }
  }

  listSessions(): TerminalSessionInfo[] {
    return Array.from(this.sessions.values()).map((s) => ({
      id: s.id,
      cwd: s.cwd,
      status: s.status,
      foregroundProcess: s.foregroundProcess,
      label: s.label,
      createdAt: s.createdAt
    }))
  }

  destroyAll(): void {
    for (const [id] of this.sessions) {
      this.kill(id)
    }
  }
}
