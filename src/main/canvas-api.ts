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
 *   GET  /api/status                                    → list all tiles
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
        const tiptapContent = typeof content === 'string' ? markdownToTiptap(content) : content
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
        const tiptapContent = typeof content === 'string' ? markdownToTiptap(content) : content
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
