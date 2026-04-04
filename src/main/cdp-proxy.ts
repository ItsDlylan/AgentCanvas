import { webContents as webContentsModule } from 'electron'
import { createServer as createHttpServer, IncomingMessage, ServerResponse } from 'http'
import type { Server as HttpServer } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import { EventEmitter } from 'events'
import type { AddressInfo } from 'net'

interface PendingCommand {
  ws: WebSocket
  id: number
  method: string
  params: unknown
}

export interface CdpProxySession {
  sessionId: string
  webContentsId: number | null
  port: number
  wsServer: WebSocketServer
  httpServer: HttpServer
  clients: Set<WebSocket>
  debuggerReady: boolean
  pendingCommands: PendingCommand[]
}

/**
 * Two-phase CDP proxy:
 *   1. reserve(sessionId, port) — starts HTTP+WS server immediately, holds the port.
 *      agent-browser can connect right away; commands are queued until the debugger is wired.
 *   2. wireDebugger(sessionId, webContentsId) — attaches the debugger, flushes queued commands.
 *
 * This eliminates the race between "browser tile spawning" and "agent-browser connecting".
 */
export class CdpProxy extends EventEmitter {
  private sessions = new Map<string, CdpProxySession>()

  /**
   * Phase 1: Start HTTP + WS server on the given port.
   * Returns immediately. CDP commands are queued until wireDebugger() is called.
   */
  async reserve(sessionId: string, port: number): Promise<number> {
    if (this.sessions.has(sessionId)) {
      return this.sessions.get(sessionId)!.port
    }

    const clients = new Set<WebSocket>()
    const pendingCommands: PendingCommand[] = []
    let session: CdpProxySession

    const httpServer = createHttpServer((req: IncomingMessage, res: ServerResponse) => {
      res.setHeader('Content-Type', 'application/json')
      const wsUrl = `ws://127.0.0.1:${session.port}/devtools/page/${sessionId}`

      if (req.url === '/json/version') {
        res.end(JSON.stringify({
          Browser: 'AgentCanvas/1.0',
          'Protocol-Version': '1.3',
          webSocketDebuggerUrl: wsUrl
        }))
      } else if (req.url === '/json/list' || req.url === '/json') {
        let title = 'AgentCanvas Browser'
        let url = ''
        if (session.webContentsId) {
          try {
            const wc = webContentsModule.fromId(session.webContentsId)
            if (wc) { title = wc.getTitle(); url = wc.getURL() }
          } catch { /* ignore */ }
        }
        res.end(JSON.stringify([{
          description: '',
          devtoolsFrontendUrl: '',
          id: sessionId,
          title,
          type: 'page',
          url,
          webSocketDebuggerUrl: wsUrl
        }]))
      } else {
        res.statusCode = 404
        res.end('{}')
      }
    })

    const wsServer = new WebSocketServer({
      server: httpServer,
      path: new RegExp(`/devtools/page/.+`)
    })

    wsServer.on('connection', (ws: WebSocket) => {
      clients.add(ws)

      ws.on('message', async (raw: Buffer | string) => {
        try {
          const msg = JSON.parse(raw.toString())
          const { id, method, params } = msg

          if (!session.debuggerReady) {
            // Queue until debugger is attached
            pendingCommands.push({ ws, id, method, params })
            return
          }

          await this.executeCommand(session, ws, id, method, params)
        } catch { /* malformed */ }
      })

      ws.on('close', () => clients.delete(ws))
    })

    const actualPort = await new Promise<number>((resolve, reject) => {
      httpServer.listen(port, '127.0.0.1', () => {
        resolve((httpServer.address() as AddressInfo).port)
      })
      httpServer.on('error', reject)
    })

    session = {
      sessionId,
      webContentsId: null,
      port: actualPort,
      wsServer,
      httpServer,
      clients,
      debuggerReady: false,
      pendingCommands
    }
    this.sessions.set(sessionId, session)

    console.log(`[CDP] Server reserved for ${sessionId} on port ${actualPort}`)
    this.emit('reserved', { sessionId, port: actualPort })
    return actualPort
  }

  /**
   * Phase 2: Attach the Chrome DevTools debugger to a webview's webContents.
   * Flushes any commands queued during Phase 1.
   */
  async wireDebugger(sessionId: string, webContentsId: number): Promise<number> {
    let session = this.sessions.get(sessionId)

    // If no server was reserved yet, start one on a random port
    if (!session) {
      const port = await this.reserve(sessionId, 0)
      session = this.sessions.get(sessionId)!
    }

    if (session.debuggerReady) return session.port

    const wc = webContentsModule.fromId(webContentsId)
    if (!wc) throw new Error(`webContents ${webContentsId} not found`)

    try {
      wc.debugger.attach('1.3')
    } catch (err) {
      if (!(err as Error).message?.includes('Already attached')) throw err
    }

    session.webContentsId = webContentsId
    session.debuggerReady = true

    // Forward CDP events to all connected clients
    wc.debugger.on('message', (_event: Electron.Event, method: string, params: unknown) => {
      const payload = JSON.stringify({ method, params })
      for (const client of session!.clients) {
        if (client.readyState === WebSocket.OPEN) client.send(payload)
      }
    })

    wc.debugger.on('detach', (_event: Electron.Event, reason: string) => {
      console.warn(`[CDP] Debugger detached for ${sessionId}: ${reason}`)
      if (session) session.debuggerReady = false
    })

    // Flush queued commands
    const pending = [...session.pendingCommands]
    session.pendingCommands.length = 0
    for (const cmd of pending) {
      await this.executeCommand(session, cmd.ws, cmd.id, cmd.method, cmd.params)
    }

    console.log(`[CDP] Debugger wired for ${sessionId} on port ${session.port}`)
    this.emit('attached', { sessionId, port: session.port })
    return session.port
  }

  private async executeCommand(
    session: CdpProxySession,
    ws: WebSocket,
    id: number,
    method: string,
    params: unknown
  ): Promise<void> {
    if (!session.webContentsId) return
    const wc = webContentsModule.fromId(session.webContentsId)
    if (!wc) return

    try {
      const result = await wc.debugger.sendCommand(method, (params || {}) as Record<string, unknown>)
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ id, result: result || {} }))
      }
    } catch (err) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ id, error: { message: (err as Error).message || 'Command failed' } }))
      }
    }
  }

  detach(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return

    for (const client of session.clients) {
      try { client.close() } catch { /* ignore */ }
    }
    session.clients.clear()

    try { session.wsServer.close() } catch { /* ignore */ }
    try { session.httpServer.close() } catch { /* ignore */ }

    if (session.webContentsId) {
      try {
        const wc = webContentsModule.fromId(session.webContentsId)
        if (wc?.debugger.isAttached()) wc.debugger.detach()
      } catch { /* ignore */ }
    }

    this.sessions.delete(sessionId)
    console.log(`[CDP] Proxy detached for ${sessionId}`)
    this.emit('detached', { sessionId })
  }

  getPort(sessionId: string): number | undefined {
    return this.sessions.get(sessionId)?.port
  }

  destroyAll(): void {
    for (const id of [...this.sessions.keys()]) {
      this.detach(id)
    }
  }
}
