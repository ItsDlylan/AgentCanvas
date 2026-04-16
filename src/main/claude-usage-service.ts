import { EventEmitter } from 'events'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  watch,
  writeFileSync,
  type FSWatcher
} from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { execFile } from 'child_process'
import { promisify } from 'util'
import type { ClaudeUsageSnapshot } from '../renderer/types/claude-usage'

const execFileAsync = promisify(execFile)

const CLAUDE_DIR = join(homedir(), '.claude')
const USAGE_FILE = join(CLAUDE_DIR, 'usage.json')
const API_URL = 'https://api.anthropic.com/api/oauth/usage'
const API_HEADERS = {
  Accept: 'application/json',
  'anthropic-beta': 'oauth-2025-04-20',
  'User-Agent': 'claude-code/2.0.31'
} as const
const FETCH_TIMEOUT_MS = 5_000
const API_POLL_INTERVAL_MS = 10 * 60 * 1000 // 10 minutes
const FILE_DEBOUNCE_MS = 300
const DIR_DEBOUNCE_MS = 500

/**
 * Owns the Claude Code usage data shown in the titlebar widget.
 *
 * Two modes:
 *   - 'file' — `~/.claude/usage.json` exists (the user's statusline script
 *     maintains it). We watch the file and surface its contents.
 *   - 'api'  — the file does not exist. We fetch /api/oauth/usage from
 *     Anthropic every 10 minutes, using the OAuth token from the macOS
 *     Keychain, and write the response to usage.json.
 *
 * Dynamically switches modes as the file appears/disappears at runtime.
 */
class ClaudeUsageService extends EventEmitter {
  private snapshot: ClaudeUsageSnapshot = {
    configured: false,
    usage: null,
    lastUpdatedAt: null,
    error: null,
    source: null
  }

  private mode: 'file' | 'api' | 'idle' = 'idle'
  private dirWatcher: FSWatcher | null = null
  private fileWatcher: FSWatcher | null = null
  private dirDebounce: ReturnType<typeof setTimeout> | null = null
  private fileDebounce: ReturnType<typeof setTimeout> | null = null
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private started = false

  start(): void {
    if (this.started) return
    this.started = true

    // Watch the directory so we notice usage.json being created/deleted.
    // `fs.watch` on a nonexistent file is a no-op, so we must watch the dir.
    this.startDirWatcher()
    this.reconcileMode()
  }

  stop(): void {
    this.started = false
    this.stopDirWatcher()
    this.stopFileWatcher()
    this.stopApiPolling()
    this.mode = 'idle'
  }

  getSnapshot(): ClaudeUsageSnapshot {
    return this.snapshot
  }

  // ── Mode reconciliation ──────────────────────────────────

  private reconcileMode(): void {
    if (!this.started) return
    const fileExists = existsSync(USAGE_FILE)
    if (fileExists && this.mode !== 'file') {
      this.switchToFileMode()
    } else if (!fileExists && this.mode !== 'api') {
      this.switchToApiMode()
    }
  }

  private switchToFileMode(): void {
    this.stopApiPolling()
    this.mode = 'file'
    this.startFileWatcher()
    this.readFromFile()
  }

  private switchToApiMode(): void {
    this.stopFileWatcher()
    this.mode = 'api'
    // Kick off an immediate fetch, then poll on interval.
    void this.fetchFromApi()
    this.pollTimer = setInterval(() => {
      void this.fetchFromApi()
    }, API_POLL_INTERVAL_MS)
  }

  // ── Directory watcher (creation / deletion of usage.json) ──

  private startDirWatcher(): void {
    try {
      if (!existsSync(CLAUDE_DIR)) {
        mkdirSync(CLAUDE_DIR, { recursive: true })
      }
      this.dirWatcher = watch(CLAUDE_DIR, { persistent: false }, (_event, filename) => {
        if (filename !== 'usage.json') return
        if (this.dirDebounce) clearTimeout(this.dirDebounce)
        this.dirDebounce = setTimeout(() => this.reconcileMode(), DIR_DEBOUNCE_MS)
      })
    } catch (err) {
      console.warn('[ClaudeUsageService] Could not watch .claude directory:', err)
    }
  }

  private stopDirWatcher(): void {
    this.dirWatcher?.close()
    this.dirWatcher = null
    if (this.dirDebounce) {
      clearTimeout(this.dirDebounce)
      this.dirDebounce = null
    }
  }

  // ── File watcher (changes to usage.json while in file mode) ──

