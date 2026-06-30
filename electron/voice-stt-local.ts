import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

export type VoicePreparePhase = 'idle' | 'starting' | 'downloading' | 'loading' | 'ready' | 'error'

export interface VoicePrepareProgress {
  phase: VoicePreparePhase
  message: string
  progress?: number
  file?: string
}

type WhisperPipeline = (
  audio: Float32Array,
  options: { sampling_rate: number; language?: string; task?: string },
) => Promise<{ text: string }>

const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000
const MODEL_ID = 'Xenova/whisper-tiny.en'
const MODEL_MARKER_FILES = [
  path.join('onnx', 'encoder_model_quantized.onnx'),
  path.join('onnx', 'decoder_model_merged_quantized.onnx'),
]

let pipelinePromise: Promise<WhisperPipeline> | null = null
let loadError: string | null = null
let onProgress: ((progress: VoicePrepareProgress) => void) | null = null

function bundledModelDir(): string | null {
  if (!app.isPackaged) return null
  const bundled = path.join(process.resourcesPath, 'whisper-models')
  const modelDir = path.join(bundled, 'Xenova', 'whisper-tiny.en')
  return MODEL_MARKER_FILES.every(file => fs.existsSync(path.join(modelDir, file))) ? bundled : null
}

function modelCacheDir(): string {
  return bundledModelDir() ?? path.join(app.getPath('userData'), 'whisper-models')
}

function modelIsBundled(): boolean {
  return bundledModelDir() !== null
}

function report(progress: VoicePrepareProgress): void {
  onProgress?.(progress)
}

export function setWhisperProgressHandler(
  handler: ((progress: VoicePrepareProgress) => void) | null,
): void {
  onProgress = handler
}

export function isWhisperModelReady(): boolean {
  return pipelinePromise !== null && loadError === null
}

export function resetWhisperPipeline(): void {
  pipelinePromise = null
  loadError = null
}

export async function prepareWhisperModel(): Promise<void> {
  await getWhisperPipeline()
}

async function getWhisperPipeline(): Promise<WhisperPipeline> {
  if (loadError) {
    // Let the operator retry after a failed download without restarting the app.
    resetWhisperPipeline()
  }
  if (pipelinePromise) return pipelinePromise

  pipelinePromise = (async () => {
    const offline = modelIsBundled()
    report({
      phase: 'starting',
      message: offline
        ? 'Loading built-in speech model…'
        : 'Starting speech engine…',
    })

    try {
      const { env, pipeline } = await import('@huggingface/transformers')
      const cacheDir = modelCacheDir()
      env.cacheDir = cacheDir
      env.allowLocalModels = true
      env.allowRemoteModels = !offline

      const progressCallback = (info: {
        status: string
        file?: string
        progress?: number
      }) => {
        if (offline) return
        if (info.status === 'progress' && typeof info.progress === 'number') {
          report({
            phase: 'downloading',
            message: `Downloading speech model… ${Math.round(info.progress)}%`,
            progress: info.progress,
            file: info.file,
          })
          return
        }
        if (info.status === 'download' || info.status === 'initiate') {
          report({
            phase: 'downloading',
            message: info.file
              ? `Downloading ${info.file}… (first time only, ~40 MB — can take several minutes on Wi‑Fi)`
              : 'Downloading speech model… (first time only, ~40 MB — please wait)',
            file: info.file,
          })
          return
        }
        if (info.status === 'done') {
          report({
            phase: 'loading',
            message: 'Finishing model setup…',
            file: info.file,
          })
        }
      }

      report({
        phase: 'loading',
        message: offline
          ? 'Loading built-in speech model…'
          : 'Loading speech model…',
        progress: offline ? 100 : undefined,
      })

      const loadModel = pipeline(
        'automatic-speech-recognition',
        MODEL_ID,
        { dtype: 'q8', progress_callback: progressCallback },
      )

      const timeout = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(
            'Speech model setup timed out. Quit DinoClaw, reopen it, and toggle Talk Mode on again.',
          ))
        }, DOWNLOAD_TIMEOUT_MS)
      })

      const transcriber = await Promise.race([loadModel, timeout]) as WhisperPipeline

      report({
        phase: 'ready',
        message: 'Speech model ready — tap mic and talk.',
        progress: 100,
      })

      return transcriber
    } catch (error) {
      loadError = error instanceof Error ? error.message : String(error)
      pipelinePromise = null
      report({
        phase: 'error',
        message: loadError,
      })
      throw error
    }
  })()

  return pipelinePromise
}

function normalizeTranscript(text: string): string {
  return text
    .replace(/\[BLANK_AUDIO\]/gi, '')
    .replace(/\[[^\]]+\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function transcribeBuiltInWhisper(
  pcm: Float32Array,
  sampleRate: number,
): Promise<string> {
  if (!pcm.length) throw new Error('No audio captured.')
  const transcriber = await getWhisperPipeline()
  const result = await transcriber(pcm, {
    sampling_rate: sampleRate,
  })
  const text = normalizeTranscript(result.text ?? '')
  if (!text) {
    throw new Error('Could not make out any words. Tap the mic, speak clearly, then tap again.')
  }
  return text
}

export function resetWhisperPipelineForTests(): void {
  resetWhisperPipeline()
}
