import { app, BrowserWindow, ipcMain, dialog, Tray, Menu, Notification, nativeImage, session } from 'electron'
import fs from 'node:fs'
import { get as httpGet } from 'node:http'
import { createServer, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
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
  StompConfig,
  VoiceConfig,
} from '../src/shared/contracts'
import { DinoRuntime } from './runtime'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const isDaemon = process.argv.includes('--daemon')
const sessionDataPath = path.join(app.getPath('temp'), 'dinoclaw-session-data')
const DEV_LOAD_RETRIES = 20
const DEV_LOAD_RETRY_DELAY_MS = 250
const DEV_SERVER_FALLBACK = 'http://127.0.0.1:5173/'
const MIME_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
}
app.setPath('sessionData', sessionDataPath)
app.commandLine.appendSwitch('disk-cache-dir', path.join(sessionDataPath, 'cache'))
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache')

// AppImage / Steam Deck: Chromium sandbox often blocks file:// and loopback loads.
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('no-sandbox')
  app.commandLine.appendSwitch('disable-gpu-sandbox')
  app.commandLine.appendSwitch('disable-dev-shm-usage')
}

const singleInstance = app.requestSingleInstanceLock()
if (!singleInstance) {
  app.quit()
}

const runtime = new DinoRuntime()

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let isBootstrapping = false
let packagedRendererServer: Server | null = null
let packagedRendererUrlPromise: Promise<string> | null = null

app.on('second-instance', () => {
  if (isDaemon) return
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
})

function resolvePreloadPath(): string {
  const candidates = [
    path.join(__dirname, 'preload.mjs'),
    path.join(app.getAppPath(), 'dist-electron', 'preload.mjs'),
    path.join(process.resourcesPath, 'app.asar', 'dist-electron', 'preload.mjs'),
  ]
  const found = candidates.find(candidate => fs.existsSync(candidate))
  if (!found) {
    console.error(`[main] Preload script missing. Checked: ${candidates.join(', ')}`)
    return path.join(__dirname, 'preload.mjs')
  }
  console.warn(`[main] Using preload: ${found}`)
  return found
}

async function createWindow(): Promise<void> {
  isBootstrapping = true
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: '#0c1118',
    title: 'DinoClaw',
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      preload: resolvePreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      // Must stay true: preload is CJS (require("electron")) and breaks when sandbox is false.
      sandbox: true,
    },
  })
  mainWindow = win

  win.setMenuBarVisibility(false)
  attachRendererDiagnostics(win)
  win.on('close', (e) => {
    if (tray && !isQuitting) {
      e.preventDefault()
      win.hide()
    }
  })

  const devServerUrl = !app.isPackaged
    ? (process.env.VITE_DEV_SERVER_URL || process.env.ELECTRON_RENDERER_URL || DEV_SERVER_FALLBACK)
    : undefined
  try {
    await loadRenderer(win, devServerUrl)
    if (!win.isDestroyed()) {
      win.show()
      win.focus()
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown renderer load error'
    console.error(`[main] Failed to load renderer: ${message}`)
    await loadBootstrapError(win, message)
    if (!win.isDestroyed()) win.show()
  } finally {
    isBootstrapping = false
  }
}

