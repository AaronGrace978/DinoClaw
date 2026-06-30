import { type ChildProcess, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { app } from 'electron'

const execFileAsync = promisify(execFile)

let activeSpeak: ChildProcess | null = null

async function commandExists(name: string): Promise<boolean> {
  try {
    await execFileAsync('which', [name])
    return true
  } catch {
    return false
  }
}

function espeakBundleRoot(): string {
  if (app.isPackaged) return path.join(process.resourcesPath, 'espeak-ng')
  return path.join(app.getAppPath(), 'build', 'espeak-ng')
}

function bundledEspeakBin(): string | null {
  const bin = path.join(espeakBundleRoot(), 'bin', 'espeak-ng')
  return fs.existsSync(bin) ? bin : null
}

function bundledEspeakEnv(): NodeJS.ProcessEnv {
  const root = espeakBundleRoot()
  const libDir = path.join(root, 'lib')
  const dataDir = path.join(root, 'share', 'espeak-ng-data')
  const prev = process.env.LD_LIBRARY_PATH ?? ''
  const env = {
    ...process.env,
    ...(fs.existsSync(libDir) ? { LD_LIBRARY_PATH: prev ? `${libDir}:${prev}` : libDir } : {}),
    ...(fs.existsSync(dataDir) ? { ESPEAK_DATA_PATH: dataDir } : {}),
  }
  return env
}

function bundledEspeakArgs(text: string): string[] {
  const dataRoot = path.join(espeakBundleRoot(), 'share')
  const dataDir = path.join(dataRoot, 'espeak-ng-data')
  const args = ['-s', '165', '-v', 'en-us', text]
  return fs.existsSync(dataDir) ? [`--path=${dataRoot}`, ...args] : args
}

function stopActiveSpeak(): void {
  if (!activeSpeak) return
  try { activeSpeak.kill('SIGTERM') } catch { /* already dead */ }
  activeSpeak = null
}

function spawnSpeak(cmd: string, args: string[], env: NodeJS.ProcessEnv = process.env): Promise<void> {
  stopActiveSpeak()
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'ignore', env })
    activeSpeak = child
    child.on('error', reject)
    child.on('close', (code) => {
      if (activeSpeak === child) activeSpeak = null
      if (code === 0 || code === null) resolve()
      else reject(new Error(`${path.basename(cmd)} exited with code ${code}`))
    })
  })
}

async function speakLinux(text: string): Promise<void> {
  const args = ['-s', '165', '-v', 'en-us', text]

  // Built into the AppImage — no SteamOS pacman / read-only root needed.
  const bundled = bundledEspeakBin()
  if (bundled) {
    await spawnSpeak(bundled, bundledEspeakArgs(text), bundledEspeakEnv())
    return
  }

  if (await commandExists('espeak-ng')) {
    await spawnSpeak('espeak-ng', args)
    return
  }
  if (await commandExists('espeak')) {
    await spawnSpeak('espeak', args)
    return
  }
  if (await commandExists('spd-say')) {
    await spawnSpeak('spd-say', ['-w', text])
    return
  }
  if (await commandExists('festival')) {
    await spawnSpeak('bash', ['-lc', `printf '%s' ${JSON.stringify(text)} | festival --tts`])
    return
  }
  throw new Error('No voice engine found. Reinstall DinoClaw v0.5.7+ for built-in speech.')
}

async function speakMac(text: string): Promise<void> {
  await spawnSpeak('say', [text])
}

async function speakWindows(text: string): Promise<void> {
  const script = `
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.Speak(${JSON.stringify(text)})
`
  await spawnSpeak('powershell', ['-NoProfile', '-Command', script])
}

export async function speakSystemText(text: string): Promise<void> {
  const clean = text.trim().replace(/\s+/g, ' ').slice(0, 4000)
  if (!clean) return

  if (process.platform === 'darwin') return speakMac(clean)
  if (process.platform === 'win32') return speakWindows(clean)
  return speakLinux(clean)
}

export function stopSystemSpeech(): void {
  stopActiveSpeak()
}
