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
  options: { sampling_rate: number; language: string; task: string },
) => Promise<{ text: string }>

const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000
const MODEL_ID = 'Xenova/whisper-tiny.en'

let pipelinePromise: Promise<WhisperPipeline> | null = null
let loadError: string | null = null
let onProgress: ((progress: VoicePrepareProgress) => void) | null = null

function modelCacheDir(): string {
  return path.join(app.getPath('userData'), 'whisper-models')
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

export async function prepareWhisperModel(): Promise<void> {
  await getWhisperPipeline()
}

async function getWhisperPipeline(): Promise<WhisperPipeline> {
  if (loadError) throw new Error(loadError)
  if (pipelinePromise) return pipelinePromise

  pipelinePromise = (async () => {
    report({
      phase: 'starting',
      message: 'Starting speech engine…',
    })

    try {
      const { env, pipeline } = await import('@huggingface/transformers')
      env.cacheDir = modelCacheDir()
      env.allowLocalModels = true
      env.allowRemoteModels = true

      const progressCallback = (info: {
        status: string
        file?: string
        progress?: number
        loaded?: number
        total?: number
      }) => {
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
              ? `Downloading ${info.file}… (first time only, ~40 MB total — can take several minutes on Wi‑Fi)`
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
        message: 'Loading speech model…',
      })

      const loadModel = pipeline(
        'automatic-speech-recognition',
        MODEL_ID,
        { dtype: 'q8', progress_callback: progressCallback },
      )

      const timeout = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(
            'Speech model download timed out after 10 minutes. '
            + 'Check Wi‑Fi, then toggle Talk Mode off and on to retry.',
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

export async function transcribeBuiltInWhisper(
  pcm: Float32Array,
  sampleRate: number,
): Promise<string> {
  if (!pcm.length) throw new Error('No audio captured.')
  const transcriber = await getWhisperPipeline()
  const result = await transcriber(pcm, {
    sampling_rate: sampleRate,
    language: 'english',
    task: 'transcribe',
  })
  const text = result.text?.trim() ?? ''
  if (!text) throw new Error('Could not make out any words. Try speaking closer to the mic.')
  return text
}

export function resetWhisperPipelineForTests(): void {
  pipelinePromise = null
  loadError = null
}
