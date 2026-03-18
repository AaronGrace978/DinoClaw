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
    try {
      const gateway = await this.getGatewayUrl()
      this.connect(gateway)
    } catch (err) {
      console.error('[Discord] Failed to start:', err instanceof Error ? err.message : err)
      this.running = false
      throw err
    }
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
    const data = (await res.json()) as { url?: string; message?: string; code?: number }
    if (!data.url) {
      const msg = data.message ?? `Discord API error ${data.code ?? res.status}`
      throw new Error(msg)
    }
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

    const authorId = msg.author.id
    const authorName = (msg.author.username ?? '').toLowerCase()
    const allowed = this.config.allowedUsers
    if (allowed.length > 0 && !allowed.includes('*')) {
      const match = allowed.some(
        a => a === authorId || a.toLowerCase() === authorName
      )
      if (!match) return
    }

    const content = msg.content.trim()
    if (!content) return

    if (content === '!status') {
      const snap = this.runtime.getSnapshot()
      await this.reply(msg.channel_id,
        `**DinoClaw Status**\nRuns: ${snap.stats.totalRuns} | Success: ${Math.round(snap.stats.successRate * 100)}% | Memory: ${snap.stats.memoryCount} | Mood: ${snap.creed.mood}`)
      return
    }

    // Show "DinoClaw is typing..." so users know we're working (typing lasts ~10s, refresh every 8s)
    const typingInterval = setInterval(() => {
      void this.triggerTyping(msg.channel_id)
    }, 8000)
    void this.triggerTyping(msg.channel_id)

    try {
      const result = await this.runtime.runGoal({ goal: content })
      const reply = result.ok
        ? result.run.finalMessage ?? 'Done.'
        : this.friendlyError(result.error)
      await this.reply(msg.channel_id, reply.slice(0, 2000))
    } catch (err) {
      console.error('[Discord] Goal failed:', err)
      const friendly = this.friendlyError(err instanceof Error ? err.message : 'Unknown')
      await this.reply(msg.channel_id, friendly)
    } finally {
      clearInterval(typingInterval)
    }
  }

  private async triggerTyping(channelId: string): Promise<void> {
    try {
      await fetch(`https://discord.com/api/v10/channels/${channelId}/typing`, {
        method: 'POST',
        headers: { Authorization: `Bot ${this.config.botToken}` },
      })
    } catch {
      // Ignore typing API errors
    }
  }

  private friendlyError(raw: string): string {
    if (raw.includes('timeout') || raw.includes('Timeout')) {
      return '🦖 *tiny dino arms flail* Oops! That took too long — try again? I might have been waiting on something.'
    }
    if (raw.includes('401') || raw.includes('unauthorized')) {
      return '🦖 Hmm, my model connection isn\'t authorized. Check Settings → Model (API key, provider).'
    }
    if (raw.includes('approval') || raw.includes('denied')) {
      return '🦖 I needed your approval for that, but you weren\'t at the DinoClaw app — try from the desktop when you need risky actions!'
    }
    return `🦖 *tilts head* Something went wrong: ${raw.slice(0, 200)}. Try again?`
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
