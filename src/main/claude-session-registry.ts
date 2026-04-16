import { execFile } from 'child_process'
import { promisify } from 'util'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const execFileAsync = promisify(execFile)

export interface ClaudeSessionInfo {
  pid: number
  sessionId: string
  cwd: string
  startedAt: number
}

/**
 * Given the PTY shell's PID, return the PID of the foreground Claude
 * process running in that shell's TTY — or null if none.
 *
 * macOS `ps` only: matches terminal-manager's existing TTY-chain approach.
 * Excludes the shell PID itself so we never false-match a shell that happens
 * to be named `claude` (shouldn't happen but be defensive).
 */
export async function findClaudePidForShell(shellPid: number): Promise<number | null> {
  try {
    // TTY chain: shell -> its tty -> foreground processes on that tty
    const { stdout: ttyOut } = await execFileAsync(
      'ps',
      ['-o', 'tty=', '-p', String(shellPid)],
      { timeout: 2000 }
    )
    const tty = ttyOut.trim()
    if (!tty) return null

    // `ps -t <tty> -o pid=,comm=` lists processes on the tty.
    // Note: do NOT pass `-a` here — combined with `-t` on macOS it widens
    // the result to all processes instead of narrowing to the tty.
    const { stdout: listOut } = await execFileAsync(
      'ps',
      ['-t', tty, '-o', 'pid=,comm='],
      { timeout: 2000 }
    )
    for (const line of listOut.split('\n')) {
      const match = line.trim().match(/^(\d+)\s+(.+)$/)
      if (!match) continue
      const pid = Number(match[1])
      if (pid === shellPid) continue
      const comm = match[2].trim()
      const name = comm.split('/').pop()!.toLowerCase()
      // Same heuristic as `isClaudeProcessName` in terminal-manager.ts
      if (name === 'claude' || name === 'claude-code' || name.startsWith('claude ')) {
        return pid
      }
    }
    return null
  } catch {
    return null
  }
}

/** Read `~/.claude/sessions/<pid>.json`. Returns null if missing or malformed. */
export function readSessionRegistry(claudePid: number): ClaudeSessionInfo | null {
  const path = join(homedir(), '.claude', 'sessions', `${claudePid}.json`)
  if (!existsSync(path)) return null
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<ClaudeSessionInfo>
    if (
      typeof parsed.pid === 'number' &&
      typeof parsed.sessionId === 'string' &&
      typeof parsed.cwd === 'string' &&
      typeof parsed.startedAt === 'number'
    ) {
      return parsed as ClaudeSessionInfo
    }
    return null
  } catch {
    return null
  }
}
