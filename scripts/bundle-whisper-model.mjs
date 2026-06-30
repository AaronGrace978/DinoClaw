#!/usr/bin/env node
/**
 * Pre-download Whisper tiny.en into build/whisper-models so the Linux AppImage
 * works offline on Steam Deck — no Hugging Face download on first mic tap.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { env, pipeline } from '@huggingface/transformers'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const modelDir = path.join(root, 'build', 'whisper-models')
const marker = path.join(modelDir, 'Xenova', 'whisper-tiny.en', 'onnx', 'model_quantized.onnx')

if (fs.existsSync(marker)) {
  console.log('[whisper] Model already bundled at', modelDir)
  process.exit(0)
}

env.cacheDir = modelDir
env.allowLocalModels = true
env.allowRemoteModels = true

console.log('[whisper] Downloading Xenova/whisper-tiny.en (~40 MB) into', modelDir)
await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en', { dtype: 'q8' })
console.log('[whisper] Bundle complete')
