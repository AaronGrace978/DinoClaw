import { useCallback, useEffect, useRef, useState } from 'react'
import type { VoiceConfig } from '../shared/contracts'

const SILENCE_LEVEL = 10
const SILENCE_MS = 1400
const MIN_SPEECH_MS = 450

function hasNativeTranscription(): boolean {
  return typeof window.dinoClaw?.transcribeAudio === 'function'
}

function getBrowserSpeechRecognition(): (new () => BrowserSpeechRecognition) | null {
  const w = window as Window & {
    SpeechRecognition?: new () => BrowserSpeechRecognition
    webkitSpeechRecognition?: new () => BrowserSpeechRecognition
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

interface BrowserSpeechRecognition {
  continuous: boolean
  interimResults: boolean
  lang: string
  maxAlternatives: number
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null
  onend: (() => void) | null
  onerror: ((event: { error: string }) => void) | null
  onstart: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

interface BrowserSpeechRecognitionEvent {
  resultIndex: number
  results: {
    length: number
    [index: number]: {
      isFinal: boolean
      0?: { transcript?: string }
    }
  }
}

export interface UseVoiceModeOptions {
  config: VoiceConfig
  talkMode: boolean
  disabled?: boolean
  onFinalTranscript: (text: string) => void
  onInterimTranscript?: (text: string) => void
}

export interface UseVoiceModeResult {
  supported: boolean
  listening: boolean
  transcribing: boolean
  interimText: string
  error: string | null
  startListening: () => void
  stopListening: () => void
  speak: (text: string) => void
  stopSpeaking: () => void
}

async function transcribeBlob(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer()
  const mimeType = blob.type || 'audio/webm'
  const text = await window.dinoClaw.transcribeAudio(buffer, mimeType)
  return text.trim()
}

function pickRecorderMime(): string | undefined {
  for (const mime of ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg']) {
    if (MediaRecorder.isTypeSupported(mime)) return mime
  }
  return undefined
}

export function useVoiceMode({
  config,
  talkMode,
  disabled = false,
  onFinalTranscript,
  onInterimTranscript,
}: UseVoiceModeOptions): UseVoiceModeResult {
  const nativeStt = hasNativeTranscription()
  const browserSpeech = getBrowserSpeechRecognition()
  const supported = nativeStt || Boolean(browserSpeech)

  const [listening, setListening] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [interimText, setInterimText] = useState('')
  const [error, setError] = useState<string | null>(null)

  const wantListeningRef = useRef(false)
  const onFinalRef = useRef(onFinalTranscript)
  const onInterimRef = useRef(onInterimTranscript)

  // Native (Electron) capture refs
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const silenceTimerRef = useRef<number | null>(null)
  const speechStartedAtRef = useRef<number | null>(null)
  const monitorFrameRef = useRef<number | null>(null)

  // Browser speech refs
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null)

  useEffect(() => { onFinalRef.current = onFinalTranscript }, [onFinalTranscript])
  useEffect(() => { onInterimRef.current = onInterimTranscript }, [onInterimTranscript])

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current != null) {
      window.clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = null
    }
  }, [])

  const stopMonitor = useCallback(() => {
    if (monitorFrameRef.current != null) {
      cancelAnimationFrame(monitorFrameRef.current)
      monitorFrameRef.current = null
    }
  }, [])

  const cleanupNativeCapture = useCallback(() => {
    clearSilenceTimer()
    stopMonitor()
    recorderRef.current?.stop()
    recorderRef.current = null
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
    void audioContextRef.current?.close()
    audioContextRef.current = null
    analyserRef.current = null
    chunksRef.current = []
    speechStartedAtRef.current = null
  }, [clearSilenceTimer, stopMonitor])

  const finalizeRecording = useCallback(async () => {
    const recorder = recorderRef.current
    if (!recorder || recorder.state === 'inactive') return

    const blob = await new Promise<Blob | null>((resolve) => {
      const chunks = chunksRef.current
      recorder.onstop = () => {
        resolve(chunks.length ? new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }) : null)
      }
      recorder.stop()
    })

    chunksRef.current = []
    recorderRef.current = null

    if (!blob || blob.size < 800) return

    setTranscribing(true)
    setInterimText('Transcribing…')
    try {
      const text = await transcribeBlob(blob)
      setInterimText('')
      if (text) onFinalRef.current(text)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transcription failed.')
      setInterimText('')
    } finally {
      setTranscribing(false)
    }
  }, [])

  const monitorAudioLevel = useCallback(() => {
    const analyser = analyserRef.current
    if (!analyser || !wantListeningRef.current) return

    const data = new Uint8Array(analyser.frequencyBinCount)
    analyser.getByteFrequencyData(data)
    const level = data.reduce((sum, v) => sum + v, 0) / data.length
    const speaking = level > SILENCE_LEVEL

    if (speaking) {
      if (!speechStartedAtRef.current) speechStartedAtRef.current = Date.now()
      clearSilenceTimer()
      if (!recorderRef.current || recorderRef.current.state === 'inactive') {
        chunksRef.current = []
        const mimeType = pickRecorderMime()
        const recorder = mimeType
          ? new MediaRecorder(streamRef.current!, { mimeType })
          : new MediaRecorder(streamRef.current!)
        recorderRef.current = recorder
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) chunksRef.current.push(event.data)
        }
        recorder.start(250)
        setListening(true)
        setError(null)
      }
    } else if (speechStartedAtRef.current && recorderRef.current?.state === 'recording') {
      if (silenceTimerRef.current == null) {
        silenceTimerRef.current = window.setTimeout(() => {
          silenceTimerRef.current = null
          const spokeMs = speechStartedAtRef.current ? Date.now() - speechStartedAtRef.current : 0
          speechStartedAtRef.current = null
          if (spokeMs >= MIN_SPEECH_MS) {
            void finalizeRecording().then(() => {
              if (wantListeningRef.current && config.continuous && !config.pushToTalk && talkMode && !disabled) {
                monitorFrameRef.current = requestAnimationFrame(monitorAudioLevel)
              }
            })
          } else {
            recorderRef.current?.stop()
            recorderRef.current = null
            chunksRef.current = []
          }
        }, SILENCE_MS)
      }
    }

    monitorFrameRef.current = requestAnimationFrame(monitorAudioLevel)
  }, [clearSilenceTimer, config.continuous, config.pushToTalk, disabled, finalizeRecording, talkMode])

  const startNativeListening = useCallback(async () => {
    if (!nativeStt || !config.enabled || !config.inputEnabled || disabled) return

    wantListeningRef.current = true
    setError(null)

    try {
      if (!streamRef.current) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        streamRef.current = stream
        const audioContext = new AudioContext()
        audioContextRef.current = audioContext
        const source = audioContext.createMediaStreamSource(stream)
        const analyser = audioContext.createAnalyser()
        analyser.fftSize = 512
        source.connect(analyser)
        analyserRef.current = analyser
      }

      if (config.pushToTalk) {
        chunksRef.current = []
        const mimeType = pickRecorderMime()
        const recorder = mimeType
          ? new MediaRecorder(streamRef.current, { mimeType })
          : new MediaRecorder(streamRef.current)
        recorderRef.current = recorder
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) chunksRef.current.push(event.data)
        }
        recorder.start()
        speechStartedAtRef.current = Date.now()
        setListening(true)
        return
      }

      stopMonitor()
      monitorFrameRef.current = requestAnimationFrame(monitorAudioLevel)
      setListening(true)
    } catch (err) {
      wantListeningRef.current = false
      setError(err instanceof Error ? err.message : 'Microphone access failed.')
      setListening(false)
    }
  }, [config.enabled, config.inputEnabled, config.pushToTalk, disabled, monitorAudioLevel, nativeStt, stopMonitor])

  const stopNativeListening = useCallback(async () => {
    wantListeningRef.current = false
    setListening(false)
    stopMonitor()
    clearSilenceTimer()

    if (config.pushToTalk && recorderRef.current?.state === 'recording') {
      await finalizeRecording()
    }

    if (!talkMode || disabled) cleanupNativeCapture()
  }, [cleanupNativeCapture, clearSilenceTimer, config.pushToTalk, disabled, finalizeRecording, stopMonitor, talkMode])

  const startBrowserListening = useCallback(() => {
    if (!browserSpeech || !config.enabled || !config.inputEnabled || disabled) return

    wantListeningRef.current = true
    setError(null)

    if (!recognitionRef.current) {
      const recognition = new browserSpeech()
      recognition.lang = 'en-US'
      recognition.interimResults = true
      recognition.maxAlternatives = 1
      recognition.continuous = config.continuous && !config.pushToTalk

      recognition.onstart = () => {
        setListening(true)
        setError(null)
      }

      recognition.onresult = (event) => {
        let interim = ''
        let finalText = ''
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const result = event.results[i]
          const transcript = result[0]?.transcript?.trim() ?? ''
          if (!transcript) continue
          if (result.isFinal) finalText = `${finalText} ${transcript}`.trim()
          else interim = `${interim} ${transcript}`.trim()
        }
        if (interim) {
          setInterimText(interim)
          onInterimRef.current?.(interim)
        }
        if (finalText) {
          setInterimText('')
          onInterimRef.current?.('')
          onFinalRef.current(finalText)
        }
      }

      recognition.onerror = (event) => {
        if (event.error === 'aborted' || event.error === 'no-speech') return
        if (event.error === 'network') {
          setError(
            'Browser speech recognition is unavailable in the desktop app. '
            + 'Update to the latest DinoClaw build for local Talk Mode.',
          )
        } else if (event.error === 'not-allowed') {
          setError('Microphone permission denied. Allow mic access in system settings.')
        } else {
          setError(`Voice error: ${event.error}`)
        }
        setListening(false)
      }

      recognition.onend = () => {
        setListening(false)
        if (wantListeningRef.current && config.continuous && !config.pushToTalk && talkMode && !disabled) {
          window.setTimeout(() => {
            try { recognition.start() } catch { /* already running */ }
          }, 250)
        }
      }

      recognitionRef.current = recognition
    }

    const recognition = recognitionRef.current
    recognition.continuous = config.continuous && !config.pushToTalk
    try { recognition.start() } catch { /* already running */ }
  }, [browserSpeech, config, disabled, talkMode])

  const stopBrowserListening = useCallback(() => {
    wantListeningRef.current = false
    recognitionRef.current?.stop()
    setListening(false)
  }, [])

  const startListening = nativeStt ? startNativeListening : startBrowserListening
  const stopListening = nativeStt ? stopNativeListening : stopBrowserListening

  useEffect(() => {
    if (!supported || !config.enabled || !config.inputEnabled) {
      void stopListening()
      return
    }
    if (talkMode && !config.pushToTalk && !disabled && !transcribing) {
      void startListening()
      return
    }
    if (!talkMode) void stopListening()
  }, [supported, config.enabled, config.inputEnabled, config.pushToTalk, talkMode, disabled, transcribing, startListening, stopListening])

  useEffect(() => () => {
    wantListeningRef.current = false
    recognitionRef.current?.abort()
    recognitionRef.current = null
    cleanupNativeCapture()
    window.speechSynthesis.cancel()
  }, [cleanupNativeCapture])

  const speak = useCallback((text: string) => {
    if (!config.enabled || !config.outputEnabled || !text.trim()) return
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text.trim())
    utterance.rate = 1
    utterance.pitch = 1
    window.speechSynthesis.speak(utterance)
  }, [config.enabled, config.outputEnabled])

  const stopSpeaking = useCallback(() => {
    window.speechSynthesis.cancel()
  }, [])

  return {
    supported,
    listening,
    transcribing,
    interimText,
    error,
    startListening: () => { void startListening() },
    stopListening: () => { void stopListening() },
    speak,
    stopSpeaking,
  }
}
