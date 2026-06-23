import http from 'node:http'
import { randomUUID } from 'node:crypto'
import type { ApprovalRequest, MissionSubmitRequest, StreamEvent } from '../src/shared/contracts'
import type { DinoRuntime } from './runtime'

export interface GatewayConfig {
  port: number
  host: string
  requirePairing: boolean
}

const DEFAULT_CONFIG: GatewayConfig = {
  port: 42617,
  host: '0.0.0.0',
  requirePairing: true,
}

const API_VERSION = '0.4.0'

export class Gateway {
  private server: http.Server | null = null
  private pairingCode: string = ''
  private bearerToken: string = ''
  private config: GatewayConfig
  private processedKeys = new Set<string>()
  private runtime: DinoRuntime
  private sseClients = new Set<http.ServerResponse>()
  private onPaired: ((token: string) => void) | null = null

  constructor(runtime: DinoRuntime, config?: Partial<GatewayConfig>) {
    this.runtime = runtime
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.runtime.subscribeStreamEvent(event => this.broadcastSse('stream', event))
    this.runtime.subscribeApprovalRequest(request => this.broadcastSse('approval', request))
  }

  setOnPaired(callback: (token: string) => void): void {
    this.onPaired = callback
  }

  restoreBearerToken(token: string): void {
    if (token) {
      this.bearerToken = token
      this.pairingCode = ''
    }
  }

  getPairingCode(): string {
    return this.pairingCode
  }

