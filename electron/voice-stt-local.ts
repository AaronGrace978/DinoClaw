import path from 'node:path'
import { app } from 'electron'

type WhisperPipeline = (
  audio: Float32Array,
  options: { sampling_rate: number; language: string; task: string },
) => Promise<{ text: string }>

let pipelinePromise: Promise<WhisperPipeline> | null = null
let loadError: string | null = null

function modelCacheDir(): string {
  return path.join(app.getPath('userData'), 'whisper-models')
}

async function getWhisperPipeline(): Promise<WhisperPipeline> {
  if (loadError) throw new Error(loadError)
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      try {
        const { env, pipeline } = await import('@huggingface/transformers')
        env.cacheDir = modelCacheDir()
        env.allowLocalModels = true
        env.allowRemoteModels = true
        return await pipeline(
          'automatic-speech-recognition',
          'Xenova/whisper-tiny.en',
          { dtype: 'q8' },
        ) as WhisperPipeline
      } catch (error) {
        loadError = error instanceof Error ? error.message : String(error)
        throw error
      }
    })()
  }
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