function createTray(): void {
  const iconPath = resolvePackagedAssetPath('dino.svg') ?? path.join(__dirname, '../public/dino.svg')
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

function resolvePackagedAssetPath(asset: string): string | null {
  const candidates = [
    path.join(process.resourcesPath, 'dist', asset),
    path.join(app.getAppPath(), 'dist', asset),
    path.join(__dirname, '../dist', asset),
    path.join(__dirname, '../public', asset),
  ]
  return candidates.find(candidate => fs.existsSync(candidate)) ?? null
}

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media')
  })
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    return permission === 'media'
  })

  // Core
  ipcMain.handle('dinoclaw:getSnapshot', () => runtime.getSnapshot())
  ipcMain.handle('dinoclaw:updateCreed', (_e, creed: DinoCreed) => runtime.updateCreed(creed))
  ipcMain.handle('dinoclaw:updateModel', (_e, model: ModelSettings) => runtime.updateModel(model))
  ipcMain.handle('dinoclaw:updatePolicy', (_e, policy: ExecutionPolicy) => runtime.updatePolicy(policy))
  ipcMain.handle('dinoclaw:runGoal', (_e, request: GoalRequest) => runtime.runGoal(request))
  ipcMain.handle('dinoclaw:approveToolUse', (_e, runId: string, stepId: string, approved: boolean) =>
    runtime.resolveApproval(runId, stepId, approved),
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
    runtime.updateDockerConfig(config))

  // Browser
  ipcMain.handle('dinoclaw:updateBrowser', (_e, config: BrowserConfig) =>
    runtime.updateBrowserConfig(config))
  ipcMain.handle('dinoclaw:updateVoice', (_e, config: Partial<VoiceConfig>) =>
    runtime.updateVoiceConfig(config))
  ipcMain.handle('dinoclaw:transcribeAudio', (_e, audio: ArrayBuffer, mimeType: string) =>
    runtime.transcribeAudio(Buffer.from(audio), mimeType))
  ipcMain.handle('dinoclaw:transcribePcm', (_e, audio: ArrayBuffer, sampleRate: number) => {
    const samples = audio instanceof ArrayBuffer
      ? new Float32Array(audio)
      : new Float32Array(audio as ArrayBuffer)
    return runtime.transcribePcm(samples, sampleRate)
  })
  ipcMain.handle('dinoclaw:speakText', (_e, text: string) => runtime.speakText(text))
  ipcMain.handle('dinoclaw:stopSpeech', () => { runtime.stopSpeech() })
  ipcMain.handle('dinoclaw:prepareVoice', () => runtime.prepareVoice())
  ipcMain.handle('dinoclaw:getVoiceStatus', () => runtime.getVoiceStatus())
  ipcMain.handle('dinoclaw:getAppVersion', () => runtime.getAppVersion())
  ipcMain.handle('dinoclaw:getBrowserSession', () => runtime.getBrowserSessionInfo())
  ipcMain.handle('dinoclaw:clearBrowserSession', () => runtime.clearBrowserSession())

  // Service
  ipcMain.handle('dinoclaw:getServiceStatus', () => runtime.getServiceStatus())
  ipcMain.handle('dinoclaw:installService', () => runtime.installService())
  ipcMain.handle('dinoclaw:uninstallService', () => runtime.uninstallService())

  // Dino Stomp
  ipcMain.handle('dinoclaw:updateStompConfig', (_e, config: Partial<StompConfig>) =>
    runtime.updateStompConfig(config))
  ipcMain.handle('dinoclaw:dismissStomp', (_e, id: string) => runtime.dismissStomp(id))
  ipcMain.handle('dinoclaw:engageStomp', (_e, id: string) => runtime.engageStomp(id))
  ipcMain.handle('dinoclaw:stompNow', () => runtime.stompNow())
  ipcMain.handle('dinoclaw:stompTidyNow', () => runtime.stompTidyNow())
  ipcMain.handle('dinoclaw:previewTidyFolders', () => runtime.previewTidyFolders())
  ipcMain.handle('dinoclaw:openStompFolder', (_e, folderPath: string) => runtime.openStompFolder(folderPath))
  ipcMain.handle('dinoclaw:openStompNotesDirectory', () => runtime.openStompNotesDirectory())
  ipcMain.handle('dinoclaw:undoStomp', (_e, id: string) => runtime.undoStomp(id))
  ipcMain.handle('dinoclaw:recordStompActivity', () => runtime.recordStompUserActivity())
  ipcMain.handle('dinoclaw:getLinkSetup', () => runtime.getLinkSetup())

  if (isDaemon) {
    void runtime.bootstrapNest({ daemon: true })
    return
  }

  createTray()
  await createWindow()

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow().catch(error => {
        console.error(`[main] Failed to recreate window: ${error instanceof Error ? error.message : String(error)}`)
      })
    } else {
      mainWindow?.show()
      mainWindow?.focus()
    }
  })
}).catch(error => {
  console.error(`[main] Startup failed: ${error instanceof Error ? error.message : String(error)}`)
  app.quit()
})

