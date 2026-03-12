import { app, BrowserWindow, ipcMain, dialog, Tray, Menu, Notification, nativeImage } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  DinoCreed,
  ExecutionPolicy,
  GoalRequest,
  ModelSettings,
  Skill,
  TunnelProvider,
  BrowserConfig,
} from '../src/shared/contracts'
import { DinoRuntime } from './runtime'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const runtime = new DinoRuntime()

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: '#0c1118',
    title: 'DinoClaw',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.setMenuBarVisibility(false)

  mainWindow.on('close', (e) => {
    if (tray && !isQuitting) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })

  const devServerUrl = process.env.VITE_DEV_SERVER_URL
  if (devServerUrl) {
    await mainWindow.loadURL(devServerUrl)
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

function createTray(): void {
  const iconPath = path.join(__dirname, '../public/dino.svg')
  let icon: Electron.NativeImage
  try {
    icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
  } catch {
    icon = nativeImage.createEmpty()
  }

  tray = new Tray(icon)
  tray.setToolTip('DinoClaw')

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show DinoClaw', click: () => { mainWindow?.show(); mainWindow?.focus() } },
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; app.quit() } },
  ])

  tray.setContextMenu(contextMenu)
  tray.on('double-click', () => { mainWindow?.show(); mainWindow?.focus() })
}

app.whenReady().then(async () => {
  // Core
  ipcMain.handle('dinoclaw:getSnapshot', () => runtime.getSnapshot())
  ipcMain.handle('dinoclaw:updateCreed', (_e, creed: DinoCreed) => runtime.updateCreed(creed))
  ipcMain.handle('dinoclaw:updateModel', (_e, model: ModelSettings) => runtime.updateModel(model))
  ipcMain.handle('dinoclaw:updatePolicy', (_e, policy: ExecutionPolicy) => runtime.updatePolicy(policy))
  ipcMain.handle('dinoclaw:runGoal', (_e, request: GoalRequest) => runtime.runGoal(request))
  ipcMain.handle('dinoclaw:approveToolUse', (_e, _runId: string, stepId: string, approved: boolean) =>
    runtime.resolveApproval(stepId, approved),
  )

  // Memory
  ipcMain.handle('dinoclaw:deleteMemory', (_e, id: string) => runtime.deleteMemory(id))
  ipcMain.handle('dinoclaw:searchMemory', (_e, query: string) => runtime.searchMemory(query))
  ipcMain.handle('dinoclaw:exportMemory', () => runtime.exportMemory())
  ipcMain.handle('dinoclaw:importMemory', (_e, json: string) => runtime.importMemory(json))

  // Skills
  ipcMain.handle('dinoclaw:installSkill', (_e, skill: Skill) => runtime.installSkill(skill))
  ipcMain.handle('dinoclaw:removeSkill', (_e, id: string) => runtime.removeSkill(id))

  // Workspace
  ipcMain.handle('dinoclaw:openDataDirectory', () => runtime.openDataDirectory())
  ipcMain.handle('dinoclaw:pickWorkspace', async () => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select Workspace Directory',
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return runtime.setWorkspace(result.filePaths[0])
  })
  ipcMain.handle('dinoclaw:setWorkspace', (_e, dir: string) => runtime.setWorkspace(dir))
  ipcMain.handle('dinoclaw:getWorkspace', () => runtime.getWorkspace())

  // Notifications
  ipcMain.handle('dinoclaw:showNotification', (_e, title: string, body: string) => {
    if (Notification.isSupported()) new Notification({ title, body }).show()
  })

  // Gateway
  ipcMain.handle('dinoclaw:startGateway', (_e, port: number) => runtime.startGateway(port))
  ipcMain.handle('dinoclaw:stopGateway', () => runtime.stopGateway())

  // Channels
  ipcMain.handle('dinoclaw:startTelegram', (_e, botToken: string, allowedUsers: string[]) =>
    runtime.startTelegram(botToken, allowedUsers))
  ipcMain.handle('dinoclaw:stopTelegram', () => runtime.stopTelegram())
  ipcMain.handle('dinoclaw:startDiscord', (_e, botToken: string, allowedUsers: string[]) =>
    runtime.startDiscord(botToken, allowedUsers))
  ipcMain.handle('dinoclaw:stopDiscord', () => runtime.stopDiscord())

  // Scheduler
  ipcMain.handle('dinoclaw:addCronJob', (_e, name: string, schedule: string, goal: string) =>
    runtime.addCronJob(name, schedule, goal))
  ipcMain.handle('dinoclaw:removeCronJob', (_e, id: string) => runtime.removeCronJob(id))
  ipcMain.handle('dinoclaw:toggleCronJob', (_e, id: string, enabled: boolean) => runtime.toggleCronJob(id, enabled))

  // Tunnel
  ipcMain.handle('dinoclaw:startTunnel', (_e, provider: TunnelProvider, port: number, ngrokToken?: string) =>
    runtime.startTunnel(provider, port, ngrokToken))
  ipcMain.handle('dinoclaw:stopTunnel', () => runtime.stopTunnel())

  // Docker
  ipcMain.handle('dinoclaw:updateDocker', (_e, config: Record<string, unknown>) =>
    runtime.docker.updateConfig(config))

  // Browser
  ipcMain.handle('dinoclaw:updateBrowser', (_e, config: BrowserConfig) =>
    runtime.updateBrowserConfig(config))

  // Service
  ipcMain.handle('dinoclaw:getServiceStatus', () => runtime.getServiceStatus())
  ipcMain.handle('dinoclaw:installService', () => runtime.installService())
  ipcMain.handle('dinoclaw:uninstallService', () => runtime.uninstallService())

  createTray()
  await createWindow()

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow()
    } else {
      mainWindow?.show()
      mainWindow?.focus()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

let isQuitting = false
app.on('before-quit', () => { isQuitting = true })
