import type { VoiceConfig } from '../shared/contracts'

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
  const utterance = new SpeechSynthesisUtterance(text.trim())
  utterance.rate = 1
  utterance.pitch = 1
  const voice = voices.find(v => v.lang.startsWith('en')) ?? voices[0]
  if (voice) utterance.voice = voice

  await new Promise<void>((resolve, reject) => {
    utterance.onend = () => resolve()
    utterance.onerror = () => reject(new Error('Could not play speech audio.'))
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(utterance)
  })
}

export async function speakIfEnabled(
  config: VoiceConfig,
  text: string,
  lastSpokenRef: { current: string },
): Promise<void> {
  if (!config.enabled || !config.outputEnabled || !text.trim()) return
  if (lastSpokenRef.current === text) return
  lastSpokenRef.current = text

  // Electron/Chromium built-in voice — works on Steam Deck with no pacman.
  try {
    await speakWithBrowser(text)
    return
  } catch (error) {
    console.warn('[voice] Browser TTS failed, trying system voice:', error)
  }

  if (typeof window.dinoClaw?.speakText === 'function') {
    try {
      await window.dinoClaw.speakText(text)
      return
    } catch (error) {
      console.warn('[voice] System TTS failed:', error)
    }
  }
}

export function stopSpeech(): void {
  void window.dinoClaw?.stopSpeech?.()
  window.speechSynthesis?.cancel()
}