app.on('window-all-closed', () => {
  if (isDaemon || isBootstrapping) return
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => { isQuitting = true })
app.on('will-quit', () => {
  packagedRendererServer?.close()
  packagedRendererServer = null
})

async function loadRenderer(win: BrowserWindow, devServerUrl?: string): Promise<void> {
  if (!devServerUrl) {
    await loadPackagedRenderer(win)
    return
  }

  const target = normalizeDevServerUrl(devServerUrl)
  let lastError: unknown

  for (let attempt = 1; attempt <= DEV_LOAD_RETRIES; attempt++) {
    try {
      await win.loadURL(target)
      return
    } catch (error) {
      lastError = error
      const message = error instanceof Error ? error.message : String(error)
      const retryable = /ERR_FAILED|ERR_CONNECTION_REFUSED|ERR_ABORTED|ERR_TIMED_OUT/i.test(message)
      if (!retryable || attempt === DEV_LOAD_RETRIES) break
      await delay(DEV_LOAD_RETRY_DELAY_MS)
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`Unable to load renderer URL: ${target}`)
}

async function loadPackagedRenderer(win: BrowserWindow): Promise<void> {
  const indexPath = resolveRendererIndexPath()
  if (!indexPath) {
    throw new Error(`Production UI missing. Checked: ${rendererIndexCandidates().join(', ')}`)
  }

  // Steam Deck / AppImage: file:// loads fail (ERR_FAILED) and can destroy the window
  // before later fallbacks run. Loopback HTTP is the reliable path.
  if (process.platform === 'linux') {
    await loadPackagedRendererViaLocalhost(win)
    return
  }

  const attempts: Array<() => Promise<void>> = [
    async () => {
      console.warn(`[main] Loading packaged renderer via loadFile: ${indexPath}`)
      await win.loadFile(indexPath)
    },
    async () => {
      const extractedDir = extractRendererForFallback(indexPath)
      const extractedIndex = path.join(extractedDir, 'index.html')
      console.warn(`[main] Loading packaged renderer from extracted copy: ${extractedIndex}`)
      await win.loadFile(extractedIndex)
    },
  ]

  let lastError: unknown
  for (const attempt of attempts) {
    if (win.isDestroyed()) {
      throw new Error(`Renderer window was destroyed while loading ${indexPath}`)
    }
    try {
      await attempt()
      return
    } catch (error) {
      lastError = error
      console.error(`[main] Packaged renderer attempt failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Unable to load packaged renderer from ${indexPath}`)
}

async function loadPackagedRendererViaLocalhost(win: BrowserWindow): Promise<void> {
  const indexPath = resolveRendererIndexPath()
  if (!indexPath) {
    throw new Error(`Production UI missing. Checked: ${rendererIndexCandidates().join(', ')}`)
  }

  const attempts: Array<() => Promise<void>> = [
    async () => {
      const url = await ensurePackagedRendererServer()
      await verifyPackagedRendererServer(url)
      console.warn(`[main] Loading packaged renderer via localhost: ${url}`)
      await win.loadURL(url)
    },
    async () => {
      const extractedDir = extractRendererForFallback(indexPath)
      const url = await ensurePackagedRendererServer(extractedDir)
      await verifyPackagedRendererServer(url)
      console.warn(`[main] Loading extracted renderer via localhost: ${url}`)
      await win.loadURL(url)
    },
  ]

  let lastError: unknown
  for (const attempt of attempts) {
    if (win.isDestroyed()) {
      throw new Error('Renderer window was destroyed while loading packaged UI')
    }
    try {
      await attempt()
      return
    } catch (error) {
      lastError = error
      console.error(`[main] Packaged renderer attempt failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Unable to load packaged renderer from ${indexPath}`)
}

function rendererIndexCandidates(): string[] {
  return [
    path.join(process.resourcesPath, 'dist', 'index.html'),
    path.join(app.getAppPath(), 'dist', 'index.html'),
    path.join(__dirname, '../dist/index.html'),
    path.join(process.resourcesPath, 'app.asar', 'dist', 'index.html'),
    path.join(process.resourcesPath, 'app', 'dist', 'index.html'),
  ]
}

function resolveRendererIndexPath(): string | null {
  return rendererIndexCandidates().find(candidate => fs.existsSync(candidate)) ?? null
}

function resolvePackagedRendererDirForServer(): string {
  const resourceDist = path.join(process.resourcesPath, 'dist')
  if (fs.existsSync(path.join(resourceDist, 'index.html'))) return resourceDist

  const indexPath = resolveRendererIndexPath()
  if (!indexPath) {
    throw new Error(`Production UI missing. Checked: ${rendererIndexCandidates().join(', ')}`)
  }
  return extractRendererForFallback(indexPath)
}

function ensurePackagedRendererServer(rendererDir?: string): Promise<string> {
  if (!rendererDir && packagedRendererUrlPromise) return packagedRendererUrlPromise

  const startServer = (): Promise<string> => new Promise((resolve, reject) => {
    const dir = rendererDir ?? resolvePackagedRendererDirForServer()
    const server = createServer((req, res) => serveRendererFile(dir, req.url, res))

    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo
      if (!rendererDir) packagedRendererServer = server
      resolve(`http://127.0.0.1:${address.port}/`)
    })
  })

  if (rendererDir) return startServer()

  packagedRendererUrlPromise = startServer()
  return packagedRendererUrlPromise
}

function verifyPackagedRendererServer(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = httpGet(url, (response) => {
      response.resume()
      if (response.statusCode && response.statusCode >= 200 && response.statusCode < 400) {
        resolve()
        return
      }
      reject(new Error(`Renderer server health check failed (${response.statusCode ?? 'unknown'}) for ${url}`))
    })
    request.on('error', reject)
    request.setTimeout(5000, () => {
      request.destroy(new Error(`Renderer server health check timed out for ${url}`))
    })
  })
}

function serveRendererFile(rendererDir: string, requestUrl: string | undefined, res: ServerResponse): void {
  let pathname = '/'
  try {
    pathname = new URL(requestUrl ?? '/', 'http://127.0.0.1').pathname
  } catch {
    pathname = '/'
  }

  const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '')
  if (relative.includes('..') || path.isAbsolute(relative)) {
    res.writeHead(403)
    res.end('Forbidden')
    return
  }

  const filePath = path.join(rendererDir, relative)
  if (!filePath.startsWith(rendererDir + path.sep) && filePath !== rendererDir) {
    res.writeHead(403)
    res.end('Forbidden')
    return
  }

  fs.stat(filePath, (statError, stat) => {
    if (statError || !stat.isFile()) {
      res.writeHead(404)
      res.end('Not found')
      return
    }

    res.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Type': MIME_TYPES[path.extname(filePath)] ?? 'application/octet-stream',
    })
    fs.createReadStream(filePath)
      .on('error', () => {
        if (!res.headersSent) res.writeHead(500)
        res.end('Read error')
      })
      .pipe(res)
  })
}

