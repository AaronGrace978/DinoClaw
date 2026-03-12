import { exec } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

export interface DockerConfig {
  enabled: boolean
  image: string
  network: string
  memoryLimitMb: number
  cpuLimit: number
  readOnlyRootfs: boolean
  mountWorkspace: boolean
}

export const DEFAULT_DOCKER_CONFIG: DockerConfig = {
  enabled: false,
  image: 'alpine:3.20',
  network: 'none',
  memoryLimitMb: 512,
  cpuLimit: 1.0,
  readOnlyRootfs: true,
  mountWorkspace: true,
}

export class DockerSandbox {
  private config: DockerConfig

  constructor(config?: Partial<DockerConfig>) {
    this.config = { ...DEFAULT_DOCKER_CONFIG, ...config }
  }

  async isAvailable(): Promise<boolean> {
    try {
      await execAsync('docker --version', { timeout: 5000 })
      return true
    } catch {
      return false
    }
  }

  async executeCommand(
    command: string,
    workspaceRoot: string,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const args: string[] = ['docker', 'run', '--rm']

    args.push(`--network=${this.config.network}`)
    args.push(`--memory=${this.config.memoryLimitMb}m`)
    args.push(`--cpus=${this.config.cpuLimit}`)

    if (this.config.readOnlyRootfs) {
      args.push('--read-only')
      args.push('--tmpfs', '/tmp:rw,noexec,nosuid,size=64m')
    }

    if (this.config.mountWorkspace) {
      args.push('-v', `${workspaceRoot}:/workspace:rw`)
      args.push('-w', '/workspace')
    }

    args.push('--security-opt=no-new-privileges')
    args.push('--pids-limit=256')

    args.push(this.config.image)
    args.push('/bin/sh', '-c', command)

    try {
      const result = await execAsync(args.join(' '), {
        timeout: 60_000,
        maxBuffer: 1024 * 1024 * 4,
        windowsHide: true,
      })
      return {
        stdout: result.stdout?.trim() ?? '',
        stderr: result.stderr?.trim() ?? '',
        exitCode: 0,
      }
    } catch (err) {
      const error = err as { stdout?: string; stderr?: string; code?: number }
      return {
        stdout: error.stdout?.trim() ?? '',
        stderr: error.stderr?.trim() ?? '',
        exitCode: error.code ?? 1,
      }
    }
  }

  async pullImage(): Promise<string> {
    try {
      const { stdout } = await execAsync(`docker pull ${this.config.image}`, { timeout: 120_000 })
      return stdout.trim()
    } catch (err) {
      throw new Error(`Failed to pull image ${this.config.image}: ${err instanceof Error ? err.message : 'Unknown'}`)
    }
  }

  getConfig(): DockerConfig {
    return { ...this.config }
  }

  updateConfig(config: Partial<DockerConfig>): void {
    Object.assign(this.config, config)
  }
}
