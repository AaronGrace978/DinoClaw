import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { ModelSettings } from '../src/shared/contracts'
import { transcribeBuiltInWhisper } from './voice-stt-local'

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

async function transcribeViaLocalWhisperCli(audio: Buffer, mimeType: string): Promise<string> {
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

export async function transcribePcm(
  pcm: Float32Array,
  sampleRate: number,
  settings: ModelSettings,
): Promise<string> {
  if (!pcm.length) throw new Error('No audio captured.')

  const errors: string[] = []
  const apiKey = settings.apiKey?.trim() ?? ''

  try {
    return await transcribeBuiltInWhisper(pcm, sampleRate)
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error))
  }

  if (apiKey && settings.provider === 'groq') {
    try {
      const wav = encodeWav16(pcm, sampleRate)
      const text = await transcribeViaGroq(wav, 'audio/wav', apiKey)
      if (text) return text
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }

  if (apiKey && (settings.provider === 'openai-compatible' || settings.provider === 'openrouter')) {
    try {
      const wav = encodeWav16(pcm, sampleRate)
      const text = await transcribeViaOpenAiCompatible(wav, 'audio/wav', settings)
      if (text) return text
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }

  try {
    const wav = encodeWav16(pcm, sampleRate)
    return await transcribeViaLocalWhisperCli(wav, 'audio/wav')
  } catch (error) {
    if (error instanceof Error && error.message !== 'local_whisper_unavailable') {
      errors.push(error.message)
    }
  }

  throw new Error(
    'Could not understand your voice. Tap the mic, speak, tap again. '
    + (errors.length ? `Details: ${errors.slice(0, 2).join(' | ')}` : ''),
  )
}

export async function transcribeSpeech(
  audio: Buffer,
  mimeType: string,
  settings: ModelSettings,
): Promise<string> {
  if (!audio.length) throw new Error('No audio captured.')

  const pcm = decodeWav16ToFloat32(audio)
  if (pcm) return transcribePcm(pcm.samples, pcm.sampleRate, settings)

  const errors: string[] = []
  const apiKey = settings.apiKey?.trim() ?? ''

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
    return await transcribeViaLocalWhisperCli(audio, mimeType)
  } catch (error) {
    if (error instanceof Error && error.message === 'local_whisper_unavailable') {
      errors.push('Local whisper CLI not found.')
    } else {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }

  throw new Error(
    'Could not understand your voice. Tap the mic, speak, tap again. '
    + (errors.length ? `Details: ${errors.join(' | ')}` : ''),
  )
}

function encodeWav16(samples: Float32Array, sampleRate: number): Buffer {
  const buffer = Buffer.alloc(44 + samples.length * 2)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + samples.length * 2, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(samples.length * 2, 40)
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i] ?? 0))
    buffer.writeInt16LE(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, 44 + i * 2)
  }
  return buffer
}

function decodeWav16ToFloat32(buffer: Buffer): { samples: Float32Array; sampleRate: number } | null {
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF') return null
  const sampleRate = buffer.readUInt32LE(24)
  const bitsPerSample = buffer.readUInt16LE(34)
  const numChannels = buffer.readUInt16LE(22)
  if (bitsPerSample !== 16 || numChannels !== 1) return null
  const dataOffset = 44
  const sampleCount = Math.floor((buffer.length - dataOffset) / 2)
  const samples = new Float32Array(sampleCount)
  for (let i = 0; i < sampleCount; i += 1) {
    samples[i] = buffer.readInt16LE(dataOffset + i * 2) / 0x8000
  }
  return { samples, sampleRate }
}
