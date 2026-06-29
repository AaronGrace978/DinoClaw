import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { ModelSettings } from '../src/shared/contracts'

const execFileAsync = promisify(execFile)

const GROQ_WHISPER_URL = 'https://api.groq.com/openai/v1/audio/transcriptions'
const GROQ_WHISPER_MODEL = 'whisper-large-v3-turbo'

function extensionForMime(mimeType: string): string {
  if (mimeType.includes('wav')) return 'wav'
  if (mimeType.includes('ogg')) return 'ogg'
  if (mimeType.includes('mp4') || mimeType.includes('m4a')) return 'm4a'
  return 'webm'
}

async function transcribeViaGroq(audio: Buffer, mimeType: string, apiKey: string): Promise<string> {
  const ext = extensionForMime(mimeType)
  const form = new FormData()
  form.append('file', new Blob([audio], { type: mimeType || 'audio/webm' }), `speech.${ext}`)
  form.append('model', GROQ_WHISPER_MODEL)
  form.append('language', 'en')
  form.append('response_format', 'json')

  const response = await fetch(GROQ_WHISPER_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Groq speech-to-text failed (${response.status}): ${body.slice(0, 200)}`)
  }

  const data = (await response.json()) as { text?: string }
  return data.text?.trim() ?? ''
}

async function transcribeViaOpenAiCompatible(
  audio: Buffer,
  mimeType: string,
  settings: ModelSettings,
): Promise<string> {
  const base = settings.baseUrl.replace(/\/$/, '')
  const ext = extensionForMime(mimeType)
  const form = new FormData()
  form.append('file', new Blob([audio], { type: mimeType || 'audio/webm' }), `speech.${ext}`)
  form.append('model', 'whisper-1')
  form.append('language', 'en')
  form.append('response_format', 'json')

  const response = await fetch(`${base}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${settings.apiKey}` },
    body: form,
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Speech-to-text failed (${response.status}): ${body.slice(0, 200)}`)
  }

  const data = (await response.json()) as { text?: string }
  return data.text?.trim() ?? ''
}

async function commandExists(name: string): Promise<boolean> {
  try {
    await execFileAsync('which', [name])
    return true
  } catch {
    return false
  }
}

async function transcribeViaLocalWhisper(audio: Buffer, mimeType: string): Promise<string> {
  const ext = extensionForMime(mimeType)
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dinoclaw-voice-'))
  const inputPath = path.join(tmpDir, `clip.${ext}`)
  fs.writeFileSync(inputPath, audio)

  try {
    if (await commandExists('whisper')) {
      await execFileAsync('whisper', [
        inputPath,
        '--model', 'tiny.en',
        '--language', 'en',
        '--output_format', 'txt',
        '--output_dir', tmpDir,
        '--fp16', 'False',
      ], { timeout: 120_000 })
      const base = path.basename(inputPath, path.extname(inputPath))
      const txtPath = path.join(tmpDir, `${base}.txt`)
      if (fs.existsSync(txtPath)) {
        const trimmed = fs.readFileSync(txtPath, 'utf8').trim()
        if (trimmed) return trimmed
      }
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }

  throw new Error('local_whisper_unavailable')
}

export async function transcribeSpeech(
  audio: Buffer,
  mimeType: string,
  settings: ModelSettings,
): Promise<string> {
  if (!audio.length) throw new Error('No audio captured.')

  const apiKey = settings.apiKey?.trim() ?? ''
  const errors: string[] = []

  if (apiKey && settings.provider === 'groq') {
    try {
      const text = await transcribeViaGroq(audio, mimeType, apiKey)
      if (text) return text
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }

  if (apiKey && (settings.provider === 'openai-compatible' || settings.provider === 'openrouter')) {
    try {
      const text = await transcribeViaOpenAiCompatible(audio, mimeType, settings)
      if (text) return text
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }

  try {
    return await transcribeViaLocalWhisper(audio, mimeType)
  } catch (error) {
    if (error instanceof Error && error.message === 'local_whisper_unavailable') {
      errors.push('Local whisper CLI not found.')
    } else {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }

  throw new Error(
    'Could not transcribe speech. Add a Groq API key in Settings (free tier works), '
    + 'or install local Whisper: pip install openai-whisper. '
    + (errors.length ? `Details: ${errors.join(' | ')}` : ''),
  )
}
