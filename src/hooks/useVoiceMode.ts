import { useCallback, useEffect, useRef, useState } from 'react'
import type { VoiceConfig } from '../shared/contracts'
import { speakIfEnabled, stopSpeech } from '../lib/voice-speak'

const SAMPLE_RATE = 16_000
const MIN_SAMPLES = SAMPLE_RATE * 0.35 // ~350ms minimum speech

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
  if (typeof window.dinoClaw.transcribePcm === 'function') {
    return window.dinoClaw.transcribePcm(samples, SAMPLE_RATE)
  }
  const wav = encodeWav(samples, SAMPLE_RATE)
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
    if (raw.length < MIN_SAMPLES) {
      setError('Didn\'t catch that — tap the mic, speak, then tap again.')
      return
    }

    const pcm = new Float32Array(raw)
    setTranscribing(true)
    setError(null)
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

    setError(null)
    samplesRef.current = []

    try {
      if (!streamRef.current) {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
        })
        streamRef.current = stream
      }

      const audioContext = audioContextRef.current ?? new AudioContext({ sampleRate: SAMPLE_RATE })
      audioContextRef.current = audioContext
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
