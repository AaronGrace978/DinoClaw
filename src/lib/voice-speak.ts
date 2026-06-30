import type { VoiceConfig } from '../shared/contracts'

function hasSystemTts(): boolean {
  return typeof window.dinoClaw?.speakText === 'function'
}

function waitForVoices(): Promise<SpeechSynthesisVoice[]> {
  const existing = window.speechSynthesis.getVoices()
  if (existing.length > 0) return Promise.resolve(existing)

  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => resolve(window.speechSynthesis.getVoices()), 1500)
    window.speechSynthesis.onvoiceschanged = () => {
      window.clearTimeout(timeout)
      resolve(window.speechSynthesis.getVoices())
    }
  })
}

async function speakWithBrowser(text: string): Promise<void> {
  if (typeof window.speechSynthesis === 'undefined') {
    throw new Error('Browser speech not available')
  }

  const voices = await waitForVoices()
  if (voices.length === 0) {
    throw new Error('No speech voices available')
  }

  const trimmed = text.trim()
  const utterance = new SpeechSynthesisUtterance(trimmed)
  utterance.rate = 1
  utterance.pitch = 1
  const voice = voices.find(v => v.lang.startsWith('en')) ?? voices[0]
  if (voice) utterance.voice = voice

  const startedAt = performance.now()
  const minDurationMs = Math.min(250, trimmed.length * 25)

  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      window.speechSynthesis.cancel()
      reject(new Error('Speech playback timed out'))
    }, Math.max(30000, trimmed.length * 200))

    utterance.onend = () => {
      window.clearTimeout(timeout)
      // Chromium on Linux often fires onend immediately with no audio.
      if (trimmed.length > 15 && performance.now() - startedAt < minDurationMs) {
        reject(new Error('Speech ended too quickly — likely no audio'))
        return
      }
      resolve()
    }
    utterance.onerror = (event) => {
      window.clearTimeout(timeout)
      reject(new Error(event.error ?? 'Could not play speech audio.'))
    }
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(utterance)
  })
}

async function speakWithSystem(text: string): Promise<void> {
  if (!hasSystemTts()) {
    throw new Error('System speech not available')
  }
  await window.dinoClaw!.speakText(text)
}

export async function speakIfEnabled(
  config: VoiceConfig,
  text: string,
  lastSpokenRef: { current: string },
): Promise<void> {
  if (!config.enabled || !config.outputEnabled || !text.trim()) return
  if (lastSpokenRef.current === text) return
  lastSpokenRef.current = text

  // Electron: bundled espeak-ng / say / PowerShell — reliable on Steam Deck.
  // Chromium speechSynthesis on Linux often succeeds silently with no audio.
  if (hasSystemTts()) {
    try {
      await speakWithSystem(text)
      return
    } catch (error) {
      console.warn('[voice] System TTS failed, trying browser voice:', error)
    }
  }

  try {
    await speakWithBrowser(text)
  } catch (error) {
    console.warn('[voice] Browser TTS failed:', error)
  }
}

export function stopSpeech(): void {
  void window.dinoClaw?.stopSpeech?.()
  window.speechSynthesis?.cancel()
}
