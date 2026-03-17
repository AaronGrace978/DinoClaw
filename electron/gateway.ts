import http from 'node:http'
import { randomUUID } from 'node:crypto'
import type { DinoRuntime } from './runtime'

export interface GatewayConfig {
  port: number
  host: string
  requirePairing: boolean
}

const DEFAULT_CONFIG: GatewayConfig = {
  port: 42617,
  host: '127.0.0.1',
  requirePairing: true,
}

export class Gateway {
  private server: http.Server | null = null
  private pairingCode: string = ''
  private bearerToken: string = ''
  private config: GatewayConfig
  private processedKeys = new Set<string>()
  private runtime: DinoRuntime

  constructor(runtime: DinoRuntime, config?: Partial<GatewayConfig>) {
    this.runtime = runtime
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  start(port?: number): Promise<{ port: number; pairingCode: string }> {
    if (typeof port === 'number' && Number.isFinite(port) && port > 0) {
      this.config.port = Math.trunc(port)
    }
    this.pairingCode = String(Math.floor(100000 + Math.random() * 900000))
    this.bearerToken = ''

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

    res.setHeader('Content-Type', 'application/json')

    if (pathname === '/health' && req.method === 'GET') {
      this.json(res, 200, { status: 'ok', version: '0.3.0' })
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
      this.json(res, 200, { token: this.bearerToken })
      return
    }

    if (pathname === '/webhook' && req.method === 'POST') {
      if (this.config.requirePairing && !this.checkAuth(req)) {
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

        if (data.idempotencyKey) {
          if (this.processedKeys.has(data.idempotencyKey)) {
            this.json(res, 200, { status: 'duplicate', message: 'Already processed' })
            return
          }
          this.processedKeys.add(data.idempotencyKey)
          if (this.processedKeys.size > 1000) {
            const keys = [...this.processedKeys]
            this.processedKeys = new Set(keys.slice(-500))
          }
        }

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

    if (pathname === '/status' && req.method === 'GET') {
      if (this.config.requirePairing && !this.checkAuth(req)) {
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
      })
      return
    }

    this.json(res, 404, { error: 'Not found' })
  }

  private checkAuth(req: http.IncomingMessage): boolean {
    if (!this.bearerToken) return false
    const auth = req.headers['authorization'] ?? ''
    return auth === `Bearer ${this.bearerToken}`
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
