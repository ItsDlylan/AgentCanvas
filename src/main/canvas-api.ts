import { createServer, IncomingMessage, ServerResponse } from 'http'
import type { Server } from 'http'
import type { AddressInfo } from 'net'
import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import { markdownToTiptap } from './markdown-to-tiptap'

/**
 * Local HTTP API that anything inside a terminal can call to control AgentCanvas.
 *
 * Endpoints:
 *   POST /api/browser/open      { url, terminalId? }  → spawn a browser tile
 *   POST /api/browser/close     { sessionId }          → close a browser tile
 *   POST /api/terminal/spawn    { label?, cwd?, command?, linkedTerminalId?, width?, height?, metadata? } → spawn a terminal tile
 *   POST /api/terminal/write    { terminalId, data }   → write data to a terminal
 *   POST /api/terminal/keep-alive { terminalId }       → send Claude keep-alive to refresh prompt cache
 *   POST /api/tile/rename       { sessionId, label }   → rename any tile
 *   POST /api/notify            { body, title?, level?, priority?, terminalId?, duration?, sound? } → toast notification
 *   POST /api/note/open         { label?, content?, linkedTerminalId?, position?, width?, height? } → spawn a note tile
 *   POST /api/note/update       { noteId, content }    → update note content
 *   POST /api/note/read         { noteId }             → read note metadata + content
 *   POST /api/note/close        { noteId }             → soft-delete a note tile
 *   POST /api/note/delete       { noteId }             → hard-delete a note tile
 *   GET  /api/notes                                     → list all notes
 *   POST /api/plan/open         { label?, content?, linkedTerminalId?, ... } → create a plan tile
 *   POST /api/plan/read         { planId }             → read plan doc
 *   POST /api/plan/update       { planId, patch }      → append a new plan version
 *   POST /api/plan/verify       { planId, model? }     → spawn verifier team agent
 *   POST /api/plan/verify/complete { planId, verdict, critiqueMarkdown }  → (internal) verifier stop-hook callback
 *   POST /api/plan/approve      { planId }             → lock approved version
 *   POST /api/plan/unapprove    { planId }             → unlock
 *   POST /api/plan/execute      { planId, cwd? }       → spawn executor terminal
 *   POST /api/plan/step/complete { planId, stepId, notes? } → (called by executor agent)
 *   POST /api/plan/step/in-progress { planId, stepId } → (called by executor agent)
 *   POST /api/plan/deviation    { planId, stepId, reason, proposed_change } → (called by executor agent)
 *   POST /api/plan/resume       { planId }             → re-spawn executor with progress in prompt
 *   POST /api/plan/archive      { planId }             → terminal state
 *   POST /api/plan/delete       { planId }             → hard-delete
 *   POST /api/plan/link-pr      { planId, pr }         → attach PR ref for merge detection
 *   POST /api/plan/mark-done    { planId }             → manual completion
 *   GET  /api/plans                                    → list all plans
 *   GET  /api/status                                   → list all tiles
 *
 * Injected into every terminal as AGENT_CANVAS_API=http://127.0.0.1:<port>
 */
export class CanvasApi extends EventEmitter {
  private server: Server | null = null
  private _port = 0

  get port(): number {
    return this._port
  }

  async start(): Promise<number> {
    if (this.server) return this._port

    this.server = createServer((req, res) => {
      // CORS — allow any local caller
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
      res.setHeader('Content-Type', 'application/json')

      if (req.method === 'OPTIONS') {
        res.writeHead(204)
        res.end()
        return
      }

      this.route(req, res)
    })

    return new Promise((resolve, reject) => {
      this.server!.listen(0, '127.0.0.1', () => {
        this._port = (this.server!.address() as AddressInfo).port
        console.log(`[CanvasAPI] Listening on http://127.0.0.1:${this._port}`)
        resolve(this._port)
      })
      this.server!.on('error', reject)
    })
  }

