import { EventEmitter } from 'events'
import os from 'os'

// node-pty is loaded at runtime (native module)
let pty: typeof import('node-pty')
try {
  pty = require('node-pty')
} catch {
  console.error('Failed to load node-pty — terminal sessions will not work')
}

export interface TerminalSession {
  id: string
  process: ReturnType<typeof pty.spawn>
  cols: number
  rows: number
  cwd: string
  createdAt: number
}

/**
 * Manages PTY sessions for all terminal tiles.
 *
 * Each session owns a node-pty process. Output is emitted as events
 * so the main process can forward diffs to the renderer via IPC.
 *
 * Future upgrade path: replace this with a Rust sidecar that uses
 * portable-pty + vt100 for headless emulation and diff-based rendering.
 */
export class TerminalManager extends EventEmitter {
  private sessions = new Map<string, TerminalSession>()

  create(id: string, cwd?: string, cols = 80, rows = 24): void {
    if (this.sessions.has(id)) return

    const shell = process.env.SHELL || (os.platform() === 'win32' ? 'powershell.exe' : '/bin/zsh')
    const workingDir = cwd || os.homedir()

    const proc = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: workingDir,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        LANG: 'en_US.UTF-8'
      } as Record<string, string>
    })

    const session: TerminalSession = {
      id,
      process: proc,
      cols,
      rows,
      cwd: workingDir,
      createdAt: Date.now()
    }

    this.sessions.set(id, session)

    // Forward PTY output → main process → renderer
    proc.onData((data: string) => {
      this.emit('data', id, data)
    })

    proc.onExit(({ exitCode }) => {
      this.sessions.delete(id)
      this.emit('exit', id, exitCode)
    })

    this.emit('created', id)
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
    session.process.kill()
    this.sessions.delete(id)
    this.emit('exit', id, 0)
  }

  getSession(id: string): TerminalSession | undefined {
    return this.sessions.get(id)
  }

  listSessions(): Array<{ id: string; cwd: string; createdAt: number }> {
    return Array.from(this.sessions.values()).map((s) => ({
      id: s.id,
      cwd: s.cwd,
      createdAt: s.createdAt
    }))
  }

  destroyAll(): void {
    for (const [id] of this.sessions) {
      this.kill(id)
    }
  }
}