function extractRendererForFallback(indexPath: string): string {
  const sourceDir = path.dirname(indexPath)
  const targetDir = path.join(app.getPath('userData'), 'renderer-fallback')
  fs.rmSync(targetDir, { recursive: true, force: true })
  fs.mkdirSync(targetDir, { recursive: true })

  for (const entry of ['index.html', 'dino.svg', 'assets', 'ort', 'whisper-models', 'link', 'link-manifest.webmanifest', 'link-sw.js']) {
    const source = path.join(sourceDir, entry)
    if (fs.existsSync(source)) copyPath(source, path.join(targetDir, entry))
  }

  const extractedIndex = path.join(targetDir, 'index.html')
  if (!fs.existsSync(extractedIndex)) {
    throw new Error(`Could not extract renderer fallback from ${sourceDir}`)
  }
  console.warn(`[main] Extracted renderer fallback: ${targetDir}`)
  return targetDir
}

function copyPath(source: string, target: string): void {
  const stat = fs.statSync(source)
  if (stat.isDirectory()) {
    fs.mkdirSync(target, { recursive: true })
    for (const entry of fs.readdirSync(source)) {
      copyPath(path.join(source, entry), path.join(target, entry))
    }
    return
  }
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.copyFileSync(source, target)
}

function normalizeDevServerUrl(url: string): string {
  try {
    const parsed = new URL(url)
    if (!parsed.pathname) {
      parsed.pathname = '/'
    }
    return parsed.toString()
  } catch {
    return url
  }
}

async function loadBootstrapError(win: BrowserWindow | null, message: string): Promise<void> {
  const target = win && !win.isDestroyed() ? win : mainWindow
  if (!target || target.isDestroyed()) {
    console.error(`[main] Startup error (no window to display): ${message}`)
    return
  }
  try {
    await target.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(renderBootstrapErrorHtml(message))}`)
  } catch (error) {
    console.error(`[main] Failed to render bootstrap error: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function renderBootstrapErrorHtml(message: string): string {
  return [
    '<!doctype html>',
    '<html>',
    '<head><meta charset="utf-8"><title>DinoClaw - Startup Error</title></head>',
    '<body style="background:#0c1118;color:#e5ebff;font-family:Segoe UI,Arial,sans-serif;padding:24px;line-height:1.45;">',
    '<h2 style="margin-top:0;">DinoClaw could not load the UI.</h2>',
    '<p>Try reinstalling from the latest release, or run from a terminal with <code>--no-sandbox</code> on Steam Deck.</p>',
    `<pre style="white-space:pre-wrap;background:#111826;padding:12px;border-radius:8px;">${escapeHtml(message)}</pre>`,
    '</body>',
    '</html>',
  ].join('')
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function attachRendererDiagnostics(win: BrowserWindow): void {
  if (app.isPackaged && process.platform !== 'linux') return

  win.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error(`[main] Preload failed (${preloadPath}): ${error.message}`)
  })

  win.webContents.on('console-message', (_event, level, message) => {
    console.log(`[renderer:${level}] ${message}`)
  })

  win.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.error(`[renderer] Failed to load ${url} (${code}): ${description}`)
  })

  win.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[renderer] Process gone: ${details.reason}`)
  })
}