  start(port?: number, options?: { preserveToken?: boolean }): Promise<{ port: number; pairingCode: string }> {
    if (typeof port === 'number' && Number.isFinite(port) && port > 0) {
      this.config.port = Math.trunc(port)
    }
    if (!options?.preserveToken || !this.bearerToken) {
      this.bearerToken = ''
    }
    if (!this.bearerToken) {
      this.pairingCode = String(Math.floor(100000 + Math.random() * 900000))
    } else {
      this.pairingCode = ''
    }

    if (this.isRunning()) {
      return Promise.resolve({ port: this.config.port, pairingCode: this.pairingCode })
    }

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        void this.handleRequest(req, res)
      })

      this.server.listen(this.config.port, this.config.host, () => {
        resolve({ port: this.config.port, pairingCode: this.pairingCode })
      })

      this.server.on('error', reject)
    })
  }

  stop(): void {
    for (const client of this.sseClients) {
      client.end()
    }
    this.sseClients.clear()
    this.server?.close()
    this.server = null
  }

  isRunning(): boolean {
    return this.server !== null && this.server.listening
  }

  getInfo(): { running: boolean; port: number; host: string; paired: boolean } {
    return {
      running: this.isRunning(),
      port: this.config.port,
      host: this.config.host,
      paired: this.bearerToken !== '',
    }
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
    const pathname = url.pathname

    this.setCors(res)
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    res.setHeader('Content-Type', 'application/json')

    if (pathname === '/health' && req.method === 'GET') {
      this.json(res, 200, { status: 'ok', version: API_VERSION, link: 'dino-link' })
      return
    }

    if (pathname === '/pair' && req.method === 'POST') {
      const code = req.headers['x-pairing-code'] as string | undefined
      if (!code || code !== this.pairingCode) {
        this.json(res, 401, { error: 'Invalid pairing code' })
        return
      }
      this.bearerToken = randomUUID()
      this.pairingCode = ''
      this.onPaired?.(this.bearerToken)
      this.json(res, 200, { token: this.bearerToken })
      return
    }

    if (pathname === '/events' && req.method === 'GET') {
      if (this.config.requirePairing && !this.checkAuth(req, url)) {
        this.json(res, 401, { error: 'Unauthorized' })
        return
      }
      this.handleSse(req, res)
      return
    }

    if (pathname === '/webhook' && req.method === 'POST') {
      if (this.config.requirePairing && !this.checkAuth(req, url)) {
        this.json(res, 401, { error: 'Unauthorized' })
        return
      }

      const body = await readBody(req)
      try {
        const data = JSON.parse(body) as { message?: string; idempotencyKey?: string }
        if (!data.message) {
          this.json(res, 400, { error: 'Missing message field' })
          return
        }

        if (this.checkIdempotency(data.idempotencyKey, res)) return

        const result = await this.runtime.runGoal({ goal: data.message })
        this.json(res, 200, {
          ok: result.ok,
          message: result.run.finalMessage ?? result.error,
          runId: result.run.id,
        })
      } catch (err) {
        this.json(res, 500, { error: err instanceof Error ? err.message : 'Internal error' })
      }
      return
    }

    if (pathname === '/mission' && req.method === 'POST') {
      if (this.config.requirePairing && !this.checkAuth(req, url)) {
        this.json(res, 401, { error: 'Unauthorized' })
        return
      }

      const body = await readBody(req)
      try {
        const data = JSON.parse(body) as MissionSubmitRequest
        if (!data.goal?.trim()) {
          this.json(res, 400, { error: 'Missing goal field' })
          return
        }

        if (this.checkIdempotency(data.idempotencyKey, res)) return

        if (data.wait) {
          const result = await this.runtime.runGoal({ goal: data.goal, context: data.context })
          this.json(res, 200, {
            ok: result.ok,
            runId: result.run.id,
            status: result.run.status,
            message: result.run.finalMessage ?? result.error,
            run: result.run,
          })
          return
        }

        const enqueued = this.runtime.enqueueGoal({ goal: data.goal, context: data.context })
        this.json(res, 202, enqueued)
      } catch (err) {
        this.json(res, 500, { error: err instanceof Error ? err.message : 'Internal error' })
      }
      return
    }

    if (pathname === '/missions' && req.method === 'GET') {
      if (this.config.requirePairing && !this.checkAuth(req, url)) {
        this.json(res, 401, { error: 'Unauthorized' })
        return
      }
      const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') ?? 20)))
      this.json(res, 200, this.runtime.getMissionList(limit))
      return
    }

    const missionMatch = pathname.match(/^\/mission\/([^/]+)$/)
    if (missionMatch && req.method === 'GET') {
      if (this.config.requirePairing && !this.checkAuth(req, url)) {
        this.json(res, 401, { error: 'Unauthorized' })
        return
      }
      const status = this.runtime.getMissionStatus(missionMatch[1])
      if (!status) {
        this.json(res, 404, { error: 'Mission not found' })
        return
      }
      this.json(res, 200, status)
      return
    }

    if (pathname === '/approvals' && req.method === 'GET') {
      if (this.config.requirePairing && !this.checkAuth(req, url)) {
        this.json(res, 401, { error: 'Unauthorized' })
        return
      }
      const snapshot = this.runtime.getSnapshot()
      this.json(res, 200, { pending: snapshot.pendingApprovals })
      return
    }

    const approvalMatch = pathname.match(/^\/approvals\/([^/]+)$/)
    if (approvalMatch && req.method === 'POST') {
      if (this.config.requirePairing && !this.checkAuth(req, url)) {
        this.json(res, 401, { error: 'Unauthorized' })
        return
      }

      const body = await readBody(req)
      try {
        const data = JSON.parse(body) as { runId?: string; approved?: boolean }
        if (!data.runId || typeof data.approved !== 'boolean') {
          this.json(res, 400, { error: 'Missing runId or approved field' })
          return
        }
        this.runtime.resolveApproval(data.runId, approvalMatch[1], data.approved)
        this.json(res, 200, { ok: true, stepId: approvalMatch[1], approved: data.approved })
      } catch (err) {
        this.json(res, 400, { error: err instanceof Error ? err.message : 'Approval failed' })
      }
      return
    }

    if (pathname === '/status' && req.method === 'GET') {
      if (this.config.requirePairing && !this.checkAuth(req, url)) {
        this.json(res, 401, { error: 'Unauthorized' })
        return
      }
      const snapshot = this.runtime.getSnapshot()
      this.json(res, 200, {
        runs: snapshot.stats.totalRuns,
        successRate: snapshot.stats.successRate,
        memory: snapshot.stats.memoryCount,
        uptime: snapshot.stats.uptime,
        mood: snapshot.creed.mood,
        queueDepth: snapshot.queueDepth,
        activeRunId: snapshot.activeRunId,
        pendingApprovals: snapshot.pendingApprovals.length,
        creed: { name: snapshot.creed.name, mood: snapshot.creed.mood, motto: snapshot.creed.motto },
      })
      return
    }

    if (pathname === '/memory' && req.method === 'GET') {
      if (this.config.requirePairing && !this.checkAuth(req, url)) {
        this.json(res, 401, { error: 'Unauthorized' })
        return
      }
      const query = url.searchParams.get('q') ?? ''
      const limit = Math.min(20, Math.max(1, Number(url.searchParams.get('limit') ?? 10)))
      const snapshot = this.runtime.getSnapshot()
      const entries = query
        ? this.runtime.searchMemory(query).slice(0, limit)
        : snapshot.memory
            .slice()
            .sort((a, b) => b.importance - a.importance)
            .slice(0, limit)
      this.json(res, 200, { entries })
      return
    }

    this.json(res, 404, { error: 'Not found' })
  }

  private handleSse(_req: http.IncomingMessage, res: http.ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    })
    res.write(': connected\n\n')
    this.sseClients.add(res)

    const heartbeat = setInterval(() => {
      res.write(': heartbeat\n\n')
    }, 30_000)

    res.on('close', () => {
      clearInterval(heartbeat)
      this.sseClients.delete(res)
    })
  }

  private broadcastSse(event: string, data: StreamEvent | ApprovalRequest): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
    for (const client of this.sseClients) {
      try {
        client.write(payload)
      } catch {
        this.sseClients.delete(client)
      }
    }
  }

  private checkIdempotency(key: string | undefined, res: http.ServerResponse): boolean {
    if (!key) return false
    if (this.processedKeys.has(key)) {
      this.json(res, 200, { status: 'duplicate', message: 'Already processed' })
      return true
    }
    this.processedKeys.add(key)
    if (this.processedKeys.size > 1000) {
      const keys = [...this.processedKeys]
      this.processedKeys = new Set(keys.slice(-500))
    }
    return false
  }

  private setCors(res: http.ServerResponse): void {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Pairing-Code')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  }

  private checkAuth(req: http.IncomingMessage, url?: URL): boolean {
    if (!this.bearerToken) return false
    const auth = req.headers['authorization'] ?? ''
    if (auth === `Bearer ${this.bearerToken}`) return true
    const queryToken = url?.searchParams.get('token')
    return queryToken === this.bearerToken
  }

  private json(res: http.ServerResponse, status: number, data: unknown): void {
    res.writeHead(status)
    res.end(JSON.stringify(data))
  }
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}