  private startFileWatcher(): void {
    this.stopFileWatcher()
    try {
      this.fileWatcher = watch(USAGE_FILE, { persistent: false }, () => {
        if (this.fileDebounce) clearTimeout(this.fileDebounce)
        this.fileDebounce = setTimeout(() => this.readFromFile(), FILE_DEBOUNCE_MS)
      })
    } catch (err) {
      console.warn('[ClaudeUsageService] Could not watch usage.json:', err)
    }
  }

  private stopFileWatcher(): void {
    this.fileWatcher?.close()
    this.fileWatcher = null
    if (this.fileDebounce) {
      clearTimeout(this.fileDebounce)
      this.fileDebounce = null
    }
  }

  private readFromFile(): void {
    try {
      const raw = readFileSync(USAGE_FILE, 'utf-8')
      const parsed = JSON.parse(raw) as Record<string, unknown>
      this.update({
        configured: true,
        usage: parsed,
        lastUpdatedAt: new Date().toISOString(),
        error: null,
        source: 'file'
      })
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code
      if (code === 'ENOENT') {
        // File disappeared between existsSync and read — let the dir watcher reconcile.
        this.reconcileMode()
        return
      }
      this.update({
        ...this.snapshot,
        configured: true,
        error: `Could not read usage.json: ${(err as Error).message}`,
        source: 'file'
      })
    }
  }

  // ── API mode (fetch + cache) ─────────────────────────────

  private stopApiPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }

  private async fetchFromApi(): Promise<void> {
    const token = await this.getKeychainToken()
    if (!token) {
      // No creds (e.g. non-macOS, or Claude Code never logged in). Hide the widget.
      this.update({
        configured: false,
        usage: null,
        lastUpdatedAt: null,
        error: null,
        source: 'api'
      })
      return
    }

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
      const res = await fetch(API_URL, {
        method: 'GET',
        headers: {
          ...API_HEADERS,
          Authorization: `Bearer ${token}`
        },
        signal: controller.signal
      })
      clearTimeout(timeout)

      if (!res.ok) {
        this.update({
          ...this.snapshot,
          configured: true,
          error: `API ${res.status} ${res.statusText}`,
          source: 'api'
        })
        return
      }

      const data = (await res.json()) as Record<string, unknown>

      // Validate shape — the statusline also guards against error responses.
      if (!data || (data.five_hour === undefined && data.seven_day === undefined)) {
        this.update({
          ...this.snapshot,
          configured: true,
          error: 'Unexpected API response shape',
          source: 'api'
        })
        return
      }

      // Cache to disk so the shared file is populated (also helps any
      // statusline that starts later). Atomic write: tmp → rename.
      try {
        if (!existsSync(CLAUDE_DIR)) mkdirSync(CLAUDE_DIR, { recursive: true })
        const tmp = `${USAGE_FILE}.tmp.${process.pid}`
        writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8')
        renameSync(tmp, USAGE_FILE)
      } catch (err) {
        console.warn('[ClaudeUsageService] Could not write usage.json:', err)
      }

      this.update({
        configured: true,
        usage: data,
        lastUpdatedAt: new Date().toISOString(),
        error: null,
        source: 'api'
      })
    } catch (err) {
      const name = (err as Error)?.name
      const msg = name === 'AbortError' ? 'Request timed out' : (err as Error).message
      this.update({
        ...this.snapshot,
        configured: true,
        error: `Fetch failed: ${msg}`,
        source: 'api'
      })
    }
  }

  /**
   * Read the Claude Code OAuth access token from the macOS Keychain,
   * matching the statusline script's behaviour. Returns null on any failure
   * (non-macOS, missing keychain entry, malformed credentials blob).
   */
  private async getKeychainToken(): Promise<string | null> {
    if (process.platform !== 'darwin') return null
    try {
      const { stdout } = await execFileAsync('security', [
        'find-generic-password',
        '-s',
        'Claude Code-credentials',
        '-w'
      ])
      const creds = JSON.parse(stdout.trim()) as {
        claudeAiOauth?: { accessToken?: string }
      }
      return creds.claudeAiOauth?.accessToken ?? null
    } catch {
      return null
    }
  }

  // ── Emit updates ─────────────────────────────────────────

  private update(next: ClaudeUsageSnapshot): void {
    this.snapshot = next
    this.emit('changed', this.snapshot)
  }
}

export const claudeUsageService = new ClaudeUsageService()
