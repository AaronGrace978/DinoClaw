import { type ChildProcess, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'

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

function stopActiveSpeak(): void {
  if (!activeSpeak) return
  try { activeSpeak.kill('SIGTERM') } catch { /* already dead */ }
  activeSpeak = null
}

function spawnSpeak(cmd: string, args: string[]): Promise<void> {
  stopActiveSpeak()
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'ignore' })
    activeSpeak = child
    child.on('error', reject)
    child.on('close', (code) => {
      if (activeSpeak === child) activeSpeak = null
      if (code === 0 || code === null) resolve()
      else reject(new Error(`${cmd} exited with code ${code}`))
    })
  })
}

async function speakLinux(text: string): Promise<void> {
  if (await commandExists('spd-say')) {
    await spawnSpeak('spd-say', [text])
    return
  }
  if (await commandExists('espeak-ng')) {
    await spawnSpeak('espeak-ng', ['-s', '165', '-v', 'en-us', text])
    return
  }
  if (await commandExists('espeak')) {
    await spawnSpeak('espeak', ['-s', '165', '-v', 'en-us', text])
    return
  }
  if (await commandExists('festival')) {
    await spawnSpeak('bash', ['-lc', `printf '%s' ${JSON.stringify(text)} | festival --tts`])
    return
  }
  throw new Error(
    'No system voice found. On Steam Deck run: sudo pacman -S espeak-ng',
  )
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
