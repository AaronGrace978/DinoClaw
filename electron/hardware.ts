import os from 'node:os'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

export interface HardwareInfo {
  os: string
  arch: string
  hostname: string
  cpuModel: string
  cpuCores: number
  cpuSpeed: number
  totalMemory: string
  freeMemory: string
  memoryUsage: number
  uptime: string
  platform: string
  nodeVersion: string
  user: string
  networkInterfaces: NetworkInterface[]
  disks: DiskInfo[]
  usbDevices: string[]
}

interface NetworkInterface {
  name: string
  address: string
  family: string
  mac: string
}

interface DiskInfo {
  mount: string
  total: string
  free: string
  used: string
}

export async function getHardwareInfo(): Promise<HardwareInfo> {
  const cpus = os.cpus()
  const totalMem = os.totalmem()
  const freeMem = os.freemem()

  const networks: NetworkInterface[] = []
  const interfaces = os.networkInterfaces()
  for (const [name, addrs] of Object.entries(interfaces)) {
    for (const addr of addrs ?? []) {
      if (!addr.internal) {
        networks.push({
          name,
          address: addr.address,
          family: addr.family,
          mac: addr.mac,
        })
      }
    }
  }

  const disks = await getDiskInfo()
  const usb = await getUsbDevices()

  return {
    os: `${os.type()} ${os.release()}`,
    arch: os.arch(),
    hostname: os.hostname(),
    cpuModel: cpus[0]?.model ?? 'Unknown',
    cpuCores: cpus.length,
    cpuSpeed: cpus[0]?.speed ?? 0,
    totalMemory: formatBytes(totalMem),
    freeMemory: formatBytes(freeMem),
    memoryUsage: Math.round(((totalMem - freeMem) / totalMem) * 100),
    uptime: formatUptime(os.uptime()),
    platform: process.platform,
    nodeVersion: process.version,
    user: os.userInfo().username,
    networkInterfaces: networks,
    disks,
    usbDevices: usb,
  }
}

async function getDiskInfo(): Promise<DiskInfo[]> {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execAsync('wmic logicaldisk get size,freespace,caption /format:csv', { timeout: 5000 })
      return stdout.split('\n')
        .filter(l => l.includes(','))
        .slice(1)
        .map(line => {
          const parts = line.trim().split(',')
          const caption = parts[1] ?? ''
          const free = parseInt(parts[2] ?? '0')
          const total = parseInt(parts[3] ?? '0')
          if (!total) return null
          return {
            mount: caption,
            total: formatBytes(total),
            free: formatBytes(free),
            used: formatBytes(total - free),
          }
        })
        .filter((d): d is DiskInfo => d !== null)
    } else {
      const { stdout } = await execAsync("df -h --output=target,size,avail,used | tail -n +2", { timeout: 5000 })
      return stdout.split('\n')
        .filter(Boolean)
        .slice(0, 10)
        .map(line => {
          const parts = line.trim().split(/\s+/)
          return {
            mount: parts[0] ?? '',
            total: parts[1] ?? '',
            free: parts[2] ?? '',
            used: parts[3] ?? '',
          }
        })
    }
  } catch {
    return []
  }
}

async function getUsbDevices(): Promise<string[]> {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execAsync('wmic path Win32_USBControllerDevice get Dependent /format:csv', { timeout: 5000 })
      return stdout.split('\n').filter(l => l.includes('DeviceID')).map(l => l.trim()).slice(0, 20)
    } else if (process.platform === 'darwin') {
      const { stdout } = await execAsync('system_profiler SPUSBDataType 2>/dev/null | head -40', { timeout: 5000 })
      return stdout.split('\n').filter(l => l.trim().endsWith(':')).map(l => l.trim().replace(/:$/, '')).slice(0, 20)
    } else {
      const { stdout } = await execAsync('lsusb 2>/dev/null || echo "lsusb not available"', { timeout: 5000 })
      return stdout.split('\n').filter(Boolean).slice(0, 20)
    }
  } catch {
    return ['USB detection not available']
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}
