import Database from 'better-sqlite3'
import { homedir } from 'os'
import { join } from 'path'
import { mkdirSync, existsSync } from 'fs'

const DB_DIR = join(homedir(), 'AgentCanvas')
const DB_PATH = join(DB_DIR, 'scrollback.sqlite')
const FLUSH_INTERVAL_MS = 500

export interface ScrollbackSearchArgs {
  query: string
  terminalIds?: string[]
  limit?: number
}

export interface ScrollbackSearchResult {
  terminalId: string
  lineNo: number
  snippet: string
  ts: number
}

interface LineBuffer {
  pending: string
  lineNo: number
  queue: Array<{ lineNo: number; ts: number; text: string }>
  timer: NodeJS.Timeout | null
}

interface RedactionRule {
  pattern: RegExp
  replace: string | ((match: string, ...groups: string[]) => string)
}

const REDACTION_RULES: RedactionRule[] = [
  { pattern: /\bAKIA[0-9A-Z]{16}\b/g, replace: '[REDACTED:AWS_ACCESS_KEY]' },
  { pattern: /\bghp_[A-Za-z0-9]{36}\b/g, replace: '[REDACTED:GITHUB_PAT]' },
  { pattern: /\bghs_[A-Za-z0-9]{36}\b/g, replace: '[REDACTED:GITHUB_SERVER_TOKEN]' },
  { pattern: /\bsk_(live|test)_[A-Za-z0-9]{24,}\b/g, replace: '[REDACTED:STRIPE_KEY]' },
  { pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, replace: '[REDACTED:JWT]' },
  { pattern: /\bBearer\s+[A-Za-z0-9._-]{16,}/gi, replace: '[REDACTED:BEARER]' },
  {
    pattern: /(\w*(?:SECRET|TOKEN|PASSWORD|API_KEY|PRIVATE_KEY)\w*)\s*=\s*\S+/gi,
    replace: (_match, key: string) => `${key}=[REDACTED:ENV]`
  }
]

export function redactSecrets(text: string): string {
  let out = text
  for (const rule of REDACTION_RULES) {
    out = out.replace(rule.pattern, rule.replace as never)
  }
  return out
}

export class ScrollbackIndex {
  private db: Database.Database
  private buffers = new Map<string, LineBuffer>()
  private insertStmt: Database.Statement
  private deleteStmt: Database.Statement
  private bumpMetaStmt: Database.Statement
  private deleteMetaStmt: Database.Statement

  constructor(dbPath: string = DB_PATH) {
    if (dbPath !== ':memory:' && !existsSync(DB_DIR)) {
      mkdirSync(DB_DIR, { recursive: true })
    }
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS scrollback USING fts5(
        terminal_id UNINDEXED,
        line_no UNINDEXED,
        ts UNINDEXED,
        text
      );
      CREATE TABLE IF NOT EXISTS scrollback_meta (
        terminal_id TEXT PRIMARY KEY,
        line_count INTEGER NOT NULL DEFAULT 0
      );
    `)
    this.insertStmt = this.db.prepare(
      'INSERT INTO scrollback (terminal_id, line_no, ts, text) VALUES (?, ?, ?, ?)'
    )
    this.deleteStmt = this.db.prepare('DELETE FROM scrollback WHERE terminal_id = ?')
    this.bumpMetaStmt = this.db.prepare(
      `INSERT INTO scrollback_meta (terminal_id, line_count) VALUES (?, ?)
       ON CONFLICT(terminal_id) DO UPDATE SET line_count = line_count + excluded.line_count`
    )
    this.deleteMetaStmt = this.db.prepare('DELETE FROM scrollback_meta WHERE terminal_id = ?')
  }

  appendPtyData(id: string, data: string): void {
    let buf = this.buffers.get(id)
    if (!buf) {
      buf = { pending: '', lineNo: 0, queue: [], timer: null }
      this.buffers.set(id, buf)
    }
    const combined = buf.pending + data
    const parts = combined.split('\n')
    buf.pending = parts.pop() ?? ''
    const now = Date.now()
    for (const rawLine of parts) {
      const line = rawLine.replace(/\r$/, '')
      buf.lineNo += 1
      buf.queue.push({ lineNo: buf.lineNo, ts: now, text: line })
    }
    if (buf.queue.length > 0 && !buf.timer) {
      buf.timer = setTimeout(() => this.flush(id), FLUSH_INTERVAL_MS)
    }
  }

  flush(id: string): void {
    const buf = this.buffers.get(id)
    if (!buf) return
    if (buf.timer) {
      clearTimeout(buf.timer)
      buf.timer = null
    }
    if (buf.queue.length === 0) return
    const rows = buf.queue
    buf.queue = []
    const insert = this.db.transaction((items: Array<{ lineNo: number; ts: number; text: string }>) => {
      for (const row of items) {
        const redacted = redactSecrets(row.text)
        this.insertStmt.run(id, row.lineNo, row.ts, redacted)
      }
      this.bumpMetaStmt.run(id, items.length)
    })
    insert(rows)
  }

  dropTerminal(id: string): void {
    const buf = this.buffers.get(id)
    if (buf?.timer) clearTimeout(buf.timer)
    this.buffers.delete(id)
    const tx = this.db.transaction(() => {
      this.deleteStmt.run(id)
      this.deleteMetaStmt.run(id)
    })
    tx()
  }

  searchScrollback(args: ScrollbackSearchArgs): ScrollbackSearchResult[] {
    const query = (args.query ?? '').trim()
    if (!query) return []
    const limit = Math.max(1, Math.min(args.limit ?? 20, 200))
    const terminalIds = args.terminalIds?.filter((id) => typeof id === 'string' && id.length > 0)

    let sql =
      "SELECT terminal_id AS terminalId, line_no AS lineNo, ts, snippet(scrollback, 3, '<<<', '>>>', '…', 20) AS snippet " +
      'FROM scrollback WHERE scrollback MATCH ?'
    const params: unknown[] = [query]
    if (terminalIds && terminalIds.length > 0) {
      const placeholders = terminalIds.map(() => '?').join(',')
      sql += ` AND terminal_id IN (${placeholders})`
      params.push(...terminalIds)
    }
    sql += ' ORDER BY ts DESC LIMIT ?'
    params.push(limit)

    try {
      const stmt = this.db.prepare(sql)
      return stmt.all(...params) as ScrollbackSearchResult[]
    } catch {
      return []
    }
  }

  flushAll(): void {
    for (const id of this.buffers.keys()) this.flush(id)
  }

  close(): void {
    for (const buf of this.buffers.values()) {
      if (buf.timer) clearTimeout(buf.timer)
    }
    this.buffers.clear()
    this.db.close()
  }
}

let singleton: ScrollbackIndex | null = null

export function getScrollbackIndex(): ScrollbackIndex {
  if (!singleton) singleton = new ScrollbackIndex()
  return singleton
}
