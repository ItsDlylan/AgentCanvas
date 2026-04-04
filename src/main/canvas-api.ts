import { createServer, IncomingMessage, ServerResponse } from 'http'
import type { Server } from 'http'
import type { AddressInfo } from 'net'
import { EventEmitter } from 'events'

/**
 * Local HTTP API that anything inside a terminal can call to control AgentCanvas.
 *
 * Endpoints:
 *   POST /api/browser/open   { url, terminalId? }  → spawn a browser tile
 *   POST /api/browser/close  { sessionId }          → close a browser tile
 *   GET  /api/status                                 → list all tiles
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
