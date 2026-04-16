import { EventEmitter } from 'events'
import {
  watch,
  readdirSync,
  statSync,
  openSync,
  readSync,
  closeSync,
  existsSync,
  type FSWatcher
} from 'fs'
import { join } from 'path'
import { homedir } from 'os'

export interface ClaudeCacheEvent {
  terminalId: string
  ttlSeconds: 300 | 3600
  timestampMs: number
  sessionUuid: string
}

/**
 * Tails the newest JSONL file inside `~/.claude/projects/<encoded-cwd>/` for a
 * single Claude Code terminal session and emits a `cache-event` every time an
 * assistant record lands that actually touched the prompt cache.
 *
 * Claude Code picks the cache TTL (5m vs 1h) per query client-side, so the
 * only way to know the *real* TTL is to read what Anthropic actually served.
 * Each record exposes that via `usage.cache_creation.ephemeral_{5m,1h}_input_tokens`.
 *
 * Patterned after `TeamWatcher` — `fs.watch` + debounce. Tails incrementally
 * by tracking the last byte offset per file so we don't re-parse 9 MB of
 * history on every write.
 */
export class ClaudeLogWatcher extends EventEmitter {
  private readonly terminalId: string
  private projectDir: string
  private watcher: FSWatcher | null = null
  private existencePollTimer: ReturnType<typeof setInterval> | null = null
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private currentFile: string | null = null
  private lastOffset = 0
  private lineBuffer = ''
  private stopped = false
  // When set, the watcher tails ONLY `<pinnedUuid>.jsonl` in the project dir
  // instead of guessing via latest-mtime. This is how V2 avoids cross-wiring
  // between two terminals running Claude in the same cwd — each terminal
  // resolves its own Claude PID → session UUID and pins its watcher.
  // Null means v1 latest-mtime fallback (before the pin lands, or if
  // resolution failed permanently).
  private pinnedUuid: string | null = null

  constructor(opts: { terminalId: string; cwd: string; sessionUuid?: string }) {
    super()
    this.terminalId = opts.terminalId
    this.projectDir = ClaudeLogWatcher.projectDirFor(opts.cwd)
    this.pinnedUuid = opts.sessionUuid ?? null
  }