  private route(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url || ''

    if (req.method === 'GET' && url === '/api/status') {
      this.emit('status-request', (data: unknown) => {
        res.writeHead(200)
        res.end(JSON.stringify(data))
      })
      return
    }

    if (req.method === 'POST' && url === '/api/browser/open') {
      this.readBody(req).then((body) => {
        const { url: targetUrl, terminalId, width, height } = body as { url?: string; terminalId?: string; width?: number; height?: number }
        if (!targetUrl) {
          res.writeHead(400)
          res.end(JSON.stringify({ error: 'url is required' }))
          return
        }
        this.emit('browser-open', { url: targetUrl, terminalId, width, height }, (result: unknown) => {
          res.writeHead(200)
          res.end(JSON.stringify(result))
        })
      }).catch(() => {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'Invalid JSON body' }))
      })
      return
    }

    if (req.method === 'POST' && url === '/api/browser/navigate') {
      this.readBody(req).then((body) => {
        const { sessionId, url: targetUrl } = body as { sessionId?: string; url?: string }
        if (!sessionId || !targetUrl) {
          res.writeHead(400)
          res.end(JSON.stringify({ error: 'sessionId and url are required' }))
          return
        }
        this.emit('browser-navigate', { sessionId, url: targetUrl }, (result: unknown) => {
          res.writeHead(200)
          res.end(JSON.stringify(result))
        })
      }).catch(() => {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'Invalid JSON body' }))
      })
      return
    }

    if (req.method === 'POST' && url === '/api/browser/resize') {
      this.readBody(req).then((body) => {
        const { sessionId, width, height } = body as { sessionId?: string; width?: number; height?: number }
        if (!sessionId || !width || !height) {
          res.writeHead(400)
          res.end(JSON.stringify({ error: 'sessionId, width, and height are required' }))
          return
        }
        this.emit('browser-resize', { sessionId, width, height }, (result: unknown) => {
          res.writeHead(200)
          res.end(JSON.stringify(result))
        })
      }).catch(() => {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'Invalid JSON body' }))
      })
      return
    }

    if (req.method === 'POST' && url === '/api/browser/close') {
      this.readBody(req).then((body) => {
        const { sessionId } = body as { sessionId?: string }
        if (!sessionId) {
          res.writeHead(400)
          res.end(JSON.stringify({ error: 'sessionId is required' }))
          return
        }
        this.emit('browser-close', { sessionId }, (result: unknown) => {
          res.writeHead(200)
          res.end(JSON.stringify(result))
        })
      }).catch(() => {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'Invalid JSON body' }))
      })
      return
    }

    if (req.method === 'POST' && url === '/api/terminal/metadata') {
      this.readBody(req).then((body) => {
        const { terminalId, key, value } = body as { terminalId?: string; key?: string; value?: unknown }
        if (!terminalId || !key) {
          res.writeHead(400)
          res.end(JSON.stringify({ error: 'terminalId and key are required' }))
          return
        }
        this.emit('terminal-metadata', { terminalId, key, value }, (result: unknown) => {
          res.writeHead(200)
          res.end(JSON.stringify(result))
        })
      }).catch(() => {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'Invalid JSON body' }))
      })
      return
    }

    if (req.method === 'POST' && url === '/api/tile/rename') {
      this.readBody(req).then((body) => {
        const { sessionId, label } = body as { sessionId?: string; label?: string }
        if (!sessionId || !label) {
          res.writeHead(400)
          res.end(JSON.stringify({ error: 'sessionId and label are required' }))
          return
        }
        this.emit('tile-rename', { sessionId, label }, (result: unknown) => {
          res.writeHead(200)
          res.end(JSON.stringify(result))
        })
      }).catch(() => {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'Invalid JSON body' }))
      })
      return
    }

    if (req.method === 'POST' && url === '/api/draw/open') {
      this.readBody(req).then((body) => {
        const { terminalId, label } = body as { terminalId?: string; label?: string }
        this.emit('draw-open', { terminalId, label }, (result: unknown) => {
          res.writeHead(200)
          res.end(JSON.stringify(result))
        })
      }).catch(() => {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'Invalid JSON body' }))
      })
      return
    }

    if (req.method === 'POST' && url === '/api/draw/update') {
      this.readBody(req).then((body) => {
        const { sessionId, mermaid, elements, mode } = body as { sessionId?: string; mermaid?: string; elements?: unknown[]; mode?: string }
        if (!sessionId) {
          res.writeHead(400)
          res.end(JSON.stringify({ error: 'sessionId is required' }))
          return
        }
        this.emit('draw-update', { sessionId, mermaid, elements, mode }, (result: unknown) => {
          res.writeHead(200)
          res.end(JSON.stringify(result))
        })
      }).catch(() => {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'Invalid JSON body' }))
      })
      return
    }

    if (req.method === 'POST' && url === '/api/draw/close') {
      this.readBody(req).then((body) => {
        const { sessionId } = body as { sessionId?: string }
        if (!sessionId) {
          res.writeHead(400)
          res.end(JSON.stringify({ error: 'sessionId is required' }))
          return
        }
        this.emit('draw-close', { sessionId }, (result: unknown) => {
          res.writeHead(200)
          res.end(JSON.stringify(result))
        })
      }).catch(() => {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'Invalid JSON body' }))
      })
      return
    }

    if (req.method === 'POST' && url === '/api/terminal/spawn') {
      this.readBody(req).then((body) => {
        const { label, cwd, command, linkedTerminalId, width, height, metadata } = body as {
          label?: string; cwd?: string; command?: string; linkedTerminalId?: string;
          width?: number; height?: number; metadata?: Record<string, unknown>
        }
        this.emit('terminal-spawn', { label, cwd, command, linkedTerminalId, width, height, metadata }, (result: unknown) => {
          res.writeHead(200)
          res.end(JSON.stringify(result))
        })
      }).catch(() => {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'Invalid JSON body' }))
      })
      return
    }

    if (req.method === 'POST' && url === '/api/template/spawn') {
      this.readBody(req).then((body) => {
        const { templateId, templateName, origin } = body as {
          templateId?: string; templateName?: string;
          origin?: { x: number; y: number }
        }
        if (!templateId && !templateName) {
          res.writeHead(400)
          res.end(JSON.stringify({ error: 'templateId or templateName is required' }))
          return
        }
        this.emit('template-spawn', { templateId, templateName, origin }, (result: unknown) => {
          res.writeHead(200)
          res.end(JSON.stringify(result))
        })
      }).catch(() => {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'Invalid JSON body' }))
      })
      return
    }

    if (req.method === 'POST' && url === '/api/terminal/write') {
      this.readBody(req).then((body) => {
        const { terminalId, data } = body as { terminalId?: string; data?: string }
        if (!terminalId || !data) {
          res.writeHead(400)
          res.end(JSON.stringify({ error: 'terminalId and data are required' }))
          return
        }
        this.emit('terminal-write', { terminalId, data }, (result: unknown) => {
          res.writeHead(200)
          res.end(JSON.stringify(result))
        })
      }).catch(() => {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'Invalid JSON body' }))
      })
      return
    }

    if (req.method === 'POST' && url === '/api/notify') {
      this.readBody(req).then((body) => {
        const { title, body: message, level: rawLevel, priority: rawPriority, terminalId, duration: rawDuration, sound: rawSound } = body as {
          title?: string; body?: string; level?: string; priority?: string;
          terminalId?: string; duration?: number; sound?: boolean
        }
        if (!message) {
          res.writeHead(400)
          res.end(JSON.stringify({ error: 'body is required' }))
          return
        }
        const level = (['info', 'success', 'warning', 'error'].includes(rawLevel || '') ? rawLevel : 'info') as string
        const priority = (['low', 'normal', 'high', 'critical'].includes(rawPriority || '') ? rawPriority : 'normal') as string
        const defaultDuration = level === 'error' ? 0 : level === 'warning' ? 7000 : level === 'success' ? 4000 : 5000
        const defaultSound = level === 'success' || level === 'error'
        const id = `notify-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
        this.emit('notify', {
          id,
          title,
          body: message,
          level,
          priority,
          terminalId,
          duration: rawDuration ?? defaultDuration,
          sound: rawSound ?? defaultSound,
          timestamp: Date.now()
        }, (result: unknown) => {
          res.writeHead(200)
          res.end(JSON.stringify(result))
        })
      }).catch(() => {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'Invalid JSON body' }))
      })
      return
    }

    if (req.method === 'POST' && url === '/api/terminal/keep-alive') {
      this.readBody(req).then((body) => {
        const { terminalId } = body as { terminalId?: string }
        if (!terminalId) {
          res.writeHead(400)
          res.end(JSON.stringify({ error: 'terminalId is required' }))
          return
        }
        this.emit('terminal-keep-alive', { terminalId }, (result: unknown) => {
          res.writeHead(200)
          res.end(JSON.stringify(result))
        })
      }).catch(() => {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'Invalid JSON body' }))
      })
      return
    }

    // ── Note endpoints ──

    if (req.method === 'POST' && url === '/api/note/open') {
      this.readBody(req).then((body) => {
        const { label, content, linkedTerminalId, linkedNoteId, position, width, height } = body as {
          label?: string; content?: string | Record<string, unknown>;
          linkedTerminalId?: string; linkedNoteId?: string;
          position?: { x: number; y: number }; width?: number; height?: number
        }
        const noteId = randomUUID()
        let tiptapContent: Record<string, unknown> | undefined
        try {
          tiptapContent = typeof content === 'string' ? markdownToTiptap(content) : content
        } catch {
          res.writeHead(400)
          res.end(JSON.stringify({ error: 'Invalid markdown' }))
          return
        }
        this.emit('note-open', { noteId, label, content: tiptapContent, linkedTerminalId, linkedNoteId, position, width, height }, (result: unknown) => {
          res.writeHead(200)
          res.end(JSON.stringify(result))
        })
      }).catch(() => {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'Invalid JSON body' }))
      })
      return
    }

    if (req.method === 'POST' && url === '/api/note/update') {
      this.readBody(req).then((body) => {
        const { noteId, content } = body as { noteId?: string; content?: string | Record<string, unknown> }
        if (!noteId || content === undefined) {
          res.writeHead(400)
          res.end(JSON.stringify({ error: 'noteId and content are required' }))
          return
        }
        let tiptapContent: Record<string, unknown> | undefined
        try {
          tiptapContent = typeof content === 'string' ? markdownToTiptap(content) : content
        } catch {
          res.writeHead(400)
          res.end(JSON.stringify({ error: 'Invalid markdown' }))
          return
        }
        this.emit('note-update', { noteId, content: tiptapContent }, (result: unknown) => {
          res.writeHead(200)
          res.end(JSON.stringify(result))
        })
      }).catch(() => {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'Invalid JSON body' }))
      })
      return
    }

    if (req.method === 'POST' && url === '/api/note/read') {
      this.readBody(req).then((body) => {
        const { noteId } = body as { noteId?: string }
        if (!noteId) {
          res.writeHead(400)
          res.end(JSON.stringify({ error: 'noteId is required' }))
          return
        }
        this.emit('note-read', { noteId }, (result: unknown) => {
          const r = result as { ok: boolean }
          res.writeHead(r.ok ? 200 : 404)
          res.end(JSON.stringify(result))
        })
      }).catch(() => {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'Invalid JSON body' }))
      })
      return
    }

    if (req.method === 'POST' && url === '/api/note/close') {
      this.readBody(req).then((body) => {
        const { noteId } = body as { noteId?: string }
        if (!noteId) {
          res.writeHead(400)
          res.end(JSON.stringify({ error: 'noteId is required' }))
          return
        }
        this.emit('note-close', { noteId }, (result: unknown) => {
          res.writeHead(200)
          res.end(JSON.stringify(result))
        })
      }).catch(() => {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'Invalid JSON body' }))
      })
      return
    }

    if (req.method === 'POST' && url === '/api/note/delete') {
      this.readBody(req).then((body) => {
        const { noteId } = body as { noteId?: string }
        if (!noteId) {
          res.writeHead(400)
          res.end(JSON.stringify({ error: 'noteId is required' }))
          return
        }
        this.emit('note-delete', { noteId }, (result: unknown) => {
          res.writeHead(200)
          res.end(JSON.stringify(result))
        })
      }).catch(() => {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'Invalid JSON body' }))
      })
      return
    }

    if (req.method === 'GET' && url === '/api/notes') {
      this.emit('notes-list', (data: unknown) => {
        res.writeHead(200)
        res.end(JSON.stringify(data))
      })
      return
    }

    // ── Plan endpoints ──

    if (req.method === 'POST' && url === '/api/plan/open') {
      this.readBody(req).then((body) => {
        const { label, content, linkedTerminalId, position, width, height, workspaceId, author } = body as {
          label?: string; content?: string | Record<string, unknown>;
          linkedTerminalId?: string; position?: { x: number; y: number };
          width?: number; height?: number; workspaceId?: string;
          author?: 'human' | 'capture-hook' | 'revision'
        }
        this.emit('plan-open', { label, content, linkedTerminalId, position, width, height, workspaceId, author }, (result: unknown) => {
          res.writeHead(200)
          res.end(JSON.stringify(result))
        })
      }).catch(() => {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'Invalid JSON body' }))
      })
      return
    }

    if (req.method === 'POST' && url === '/api/plan/read') {
      this.readBody(req).then((body) => {
        const { planId } = body as { planId?: string }
        if (!planId) {
          res.writeHead(400)
          res.end(JSON.stringify({ error: 'planId is required' }))
          return
        }
        this.emit('plan-read', { planId }, (result: unknown) => {
          const r = result as { ok: boolean }
          res.writeHead(r.ok ? 200 : 404)
          res.end(JSON.stringify(result))
        })
      }).catch(() => {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'Invalid JSON body' }))
      })
      return
    }

    if (req.method === 'POST' && url === '/api/plan/update') {
      this.readBody(req).then((body) => {
        const { planId, patch, author } = body as {
          planId?: string;
          patch?: Record<string, unknown>;
          author?: 'human' | 'capture-hook' | 'revision'
        }
        if (!planId || !patch) {
          res.writeHead(400)
          res.end(JSON.stringify({ error: 'planId and patch are required' }))
          return
        }
        this.emit('plan-update', { planId, patch, author }, (result: unknown) => {
          res.writeHead(200)
          res.end(JSON.stringify(result))
        })
      }).catch(() => {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'Invalid JSON body' }))
      })
      return
    }

    if (req.method === 'POST' && url === '/api/plan/verify') {
      this.readBody(req).then((body) => {
        const { planId, model } = body as { planId?: string; model?: 'sonnet' | 'opus' }
        if (!planId) {
          res.writeHead(400)
          res.end(JSON.stringify({ error: 'planId is required' }))
          return
        }
        this.emit('plan-verify', { planId, model }, (result: unknown) => {
          res.writeHead(200)
          res.end(JSON.stringify(result))
        })
      }).catch(() => {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'Invalid JSON body' }))
      })
      return
    }

    // Internal endpoint called by the verifier stop hook.
    if (req.method === 'POST' && url === '/api/plan/verify/complete') {
      this.readBody(req).then((body) => {
        const { planId, verdict, critiqueMarkdown } = body as {
          planId?: string;
          verdict?: { severity: 'none' | 'minor' | 'major'; summary: string; findings: Array<{ severity: 'minor' | 'major'; text: string }> };
          critiqueMarkdown?: string
        }
        if (!planId || !verdict) {
          res.writeHead(400)
          res.end(JSON.stringify({ error: 'planId and verdict are required' }))
          return
        }
        this.emit('plan-verify-complete', { planId, verdict, critiqueMarkdown }, (result: unknown) => {
          res.writeHead(200)
          res.end(JSON.stringify(result))
        })
      }).catch(() => {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'Invalid JSON body' }))
      })
      return
    }

    if (req.method === 'POST' && url === '/api/plan/approve') {
      this.readBody(req).then((body) => {
        const { planId } = body as { planId?: string }
        if (!planId) {
          res.writeHead(400)
          res.end(JSON.stringify({ error: 'planId is required' }))
          return
        }
        this.emit('plan-approve', { planId }, (result: unknown) => {
          const r = result as { ok: boolean }
          res.writeHead(r.ok ? 200 : 409)
          res.end(JSON.stringify(result))
        })
      }).catch(() => {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'Invalid JSON body' }))
      })
      return
    }

    if (req.method === 'POST' && url === '/api/plan/unapprove') {
      this.readBody(req).then((body) => {
        const { planId } = body as { planId?: string }
        if (!planId) {
          res.writeHead(400)
          res.end(JSON.stringify({ error: 'planId is required' }))
          return
        }
        this.emit('plan-unapprove', { planId }, (result: unknown) => {
          res.writeHead(200)
          res.end(JSON.stringify(result))
        })
      }).catch(() => {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'Invalid JSON body' }))
      })
      return
    }

    if (req.method === 'POST' && url === '/api/plan/execute') {
      this.readBody(req).then((body) => {
        const { planId, cwd } = body as { planId?: string; cwd?: string }
        if (!planId) {
          res.writeHead(400)
          res.end(JSON.stringify({ error: 'planId is required' }))
          return
        }
        this.emit('plan-execute', { planId, cwd }, (result: unknown) => {
          const r = result as { ok: boolean }
          res.writeHead(r.ok ? 200 : 409)
          res.end(JSON.stringify(result))
        })
      }).catch(() => {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'Invalid JSON body' }))
      })
      return
    }

    if (req.method === 'POST' && url === '/api/plan/step/complete') {
      this.readBody(req).then((body) => {
        const { planId, stepId, notes } = body as {
          planId?: string; stepId?: string; notes?: string
        }
        if (!planId || !stepId) {
          res.writeHead(400)
          res.end(JSON.stringify({ error: 'planId and stepId are required' }))
          return
        }
        this.emit('plan-step-complete', { planId, stepId, notes }, (result: unknown) => {
          res.writeHead(200)
          res.end(JSON.stringify(result))
        })
      }).catch(() => {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'Invalid JSON body' }))
      })
      return
    }

    if (req.method === 'POST' && url === '/api/plan/step/in-progress') {
      this.readBody(req).then((body) => {
        const { planId, stepId } = body as { planId?: string; stepId?: string }
        if (!planId || !stepId) {
          res.writeHead(400)
          res.end(JSON.stringify({ error: 'planId and stepId are required' }))
          return
        }
        this.emit('plan-step-in-progress', { planId, stepId }, (result: unknown) => {
          res.writeHead(200)
          res.end(JSON.stringify(result))
        })
      }).catch(() => {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'Invalid JSON body' }))
      })
      return
    }

    if (req.method === 'POST' && url === '/api/plan/deviation') {
      this.readBody(req).then((body) => {
        const { planId, stepId, reason, proposed_change } = body as {
          planId?: string; stepId?: string; reason?: string; proposed_change?: string
        }
        if (!planId || !stepId || !reason || !proposed_change) {
          res.writeHead(400)
          res.end(JSON.stringify({ error: 'planId, stepId, reason, and proposed_change are required' }))
          return
        }
        this.emit('plan-deviation', { planId, stepId, reason, proposed_change }, (result: unknown) => {
          res.writeHead(200)
          res.end(JSON.stringify(result))
        })
      }).catch(() => {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'Invalid JSON body' }))
      })
      return
    }

    if (req.method === 'POST' && url === '/api/plan/resume') {
      this.readBody(req).then((body) => {
        const { planId } = body as { planId?: string }
        if (!planId) {
          res.writeHead(400)
          res.end(JSON.stringify({ error: 'planId is required' }))
          return
        }
        this.emit('plan-resume', { planId }, (result: unknown) => {
          res.writeHead(200)
          res.end(JSON.stringify(result))
        })
      }).catch(() => {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'Invalid JSON body' }))
      })
      return
    }

    if (req.method === 'POST' && url === '/api/plan/archive') {
      this.readBody(req).then((body) => {
        const { planId } = body as { planId?: string }
        if (!planId) {
          res.writeHead(400)
          res.end(JSON.stringify({ error: 'planId is required' }))
          return
        }
        this.emit('plan-archive', { planId }, (result: unknown) => {
          res.writeHead(200)
          res.end(JSON.stringify(result))
        })
      }).catch(() => {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'Invalid JSON body' }))
      })
      return
    }

    if (req.method === 'POST' && url === '/api/plan/delete') {
      this.readBody(req).then((body) => {
        const { planId } = body as { planId?: string }
        if (!planId) {
          res.writeHead(400)
          res.end(JSON.stringify({ error: 'planId is required' }))
          return
        }
        this.emit('plan-delete', { planId }, (result: unknown) => {
          res.writeHead(200)
          res.end(JSON.stringify(result))
        })
      }).catch(() => {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'Invalid JSON body' }))
      })
      return
    }

    if (req.method === 'POST' && url === '/api/plan/link-pr') {
      this.readBody(req).then((body) => {
        const { planId, pr } = body as { planId?: string; pr?: string }
        if (!planId || !pr) {
          res.writeHead(400)
          res.end(JSON.stringify({ error: 'planId and pr are required' }))
          return
        }
        this.emit('plan-link-pr', { planId, pr }, (result: unknown) => {
          res.writeHead(200)
          res.end(JSON.stringify(result))
        })
      }).catch(() => {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'Invalid JSON body' }))
      })
      return
    }

    if (req.method === 'POST' && url === '/api/plan/mark-done') {
      this.readBody(req).then((body) => {
        const { planId } = body as { planId?: string }
        if (!planId) {
          res.writeHead(400)
          res.end(JSON.stringify({ error: 'planId is required' }))
          return
        }
        this.emit('plan-mark-done', { planId }, (result: unknown) => {
          res.writeHead(200)
          res.end(JSON.stringify(result))
        })
      }).catch(() => {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'Invalid JSON body' }))
      })
      return
    }

    if (req.method === 'GET' && url === '/api/plans') {
      this.emit('plans-list', (data: unknown) => {
        res.writeHead(200)
        res.end(JSON.stringify(data))
      })
      return
    }

    res.writeHead(404)
    res.end(JSON.stringify({ error: 'Not found' }))
  }

  private readBody(req: IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString()))
        } catch (e) {
          reject(e)
        }
      })
      req.on('error', reject)
    })
  }

  stop(): void {
    if (this.server) {
      this.server.close()
      this.server = null
      this._port = 0
    }
  }
}
