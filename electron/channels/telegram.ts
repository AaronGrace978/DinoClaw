import type { DinoRuntime } from '../runtime'

export interface TelegramConfig {
  botToken: string
  allowedUsers: string[]
}

interface TelegramUpdate {
  update_id: number
  message?: {
    message_id: number
    chat: { id: number }
    from?: { id: number; username?: string; first_name?: string }
    text?: string
  }
}

export class TelegramChannel {
  private config: TelegramConfig
  private runtime: DinoRuntime
  private polling = false
  private offset = 0

  constructor(runtime: DinoRuntime, config: TelegramConfig) {
    this.runtime = runtime
    this.config = config
  }

  async start(): Promise<void> {
    this.polling = true
    await this.verifyBot()
    void this.pollLoop()
  }

  stop(): void {
    this.polling = false
  }

  isRunning(): boolean {
    return this.polling
  }

  private async verifyBot(): Promise<void> {
    const res = await this.api('getMe') as { ok?: boolean }
    if (!res.ok) throw new Error(`Telegram bot verification failed: ${JSON.stringify(res)}`)
  }

  private async pollLoop(): Promise<void> {
    while (this.polling) {
      try {
        const updates = await this.getUpdates()
        for (const update of updates) {
          this.offset = update.update_id + 1
          if (update.message?.text) {
            void this.handleMessage(update)
          }
        }
      } catch {
        await sleep(5000)
      }
      await sleep(1000)
    }
  }

  private async getUpdates(): Promise<TelegramUpdate[]> {
    const res = await this.api('getUpdates', {
      offset: this.offset,
      timeout: 25,
      allowed_updates: ['message'],
    })
    return (res as { result?: TelegramUpdate[] }).result ?? []
  }

  private async handleMessage(update: TelegramUpdate): Promise<void> {
    const msg = update.message!
    const userId = String(msg.from?.id ?? '')
    const username = msg.from?.username ?? ''

    if (this.config.allowedUsers.length > 0 &&
        !this.config.allowedUsers.includes('*') &&
        !this.config.allowedUsers.includes(userId) &&
        !this.config.allowedUsers.includes(username)) {
      await this.sendMessage(msg.chat.id, `Unauthorized. Run: dinoclaw channel bind-telegram ${userId}`)
      return
    }

    const text = msg.text!
    if (text === '/start') {
      await this.sendMessage(msg.chat.id, 'DinoClaw connected. Send me a goal!')
      return
    }

    if (text === '/status') {
      const snap = this.runtime.getSnapshot()
      await this.sendMessage(msg.chat.id,
        `Runs: ${snap.stats.totalRuns} | Success: ${Math.round(snap.stats.successRate * 100)}% | Memory: ${snap.stats.memoryCount} | Mood: ${snap.creed.mood}`)
      return
    }

    try {
      const result = await this.runtime.runGoal({ goal: text })
      const reply = result.ok
        ? result.run.finalMessage ?? 'Done.'
        : `Error: ${result.error}`
      await this.sendMessage(msg.chat.id, reply.slice(0, 4000))
    } catch (err) {
      await this.sendMessage(msg.chat.id, `Runtime error: ${err instanceof Error ? err.message : 'Unknown'}`)
    }
  }

  private async sendMessage(chatId: number, text: string): Promise<void> {
    await this.api('sendMessage', { chat_id: chatId, text, parse_mode: 'Markdown' })
  }

  private async api(method: string, body?: unknown): Promise<unknown> {
    const url = `https://api.telegram.org/bot${this.config.botToken}/${method}`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
    return res.json()
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
