import type { DinoRuntime } from '../runtime'
import { TelegramChannel, type TelegramConfig } from './telegram'
import { DiscordChannel, type DiscordConfig } from './discord'

export interface ChannelStatus {
  telegram: { enabled: boolean; running: boolean }
  discord: { enabled: boolean; running: boolean }
}

export class ChannelManager {
  private runtime: DinoRuntime
  private telegram: TelegramChannel | null = null
  private discord: DiscordChannel | null = null

  constructor(runtime: DinoRuntime) {
    this.runtime = runtime
  }

  async startTelegram(config: TelegramConfig): Promise<void> {
    this.telegram?.stop()
    this.telegram = new TelegramChannel(this.runtime, config)
    await this.telegram.start()
  }

  async startDiscord(config: DiscordConfig): Promise<void> {
    this.discord?.stop()
    this.discord = new DiscordChannel(this.runtime, config)
    await this.discord.start()
  }

  stopTelegram(): void {
    this.telegram?.stop()
    this.telegram = null
  }

  stopDiscord(): void {
    this.discord?.stop()
    this.discord = null
  }

  stopAll(): void {
    this.stopTelegram()
    this.stopDiscord()
  }

  getStatus(): ChannelStatus {
    return {
      telegram: {
        enabled: this.telegram !== null,
        running: this.telegram?.isRunning() ?? false,
      },
      discord: {
        enabled: this.discord !== null,
        running: this.discord?.isRunning() ?? false,
      },
    }
  }
}
