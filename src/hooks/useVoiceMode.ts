import { useCallback, useEffect, useRef, useState } from 'react'
import type { VoiceConfig } from '../shared/contracts'

interface SpeechRecognitionResultItem {
  0?: { transcript?: string }
  isFinal: boolean
}

interface SpeechRecognitionResultList {
  length: number
  [index: number]: SpeechRecognitionResultItem
}

interface SpeechRecognitionEvent {
  resultIndex: number
  results: SpeechRecognitionResultList
}

interface SpeechRecognitionErrorEvent {
  error: string
}

type SpeechRecognitionInstance = {
  continuous: boolean
  interimResults: boolean
  lang: string
  maxAlternatives: number
  onresult: ((event: SpeechRecognitionEvent) => void) | null
  onend: (() => void) | null
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null
  onstart: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

type SpeechRecognitionCtor = new () => SpeechRecognitionInstance

function getSpeechRecognition(): SpeechRecognitionCtor | null {
  const w = window as Window & {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
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
  interimText: string
  error: string | null
  startListening: () => void
  stopListening: () => void
  speak: (text: string) => void
  stopSpeaking: () => void
}

export function useVoiceMode({
  config,
  talkMode,
  disabled = false,
  onFinalTranscript,
  onInterimTranscript,
}: UseVoiceModeOptions): UseVoiceModeResult {
  const [listening, setListening] = useState(false)
  const [interimText, setInterimText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)
  const wantListeningRef = useRef(false)
  const onFinalRef = useRef(onFinalTranscript)
  const onInterimRef = useRef(onInterimTranscript)

  const SpeechRecognitionClass = getSpeechRecognition()
  const supported = Boolean(SpeechRecognitionClass) && typeof window.speechSynthesis !== 'undefined'

  useEffect(() => { onFinalRef.current = onFinalTranscript }, [onFinalTranscript])
  useEffect(() => { onInterimRef.current = onInterimTranscript }, [onInterimTranscript])

  const stopListening = useCallback(() => {
    wantListeningRef.current = false
    recognitionRef.current?.stop()
    setListening(false)
  }, [])

  const startListening = useCallback(() => {
    if (!SpeechRecognitionClass || !config.enabled || !config.inputEnabled || disabled) return

    wantListeningRef.current = true
    setError(null)

    if (!recognitionRef.current) {
      const recognition = new SpeechRecognitionClass()
      recognition.lang = 'en-US'
      recognition.interimResults = true
      recognition.maxAlternatives = 1
      recognition.continuous = config.continuous && !config.pushToTalk

      recognition.onstart = () => {
        setListening(true)
        setError(null)
      }

      recognition.onresult = (event: SpeechRecognitionEvent) => {
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

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        if (event.error === 'aborted' || event.error === 'no-speech') return
        setError(event.error === 'not-allowed'
          ? 'Microphone permission denied. Allow mic access in system settings.'
          : `Voice error: ${event.error}`)
        setListening(false)
      }

      recognition.onend = () => {
        setListening(false)
        if (wantListeningRef.current && config.continuous && !config.pushToTalk && talkMode && !disabled) {
          window.setTimeout(() => {
            try {
              recognition.start()
            } catch {
              /* already started or unavailable */
            }
          }, 250)
        }
      }

      recognitionRef.current = recognition
    }

    const recognition = recognitionRef.current
    recognition.continuous = config.continuous && !config.pushToTalk

    try {
      recognition.start()
    } catch {
      /* recognition may already be running */
    }
  }, [SpeechRecognitionClass, config, disabled, talkMode])

  useEffect(() => {
    if (!supported || !config.enabled || !config.inputEnabled) {
      stopListening()
      return
    }
    if (talkMode && !config.pushToTalk && !disabled) {
      startListening()
      return
    }
    if (!talkMode) stopListening()
  }, [supported, config.enabled, config.inputEnabled, config.pushToTalk, talkMode, disabled, startListening, stopListening])

  useEffect(() => () => {
    wantListeningRef.current = false
    recognitionRef.current?.abort()
    recognitionRef.current = null
    window.speechSynthesis.cancel()
  }, [])

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
    interimText,
    error,
    startListening,
    stopListening,
    speak,
    stopSpeaking,
  }
}
