#!/usr/bin/env node
/**
 * Copy offline voice assets into public/ so the Electron RENDERER can load them
 * via fetch/file URL with ONNX WASM — no main-process native ONNX, no network.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { env, pipeline } from '@huggingface/transformers'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const buildModels = path.join(root, 'build', 'whisper-models')
const publicModels = path.join(root, 'public', 'whisper-models')
const publicOrt = path.join(root, 'public', 'ort')
const marker = path.join(buildModels, 'Xenova', 'whisper-tiny.en', 'onnx', 'encoder_model_quantized.onnx')

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name)
    const to = path.join(dest, entry.name)
    if (entry.isDirectory()) copyDir(from, to)
    else fs.copyFileSync(from, to)
  }
}

if (!fs.existsSync(marker)) {
  console.log('[voice-assets] Downloading whisper-tiny.en into build/…')
  env.cacheDir = buildModels
  env.allowLocalModels = true
  env.allowRemoteModels = true
  await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en', { dtype: 'q8' })
}

console.log('[voice-assets] Copying whisper model → public/whisper-models')
fs.rmSync(publicModels, { recursive: true, force: true })
copyDir(buildModels, publicModels)

const ortSrc = path.join(root, 'node_modules', 'onnxruntime-web', 'dist')
const ortFiles = [
  'ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.jsep.wasm',
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.jsep.mjs',
]
fs.mkdirSync(publicOrt, { recursive: true })
for (const file of ortFiles) {
  const src = path.join(ortSrc, file)
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(publicOrt, file))
    console.log('[voice-assets] ort/', file)
  }
}

console.log('[voice-assets] Ready for offline renderer voice')
