import { spawn, type ChildProcess } from 'node:child_process'

export type TunnelProvider = 'none' | 'cloudflare' | 'ngrok' | 'custom'

export interface TunnelConfig {
  provider: TunnelProvider
  port: number
  customCommand?: string
  ngrokToken?: string
}

export class TunnelManager {
  private process: ChildProcess | null = null
  private publicUrl = ''
  private config: TunnelConfig

  constructor(config: TunnelConfig) {
    this.config = config
  }

  async start(): Promise<string> {
    if (this.config.provider === 'none') return ''

    const { command, args } = this.getCommand()

    return new Promise((resolve, reject) => {
      this.process = spawn(command, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })

      let output = ''

      this.process.stdout?.on('data', (data: Buffer) => {
        output += data.toString()
        const urlMatch = output.match(/https?:\/\/[^\s"]+\.(?:ngrok|trycloudflare|lhr)\S*/i)
        if (urlMatch) {
          this.publicUrl = urlMatch[0]
          resolve(this.publicUrl)
        }
      })

      this.process.stderr?.on('data', (data: Buffer) => {
        output += data.toString()
        const urlMatch = output.match(/https?:\/\/[^\s"]+\.(?:ngrok|trycloudflare|lhr)\S*/i)
        if (urlMatch) {
          this.publicUrl = urlMatch[0]
          resolve(this.publicUrl)
        }
      })

      this.process.on('error', (err) => {
        reject(new Error(`Tunnel failed to start: ${err.message}. Is ${command} installed?`))
      })

      this.process.on('close', (code) => {
        if (!this.publicUrl) {
          reject(new Error(`Tunnel exited with code ${code} before providing a URL`))
        }
      })

      setTimeout(() => {
        if (!this.publicUrl) {
          reject(new Error('Tunnel timed out waiting for public URL (30s)'))
        }
      }, 30_000)
    })
  }

  stop(): void {
    this.process?.kill()
    this.process = null
    this.publicUrl = ''
  }

  getPublicUrl(): string {
    return this.publicUrl
  }

  isRunning(): boolean {
    return this.process !== null && !this.process.killed
  }

  getInfo(): { provider: TunnelProvider; running: boolean; url: string } {
    return {
      provider: this.config.provider,
      running: this.isRunning(),
      url: this.publicUrl,
    }
  }

  private getCommand(): { command: string; args: string[] } {
    switch (this.config.provider) {
      case 'cloudflare':
        return {
          command: 'cloudflared',
          args: ['tunnel', '--url', `http://127.0.0.1:${this.config.port}`],
        }
      case 'ngrok':
        return {
          command: 'ngrok',
          args: [
            'http', String(this.config.port),
            ...(this.config.ngrokToken ? ['--authtoken', this.config.ngrokToken] : []),
            '--log=stdout',
          ],
        }
      case 'custom': {
        const parts = (this.config.customCommand ?? '').split(/\s+/)
        return { command: parts[0], args: parts.slice(1) }
      }
      default:
        return { command: 'echo', args: ['no tunnel'] }
    }
  }
}
