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
  return () => listeners.delete(listener)
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

export async function prepareRendererVoice(): Promise<VoicePrepareProgress> {
  await getPipeline()
  return currentStatus
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
  const transcriber = await getPipeline()
  const result = await transcriber(pcm, { sampling_rate: sampleRate })
  const text = normalizeTranscript(result.text ?? '')
  if (!text) {
    throw new Error('Could not make out any words. Tap the mic, speak clearly, then tap again.')
  }
  return text
}

export function resetRendererVoiceForTests(): void {
  pipelinePromise = null
  currentStatus = { phase: 'idle', message: 'Turn Talk Mode on to load speech.' }
}