  /** Compute `~/.claude/projects/<encoded-cwd>` the way Claude Code does. */
  static projectDirFor(cwd: string): string {
    // Claude's convention: replace every '/' with '-'. An absolute POSIX path
    // already starts with '/', so the result naturally begins with '-'.
    const encoded = cwd.replace(/\//g, '-')
    return join(homedir(), '.claude', 'projects', encoded)
  }

  start(): void {
    if (this.stopped) return
    if (existsSync(this.projectDir)) {
      this.openWatcher()
      // Initial pass: if a JSONL already exists, set offset to EOF so we skip
      // history and only react to records written from here forward.
      this.initializeFromExisting()
    } else {
      // Project dir hasn't been created yet (e.g. the user just typed
      // `claude` but hasn't sent a message). Poll until it appears.
      this.existencePollTimer = setInterval(() => {
        if (this.stopped) return
        if (existsSync(this.projectDir)) {
          if (this.existencePollTimer) {
            clearInterval(this.existencePollTimer)
            this.existencePollTimer = null
          }
          this.openWatcher()
          this.initializeFromExisting()
        }
      }, 2000)
    }
  }

  /**
   * Late-bind the watcher to a specific Claude session UUID. Called by
   * TerminalManager once the `~/.claude/sessions/<pid>.json` registry
   * resolves to this terminal's Claude PID. Idempotent: no-op if the
   * same UUID is already pinned.
   */
  setSessionUuid(uuid: string): void {
    if (this.pinnedUuid === uuid) return
    this.pinnedUuid = uuid
    // Drop any in-flight cursor — we're switching to a different file.
    this.currentFile = null
    this.lastOffset = 0
    this.lineBuffer = ''
    // Re-anchor to the new file's EOF so we skip any prior history and only
    // react to records written from here forward (matches initialize semantics).
    this.initializeFromExisting()
    // Then tick once in case data has already been written since the last
    // fs-watch event.
    this.tick()
  }

  /**
   * If the tile's cwd changed (OSC 7, `cd`, worktree swap, etc.), restart
   * against the new project dir. No-op if unchanged.
   */
  updateCwd(cwd: string): void {
    const next = ClaudeLogWatcher.projectDirFor(cwd)
    if (next === this.projectDir) return
    const wasStopped = this.stopped
    this.stop()
    this.projectDir = next
    this.currentFile = null
    this.lastOffset = 0
    this.lineBuffer = ''
    this.stopped = wasStopped
    if (!wasStopped) this.start()
  }

  stop(): void {
    this.stopped = true
    this.watcher?.close()
    this.watcher = null
    if (this.existencePollTimer) {
      clearInterval(this.existencePollTimer)
      this.existencePollTimer = null
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
  }

  private openWatcher(): void {
    try {
      this.watcher = watch(this.projectDir, { recursive: false }, () => {
        if (this.debounceTimer) clearTimeout(this.debounceTimer)
        this.debounceTimer = setTimeout(() => this.tick(), 200)
      })
    } catch (err) {
      this.emit('error', err)
    }
  }

  /** Pick the target JSONL at startup and skip history (set offset to EOF). */
  private initializeFromExisting(): void {
    const target = this.pickTargetJsonl()
    if (!target) return
    this.currentFile = target.path
    try {
      this.lastOffset = statSync(target.path).size
    } catch {
      this.lastOffset = 0
    }
    this.lineBuffer = ''
  }

  /**
   * Resolve which JSONL file to tail.
   * - Pinned mode: the file named `<pinnedUuid>.jsonl` (may not exist yet;
   *   returns null until it's flushed).
   * - Unpinned (v1 fallback): the most-recently-modified `.jsonl` in the dir.
   */
  private pickTargetJsonl(): { path: string; mtimeMs: number } | null {
    if (this.pinnedUuid) {
      const path = join(this.projectDir, `${this.pinnedUuid}.jsonl`)
      if (!existsSync(path)) return null
      let mtimeMs: number
      try {
        mtimeMs = statSync(path).mtimeMs
      } catch {
        return null
      }
      return { path, mtimeMs }
    }
    return this.pickLatestJsonl()
  }

  private pickLatestJsonl(): { path: string; mtimeMs: number } | null {
    let entries: ReturnType<typeof readdirSync>
    try {
      entries = readdirSync(this.projectDir, { withFileTypes: true })
    } catch {
      return null
    }

    let best: { path: string; mtimeMs: number } | null = null
    for (const entry of entries) {
      if (!entry.isFile()) continue
      if (!entry.name.endsWith('.jsonl')) continue
      const full = join(this.projectDir, entry.name)
      let mtimeMs: number
      try {
        mtimeMs = statSync(full).mtimeMs
      } catch {
        continue
      }
      if (!best || mtimeMs > best.mtimeMs) {
        best = { path: full, mtimeMs }
      }
    }
    return best
  }

  /** Debounced reader — called at most once per 200 ms per filesystem event. */
  private tick(): void {
    if (this.stopped) return

    const target = this.pickTargetJsonl()
    if (!target) return

    // A newer file appeared (new Claude session in the same project dir).
    // Start at offset 0 — these are small when fresh and we want the very
    // first assistant record.
    if (target.path !== this.currentFile) {
      this.currentFile = target.path
      this.lastOffset = 0
      this.lineBuffer = ''
    }

    let size: number
    try {
      size = statSync(this.currentFile!).size
    } catch {
      return
    }

    // File truncated or rotated — restart from the beginning.
    if (size < this.lastOffset) {
      this.lastOffset = 0
      this.lineBuffer = ''
    }
    if (size === this.lastOffset) return

    let chunk: string
    try {
      const fd = openSync(this.currentFile!, 'r')
      try {
        const buf = Buffer.alloc(size - this.lastOffset)
        readSync(fd, buf, 0, buf.length, this.lastOffset)
        chunk = buf.toString('utf8')
      } finally {
        closeSync(fd)
      }
      this.lastOffset = size
    } catch (err) {
      this.emit('error', err)
      return
    }

    const combined = this.lineBuffer + chunk
    const lines = combined.split('\n')
    this.lineBuffer = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.trim()) continue
      let record: Record<string, unknown>
      try {
        record = JSON.parse(line)
      } catch {
        // Partial write or malformed line — skip silently.
        continue
      }
      this.processRecord(record)
    }
  }

  private processRecord(record: Record<string, unknown>): void {
    if (record.type !== 'assistant') return
    if (record.isSidechain === true) return // subagent — its own cache lifetime

    const message = record.message as Record<string, unknown> | undefined
    const usage = message?.usage as Record<string, unknown> | undefined
    if (!usage) return

    const creation = (usage.cache_creation as Record<string, unknown> | undefined) ?? {}
    const ephemeral1h = Number(creation.ephemeral_1h_input_tokens ?? 0)
    const ephemeral5m = Number(creation.ephemeral_5m_input_tokens ?? 0)
    const cacheRead = Number(usage.cache_read_input_tokens ?? 0)

    // Only emit when this call actually interacted with the cache. If all
    // three are zero the prompt was too small to cache at all (happens on
    // very short prompts) and we have nothing authoritative to say.
    if (ephemeral1h === 0 && ephemeral5m === 0 && cacheRead === 0) return

    // If the writer wrote to the 1h bucket, Anthropic served a 1h cache;
    // otherwise it's the default 5m. `cache_read_input_tokens` alone doesn't
    // tell us which TTL — but in practice when it's non-zero without a
    // corresponding write, the TTL matches the most recent write which we've
    // already observed in an earlier record. Defaulting to 5m here is safe:
    // we'd only under-report on pure-read turns, which get corrected the
    // next time Claude writes to the cache.
    const ttlSeconds: 300 | 3600 = ephemeral1h > 0 ? 3600 : 300

    const timestampRaw = record.timestamp
    const parsed = typeof timestampRaw === 'string' ? Date.parse(timestampRaw) : NaN
    const timestampMs = Number.isFinite(parsed) ? parsed : Date.now()

    const sessionUuid =
      typeof record.sessionId === 'string' ? (record.sessionId as string) : ''

    const evt: ClaudeCacheEvent = {
      terminalId: this.terminalId,
      ttlSeconds,
      timestampMs,
      sessionUuid
    }
    this.emit('cache-event', evt)
  }
}
