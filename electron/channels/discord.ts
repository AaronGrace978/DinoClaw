import type { DinoRuntime } from '../runtime'

export interface DiscordConfig {
  botToken: string
  allowedUsers: string[]
}

interface DiscordMessage {
  id: string
  channel_id: string
  author: { id: string; username: string; bot?: boolean }
  content: string
  guild_id?: string
}

interface GatewayPayload {
  op: number
  d: unknown
  t?: string
  s?: number
}

export class DiscordChannel {
  private config: DiscordConfig
  private runtime: DinoRuntime
  private ws: WebSocket | null = null
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null
  private sequenceNumber: number | null = null
  private running = false

  constructor(runtime: DinoRuntime, config: DiscordConfig) {
    this.runtime = runtime
    this.config = config
  }

  async start(): Promise<void> {
    this.running = true
    const gateway = await this.getGatewayUrl()
    this.connect(gateway)
  }

  stop(): void {
    this.running = false
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval)
    this.ws?.close()
    this.ws = null
  }

  isRunning(): boolean {
    return this.running && this.ws !== null
  }

  private async getGatewayUrl(): Promise<string> {
    const res = await fetch('https://discord.com/api/v10/gateway', {
      headers: { Authorization: `Bot ${this.config.botToken}` },
    })
    const data = (await res.json()) as { url: string }
    return data.url + '?v=10&encoding=json'
  }

  private connect(gatewayUrl: string): void {
    this.ws = new WebSocket(gatewayUrl)

    this.ws.onmessage = (event) => {
      const payload = JSON.parse(String(event.data)) as GatewayPayload
      this.handlePayload(payload)
    }

    this.ws.onclose = () => {
      if (this.heartbeatInterval) clearInterval(this.heartbeatInterval)
      if (this.running) {
        setTimeout(() => void this.start(), 5000)
      }
    }

    this.ws.onerror = () => {
      this.ws?.close()
    }
  }

  private handlePayload(payload: GatewayPayload): void {
    if (payload.s !== null && payload.s !== undefined) {
      this.sequenceNumber = payload.s
    }

    switch (payload.op) {
      case 10: {
        const data = payload.d as { heartbeat_interval: number }
        this.startHeartbeat(data.heartbeat_interval)
        this.identify()
        break
      }
      case 0: {
        if (payload.t === 'MESSAGE_CREATE') {
          void this.handleMessage(payload.d as DiscordMessage)
        }
        break
      }
    }
  }

  private startHeartbeat(interval: number): void {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval)
    this.heartbeatInterval = setInterval(() => {
      this.ws?.send(JSON.stringify({ op: 1, d: this.sequenceNumber }))
    }, interval)
  }

  private identify(): void {
    this.ws?.send(JSON.stringify({
      op: 2,
      d: {
        token: this.config.botToken,
        intents: 512 | 32768,
        properties: {
          os: process.platform,
          browser: 'dinoclaw',
          device: 'dinoclaw',
        },
      },
    }))
  }

  private async handleMessage(msg: DiscordMessage): Promise<void> {
    if (msg.author.bot) return

    if (this.config.allowedUsers.length > 0 &&
        !this.config.allowedUsers.includes('*') &&
        !this.config.allowedUsers.includes(msg.author.id) &&
        !this.config.allowedUsers.includes(msg.author.username)) {
      return
    }

    const content = msg.content.trim()
    if (!content) return

    if (content === '!status') {
      const snap = this.runtime.getSnapshot()
      await this.reply(msg.channel_id,
        `**DinoClaw Status**\nRuns: ${snap.stats.totalRuns} | Success: ${Math.round(snap.stats.successRate * 100)}% | Memory: ${snap.stats.memoryCount} | Mood: ${snap.creed.mood}`)
      return
    }

    try {
      const result = await this.runtime.runGoal({ goal: content })
      const reply = result.ok
        ? result.run.finalMessage ?? 'Done.'
        : `Error: ${result.error}`
      await this.reply(msg.channel_id, reply.slice(0, 2000))
    } catch (err) {
      await this.reply(msg.channel_id, `Error: ${err instanceof Error ? err.message : 'Unknown'}`)
    }
  }

  private async reply(channelId: string, content: string): Promise<void> {
    await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bot ${this.config.botToken}`,
      },
      body: JSON.stringify({ content }),
    })
  }
}
