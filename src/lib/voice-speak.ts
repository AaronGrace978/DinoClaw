import type { VoiceConfig } from '../shared/contracts'

export async function speakIfEnabled(
  config: VoiceConfig,
  text: string,
  lastSpokenRef: { current: string },
): Promise<void> {
  if (!config.enabled || !config.outputEnabled || !text.trim()) return
  if (lastSpokenRef.current === text) return
  lastSpokenRef.current = text

  if (typeof window.dinoClaw?.speakText === 'function') {
    try {
      await window.dinoClaw.speakText(text)
      return
    } catch (error) {
      console.warn('[voice] System TTS failed, trying browser speech:', error)
    }
  }

  if (typeof window.speechSynthesis === 'undefined') return
  window.speechSynthesis.cancel()
  const voices = window.speechSynthesis.getVoices()
  const utterance = new SpeechSynthesisUtterance(text.trim())
  utterance.rate = 1
  utterance.pitch = 1
  if (voices.length > 0) utterance.voice = voices.find(v => v.lang.startsWith('en')) ?? voices[0]
  window.speechSynthesis.speak(utterance)
}

export function stopSpeech(): void {
  void window.dinoClaw?.stopSpeech?.()
  window.speechSynthesis?.cancel()
}
