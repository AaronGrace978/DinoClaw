import type { ApprovalRequest, StreamEvent } from '../../src/shared/contracts'
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
  callback_query?: {
    id: string
    from: { id: number; username?: string }
    message?: { chat: { id: number }; message_id: number }
    data?: string
  }
}

export class TelegramChannel {
  private config: TelegramConfig
  private runtime: DinoRuntime
  private polling = false
  private offset = 0
  private lastChatId: number | null = null
  private unsubscribeApproval: (() => void) | null = null
  private runListeners = new Map<string, () => void>()

  constructor(runtime: DinoRuntime, config: TelegramConfig) {
    this.runtime = runtime
    this.config = config
  }

  async start(): Promise<void> {
    this.polling = true
    await this.verifyBot()
    this.unsubscribeApproval = this.runtime.subscribeApprovalRequest(req => {
      void this.pushApproval(req)
    })
    void this.pollLoop()
  }

  stop(): void {
    this.polling = false
    this.unsubscribeApproval?.()
    this.unsubscribeApproval = null
    for (const unsub of this.runListeners.values()) unsub()
    this.runListeners.clear()
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
          if (update.callback_query) {
            void this.handleCallback(update)
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
      allowed_updates: ['message', 'callback_query'],
    })
    return (res as { result?: TelegramUpdate[] }).result ?? []
  }

  private isAuthorized(userId: string, username: string): boolean {
    if (this.config.allowedUsers.length === 0) return true
    if (this.config.allowedUsers.includes('*')) return true
    return this.config.allowedUsers.includes(userId) || this.config.allowedUsers.includes(username)
  }

  private async handleMessage(update: TelegramUpdate): Promise<void> {
    const msg = update.message!
    const userId = String(msg.from?.id ?? '')
    const username = msg.from?.username ?? ''

    if (!this.isAuthorized(userId, username)) {
      await this.sendMessage(msg.chat.id, `Unauthorized. Run: dinoclaw channel bind-telegram ${userId}`)
      return
    }

    this.lastChatId = msg.chat.id
    const text = msg.text!

    if (text === '/start') {
      await this.sendMessage(msg.chat.id, '🦖 Dino Link connected. Text me a goal — your Nest runs it at home.')
      return
    }

    if (text === '/status') {
      const snap = this.runtime.getSnapshot()
      await this.sendMessage(msg.chat.id,
        `Runs: ${snap.stats.totalRuns} | Success: ${Math.round(snap.stats.successRate * 100)}% | Queue: ${snap.queueDepth} | Mood: ${snap.creed.mood}`)
      return
    }

    try {
      const enqueued = this.runtime.enqueueGoal({ goal: text })
      const position = enqueued.queuePosition > 1
        ? ` (queue #${enqueued.queuePosition})`
        : ''
      await this.sendMessage(msg.chat.id, `🦖 On it${position}…`)
      this.watchRun(msg.chat.id, enqueued.runId)
    } catch (err) {
      await this.sendMessage(msg.chat.id, `Runtime error: ${err instanceof Error ? err.message : 'Unknown'}`)
    }
  }

  private watchRun(chatId: number, runId: string): void {
    this.runListeners.get(runId)?.()

    const unsub = this.runtime.subscribeStreamEvent((event: StreamEvent) => {
      if (event.runId !== runId) return
      if (event.step.kind !== 'final' && event.step.kind !== 'error') return

      this.runListeners.delete(runId)
      unsub()

      const status = this.runtime.getMissionStatus(runId)
      const run = status?.run
      const reply = run?.finalMessage ?? run?.error ?? event.step.summary
      void this.sendMessage(chatId, run?.status === 'completed' ? `✓ ${reply}` : `✗ ${reply}`)
    })

    this.runListeners.set(runId, unsub)

    const poll = setInterval(() => {
      const status = this.runtime.getMissionStatus(runId)
      if (!status) return
      if (status.run.status === 'completed' || status.run.status === 'failed') {
        clearInterval(poll)
        if (this.runListeners.get(runId) === unsub) {
          this.runListeners.delete(runId)
          unsub()
          const reply = status.run.finalMessage ?? status.run.error ?? 'Done.'
          void this.sendMessage(chatId, status.run.status === 'completed' ? `✓ ${reply}` : `✗ ${reply}`)
        }
      }
    }, 5000)

    const originalUnsub = unsub
    this.runListeners.set(runId, () => {
      clearInterval(poll)
      originalUnsub()
    })
  }

  private async handleCallback(update: TelegramUpdate): Promise<void> {
    const query = update.callback_query!
    const userId = String(query.from.id)
    const username = query.from.username ?? ''

    if (!this.isAuthorized(userId, username)) {
      await this.api('answerCallbackQuery', { callback_query_id: query.id, text: 'Unauthorized' })
      return
    }

    const data = query.data ?? ''
    const match = data.match(/^(apr|den):([0-9a-f-]+)$/i)
    if (!match) {
      await this.api('answerCallbackQuery', { callback_query_id: query.id, text: 'Unknown action' })
      return
    }

    const approved = match[1] === 'apr'
    const stepId = match[2]
    const pending = this.runtime.getSnapshot().pendingApprovals.find(a => a.stepId === stepId)
    if (!pending) {
      await this.api('answerCallbackQuery', { callback_query_id: query.id, text: 'Approval expired' })
      return
    }

    try {
      this.runtime.resolveApproval(pending.runId, stepId, approved)
      await this.api('answerCallbackQuery', {
        callback_query_id: query.id,
        text: approved ? 'Approved ✓' : 'Denied',
      })
      const chatId = query.message?.chat.id ?? this.lastChatId
      if (chatId) {
        await this.sendMessage(chatId, approved
          ? `✓ Approved \`${pending.toolName}\` (${pending.risk})`
          : `✗ Denied \`${pending.toolName}\``)
      }
    } catch (err) {
      await this.api('answerCallbackQuery', {
        callback_query_id: query.id,
        text: err instanceof Error ? err.message : 'Failed',
      })
    }
  }

  private async pushApproval(request: ApprovalRequest): Promise<void> {
    const chatId = this.lastChatId
    if (!chatId) return

    const preview = request.preview?.slice(0, 200) ?? request.reason
    const text = [
      '⚠️ *Approval needed*',
      `\`${request.toolName}\` (${request.risk})`,
      preview,
    ].join('\n')

    await this.api('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: '✓ Approve', callback_data: `apr:${request.stepId}` },
          { text: '✗ Deny', callback_data: `den:${request.stepId}` },
        ]],
      },
    })
  }

  private async sendMessage(chatId: number, text: string): Promise<void> {
    await this.api('sendMessage', { chat_id: chatId, text: text.slice(0, 4000), parse_mode: 'Markdown' })
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
