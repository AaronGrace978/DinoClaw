import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

export type ServiceStatus = 'installed' | 'running' | 'stopped' | 'not_installed' | 'unknown'

export class ServiceManager {
  private readonly serviceName = 'dinoclaw'

  async getStatus(): Promise<ServiceStatus> {
    if (process.platform === 'win32') {
      return this.getWindowsStatus()
    }
    return this.getLinuxStatus()
  }

  async install(): Promise<string> {
    if (process.platform === 'win32') {
      return this.installWindows()
    }
    return this.installLinux()
  }

  async uninstall(): Promise<string> {
    if (process.platform === 'win32') {
      return this.uninstallWindows()
    }
    return this.uninstallLinux()
  }

  async startService(): Promise<string> {
    if (process.platform === 'win32') {
      return this.startWindows()
    }
    return this.startLinux()
  }

  async stopService(): Promise<string> {
    if (process.platform === 'win32') {
      return this.stopWindows()
    }
    return this.stopLinux()
  }

  private async getWindowsStatus(): Promise<ServiceStatus> {
    try {
      const { stdout } = await execAsync(
        `schtasks /Query /TN "${this.serviceName}" /FO CSV /NH 2>nul`,
        { timeout: 5000 },
      )
      if (stdout.includes('Running')) return 'running'
      if (stdout.includes('Ready') || stdout.includes('Disabled')) return 'stopped'
      return 'installed'
    } catch {
      return 'not_installed'
    }
  }

  private async getLinuxStatus(): Promise<ServiceStatus> {
    try {
      const { stdout } = await execAsync(
        `systemctl --user is-active ${this.serviceName} 2>/dev/null`,
        { timeout: 5000 },
      )
      if (stdout.trim() === 'active') return 'running'
      return 'stopped'
    } catch {
      try {
        await execAsync(`systemctl --user status ${this.serviceName} 2>/dev/null`, { timeout: 5000 })
        return 'stopped'
      } catch {
        return 'not_installed'
      }
    }
  }

  private async installWindows(): Promise<string> {
    const exePath = process.execPath
    await execAsync(
      `schtasks /Create /SC ONLOGON /TN "${this.serviceName}" /TR "\\"${exePath}\\" --daemon" /F`,
      { timeout: 10000 },
    )
    return 'Windows scheduled task created for DinoClaw.'
  }

  private async installLinux(): Promise<string> {
    const unitDir = path.join(os.homedir(), '.config', 'systemd', 'user')
    fs.mkdirSync(unitDir, { recursive: true })

    const exePath = process.execPath
    const unitFile = path.join(unitDir, `${this.serviceName}.service`)
    const unitContent = `[Unit]
Description=DinoClaw AI Agent
After=network.target

[Service]
Type=simple
ExecStart=${exePath} --daemon
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
`
    fs.writeFileSync(unitFile, unitContent, 'utf8')
    await execAsync('systemctl --user daemon-reload', { timeout: 10000 })
    await execAsync(`systemctl --user enable ${this.serviceName}`, { timeout: 10000 })
    return `Systemd user service installed at ${unitFile}`
  }

  private async uninstallWindows(): Promise<string> {
    await execAsync(`schtasks /Delete /TN "${this.serviceName}" /F`, { timeout: 10000 })
    return 'Windows scheduled task removed.'
  }

  private async uninstallLinux(): Promise<string> {
    await execAsync(`systemctl --user disable ${this.serviceName}`, { timeout: 10000 })
    await execAsync(`systemctl --user stop ${this.serviceName}`, { timeout: 10000 })
    const unitFile = path.join(os.homedir(), '.config', 'systemd', 'user', `${this.serviceName}.service`)
    if (fs.existsSync(unitFile)) fs.unlinkSync(unitFile)
    await execAsync('systemctl --user daemon-reload', { timeout: 10000 })
    return 'Systemd user service removed.'
  }

  private async startWindows(): Promise<string> {
    await execAsync(`schtasks /Run /TN "${this.serviceName}"`, { timeout: 10000 })
    return 'DinoClaw started via Windows Task Scheduler.'
  }

  private async startLinux(): Promise<string> {
    await execAsync(`systemctl --user start ${this.serviceName}`, { timeout: 10000 })
    return 'DinoClaw systemd service started.'
  }

  private async stopWindows(): Promise<string> {
    await execAsync(`schtasks /End /TN "${this.serviceName}"`, { timeout: 10000 })
    return 'DinoClaw stopped.'
  }

  private async stopLinux(): Promise<string> {
    await execAsync(`systemctl --user stop ${this.serviceName}`, { timeout: 10000 })
    return 'DinoClaw systemd service stopped.'
  }
}
