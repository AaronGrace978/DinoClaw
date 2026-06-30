import type { VoicePrepareProgress } from '../shared/contracts'

const MODEL_ID = 'Xenova/whisper-tiny.en'

type WhisperFn = (
  audio: Float32Array,
  options: { sampling_rate: number },
) => Promise<{ text: string }>

let pipelinePromise: Promise<WhisperFn> | null = null
let currentStatus: VoicePrepareProgress = {
  phase: 'idle',
  message: 'Turn Talk Mode on to load speech.',
}
const listeners = new Set<(status: VoicePrepareProgress) => void>()

function isDesktopApp(): boolean {
  return typeof window.dinoClaw?.getSnapshot === 'function'
}

function assetUrl(relative: string): string {
  return new URL(relative, window.location.href).href
}

function emit(status: VoicePrepareProgress): void {
  currentStatus = status
  for (const listener of listeners) listener(status)
}

export function onRendererVoiceStatus(listener: (status: VoicePrepareProgress) => void): () => void {
  listeners.add(listener)
  const unsubscribeMain = window.dinoClaw?.onVoiceStatus?.((status) => emit(status))
  return () => {
    listeners.delete(listener)
    unsubscribeMain?.()
  }
}

export function getRendererVoiceStatus(): VoicePrepareProgress {
  return currentStatus
}

export function isRendererVoiceSupported(): boolean {
  return isDesktopApp()
}

async function getPipeline(): Promise<WhisperFn> {
  if (pipelinePromise) return pipelinePromise

  pipelinePromise = (async () => {
    emit({ phase: 'loading', message: 'Loading built-in speech model…', progress: 50 })

    const { env, pipeline } = await import('@huggingface/transformers')
    env.allowLocalModels = true
    env.allowRemoteModels = false
    env.localModelPath = assetUrl('./whisper-models/')
    env.backends.onnx.wasm!.numThreads = Math.min(2, navigator.hardwareConcurrency ?? 1)
    env.backends.onnx.wasm!.wasmPaths = assetUrl('./ort/')

    const transcriber = await pipeline('automatic-speech-recognition', MODEL_ID, {
      dtype: 'q8',
      device: 'wasm',
    })

    emit({
      phase: 'ready',
      message: 'Ready — tap mic, speak, tap again.',
      progress: 100,
    })

    return transcriber as WhisperFn
  })().catch((error) => {
    pipelinePromise = null
    const message = error instanceof Error ? error.message : 'Speech model failed to load.'
    emit({ phase: 'error', message })
    throw error
  })

  return pipelinePromise
}

function canUseMainVoice(): boolean {
  return typeof window.dinoClaw?.prepareVoice === 'function'
    && typeof window.dinoClaw?.transcribePcm === 'function'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function combinedVoiceError(prefix: string, errors: string[]): Error {
  const detail = errors.filter(Boolean).slice(0, 2).join(' | ')
  return new Error(detail ? `${prefix} Details: ${detail}` : prefix)
}

async function prepareMainVoice(): Promise<VoicePrepareProgress> {
  if (!canUseMainVoice()) throw new Error('Desktop speech engine unavailable.')

  try {
    const status = await window.dinoClaw!.getVoiceStatus?.()
    if (status) emit(status)
  } catch {
    // Status is best-effort; prepareVoice below will report the real failure.
  }

  const result = await window.dinoClaw!.prepareVoice()
  emit(result)
  return result
}

export async function prepareRendererVoice(): Promise<VoicePrepareProgress> {
  const errors: string[] = []

  if (canUseMainVoice()) {
    try {
      return await prepareMainVoice()
    } catch (error) {
      errors.push(errorMessage(error))
    }
  }

  try {
    await getPipeline()
    return currentStatus
  } catch (error) {
    errors.push(errorMessage(error))
    throw combinedVoiceError(
      'Speech model setup failed. Reinstall the latest DinoClaw AppImage so the offline voice assets are bundled.',
      errors,
    )
  }
}

function normalizeTranscript(text: string): string {
  return text
    .replace(/\[BLANK_AUDIO\]/gi, '')
    .replace(/\[[^\]]+\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function transcribeRendererPcm(pcm: Float32Array, sampleRate: number): Promise<string> {
  if (!pcm.length) throw new Error('No audio captured.')
  const errors: string[] = []

  if (canUseMainVoice()) {
    try {
      const buf = pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength) as ArrayBuffer
      const text = normalizeTranscript(await window.dinoClaw!.transcribePcm(buf, sampleRate))
      if (text) return text
      errors.push('Desktop speech engine returned an empty transcript.')
    } catch (error) {
      errors.push(errorMessage(error))
    }
  }

  try {
    const transcriber = await getPipeline()
    const result = await transcriber(pcm, { sampling_rate: sampleRate })
    const text = normalizeTranscript(result.text ?? '')
    if (text) return text
    errors.push('Renderer speech engine returned an empty transcript.')
  } catch (error) {
    errors.push(errorMessage(error))
  }

  throw combinedVoiceError(
    'Could not understand your voice. Tap the mic, speak clearly, then tap again.',
    errors,
  )
}

export function resetRendererVoiceForTests(): void {
  pipelinePromise = null
  currentStatus = { phase: 'idle', message: 'Turn Talk Mode on to load speech.' }
}
