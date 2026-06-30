import { useCallback, useEffect, useRef, useState } from 'react'
import type { VoiceConfig } from '../shared/contracts'
import { speakIfEnabled, stopSpeech } from '../lib/voice-speak'

const SAMPLE_RATE = 16_000
const MIN_SAMPLES = SAMPLE_RATE * 0.35 // ~350ms minimum speech

function resampleTo16k(samples: Float32Array, fromRate: number): Float32Array {
  if (fromRate === SAMPLE_RATE) return samples
  const ratio = fromRate / SAMPLE_RATE
  const newLength = Math.max(1, Math.floor(samples.length / ratio))
  const out = new Float32Array(newLength)
  for (let i = 0; i < newLength; i += 1) {
    const srcIdx = i * ratio
    const idx = Math.floor(srcIdx)
    const frac = srcIdx - idx
    const a = samples[idx] ?? 0
    const b = samples[idx + 1] ?? a
    out[i] = a + (b - a) * frac
  }
  return out
}

function coerceFloat32Array(samples: Float32Array | ArrayBuffer | number[]): Float32Array {
  if (samples instanceof Float32Array) return samples
  if (samples instanceof ArrayBuffer) return new Float32Array(samples)
  return new Float32Array(samples)
}

function isDesktopApp(): boolean {
  return typeof window.dinoClaw?.getSnapshot === 'function'
}

function canTranscribeOnDesktop(): boolean {
  return typeof window.dinoClaw?.transcribePcm === 'function'
    || typeof window.dinoClaw?.transcribeAudio === 'function'
}

export interface UseVoiceModeOptions {
  config: VoiceConfig
  talkMode: boolean
  disabled?: boolean
  onFinalTranscript: (text: string) => void
}

export interface UseVoiceModeResult {
  supported: boolean
  needsUpdate: boolean
  recording: boolean
  transcribing: boolean
  error: string | null
  toggleRecording: () => void
  speak: (text: string) => void
  stopSpeaking: () => void
}

async function transcribeSamples(samples: Float32Array): Promise<string> {
  const pcm = coerceFloat32Array(samples)
  if (typeof window.dinoClaw.transcribePcm === 'function') {
    const buf = pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength) as ArrayBuffer
    return window.dinoClaw.transcribePcm(buf, SAMPLE_RATE)
  }
  const wav = encodeWav(pcm, SAMPLE_RATE)
  return window.dinoClaw.transcribeAudio(wav.buffer.slice(0) as ArrayBuffer, 'audio/wav')
}

function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const writeStr = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i))
  }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeStr(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i] ?? 0))
    view.setInt16(44 + i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true)
  }
  return new Uint8Array(buffer)
}

export function useVoiceMode({
  config,
  talkMode,
  disabled = false,
  onFinalTranscript,
}: UseVoiceModeOptions): UseVoiceModeResult {
  const desktop = isDesktopApp()
  const needsUpdate = desktop && !canTranscribeOnDesktop()
  const supported = desktop ? canTranscribeOnDesktop() : false

  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onFinalRef = useRef(onFinalTranscript)
  const streamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const captureRateRef = useRef(SAMPLE_RATE)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const samplesRef = useRef<number[]>([])
  const recordingRef = useRef(false)

  useEffect(() => { onFinalRef.current = onFinalTranscript }, [onFinalTranscript])

  const cleanupCapture = useCallback(() => {
    processorRef.current?.disconnect()
    processorRef.current = null
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
    void audioContextRef.current?.close()
    audioContextRef.current = null
    samplesRef.current = []
    recordingRef.current = false
    setRecording(false)
  }, [])

  const stopRecordingAndTranscribe = useCallback(async () => {
    recordingRef.current = false
    setRecording(false)
    processorRef.current?.disconnect()
    processorRef.current = null

    const raw = samplesRef.current
    samplesRef.current = []
    const minRawSamples = Math.ceil(MIN_SAMPLES * (captureRateRef.current / SAMPLE_RATE))
    if (raw.length < minRawSamples) {
      setError('Didn\'t catch that — tap the mic, speak, then tap again.')
      return
    }

    const pcm = resampleTo16k(new Float32Array(raw), captureRateRef.current)
    if (pcm.length < MIN_SAMPLES) {
      setError('Didn\'t catch that — tap the mic, speak, then tap again.')
      return
    }

    setTranscribing(true)
    try {
      const text = (await transcribeSamples(pcm)).trim()
      if (text) onFinalRef.current(text)
      else setError('Could not make out any words. Try speaking closer to the mic.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transcription failed.')
    } finally {
      setTranscribing(false)
    }
  }, [])

  const startRecording = useCallback(async () => {
    if (!supported || !config.enabled || !config.inputEnabled || disabled || transcribing) return

    samplesRef.current = []

    try {
      if (!streamRef.current) {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
        })
        streamRef.current = stream
      }

      const audioContext = audioContextRef.current ?? new AudioContext()
      audioContextRef.current = audioContext
      captureRateRef.current = audioContext.sampleRate
      if (audioContext.state === 'suspended') await audioContext.resume()

      const source = audioContext.createMediaStreamSource(streamRef.current)
      const processor = audioContext.createScriptProcessor(4096, 1, 1)
      processor.onaudioprocess = (event) => {
        if (!recordingRef.current) return
        const input = event.inputBuffer.getChannelData(0)
        samplesRef.current.push(...input)
      }
      source.connect(processor)
      processor.connect(audioContext.destination)
      processorRef.current = processor
      recordingRef.current = true
      setRecording(true)
    } catch (err) {
      cleanupCapture()
      setError(err instanceof Error ? err.message : 'Microphone access failed.')
    }
  }, [cleanupCapture, config.enabled, config.inputEnabled, disabled, supported, transcribing])

  const toggleRecording = useCallback(() => {
    if (recordingRef.current) void stopRecordingAndTranscribe()
    else void startRecording()
  }, [startRecording, stopRecordingAndTranscribe])

  useEffect(() => {
    if (!talkMode || !config.enabled || !config.inputEnabled || disabled) {
      if (recordingRef.current) void stopRecordingAndTranscribe()
      else cleanupCapture()
    }
  }, [talkMode, config.enabled, config.inputEnabled, disabled, cleanupCapture, stopRecordingAndTranscribe])

  useEffect(() => () => {
    cleanupCapture()
    window.speechSynthesis.cancel()
  }, [cleanupCapture])

  const speak = useCallback((text: string) => {
    if (!config.enabled || !config.outputEnabled || !text.trim()) return
    void speakIfEnabled(config, text, { current: '' })
  }, [config])

  const stopSpeaking = useCallback(() => {
    stopSpeech()
  }, [])

  return {
    supported,
    needsUpdate,
    recording,
    transcribing,
    error,
    toggleRecording,
    speak,
    stopSpeaking,
  }
}
