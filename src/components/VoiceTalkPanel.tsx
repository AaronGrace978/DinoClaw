import { Mic, MicOff, Volume2, VolumeX } from 'lucide-react'
import type { VoiceConfig } from '../shared/contracts'
import { useVoiceMode } from '../hooks/useVoiceMode'

interface VoiceTalkPanelProps {
  config: VoiceConfig
  talkMode: boolean
  onTalkModeChange: (active: boolean) => void
  onUpdateConfig: (patch: Partial<VoiceConfig>) => void
  onSubmitTranscript: (text: string) => void
  disabled?: boolean
  isRunning?: boolean
}

export default function VoiceTalkPanel({
  config,
  talkMode,
  onTalkModeChange,
  onUpdateConfig,
  onSubmitTranscript,
  disabled = false,
  isRunning = false,
}: VoiceTalkPanelProps) {
  const voice = useVoiceMode({
    config,
    talkMode,
    disabled: disabled || isRunning,
    onFinalTranscript: (text) => {
      if (config.autoSubmit) onSubmitTranscript(text)
    },
    onInterimTranscript: (text) => {
      if (!config.autoSubmit && text) onSubmitTranscript(text)
    },
  })

  const handleToggleTalkMode = () => {
    if (!config.enabled) {
      void onUpdateConfig({ enabled: true, inputEnabled: true })
    }
    onTalkModeChange(!talkMode)
  }

  const handleMicPointerDown = () => {
    if (config.pushToTalk) voice.startListening()
  }

  const handleMicPointerUp = () => {
    if (config.pushToTalk) voice.stopListening()
  }

  if (!voice.supported) {
    return (
      <section className="voice-panel voice-panel--unsupported">
        <MicOff size={18} />
        <div>
          <strong>Talk mode unavailable</strong>
          <p>Your build does not expose Web Speech API. Use the text box instead.</p>
        </div>
      </section>
    )
  }

  return (
    <section className={`voice-panel ${talkMode ? 'voice-panel--active' : ''} ${voice.listening ? 'voice-panel--listening' : ''}`}>
      <div className="voice-panel-head">
        <div>
          <h3>Talk Mode</h3>
          <p>Tell DinoBuddy what to do — hands-free voice missions.</p>
        </div>
        <button
          type="button"
          className={`voice-talk-toggle ${talkMode ? 'on' : ''}`}
          disabled={!config.enabled}
          onClick={handleToggleTalkMode}
        >
          {talkMode ? 'On' : 'Off'}
        </button>
      </div>

      <div className="voice-panel-controls">
        <button
          type="button"
          className={`voice-mic-btn ${voice.listening ? 'listening' : ''}`}
          disabled={!config.enabled || !config.inputEnabled || (disabled && !config.pushToTalk)}
          aria-pressed={voice.listening}
          onClick={() => {
            if (config.pushToTalk) return
            if (voice.listening) voice.stopListening()
            else voice.startListening()
          }}
          onPointerDown={handleMicPointerDown}
          onPointerUp={handleMicPointerUp}
          onPointerLeave={handleMicPointerUp}
        >
          <span className="voice-mic-ring" />
          <Mic size={28} />
        </button>

        <div className="voice-panel-status">
          {!config.enabled && <span className="voice-status-line">Voice is off in Settings.</span>}
          {config.enabled && talkMode && voice.listening && (
            <span className="voice-status-line voice-status-line--live">Listening… speak your mission</span>
          )}
          {config.enabled && talkMode && !voice.listening && !isRunning && (
            <span className="voice-status-line">Talk mode on — waiting for mic</span>
          )}
          {isRunning && <span className="voice-status-line">DinoBuddy is working…</span>}
          {voice.interimText && (
            <span className="voice-interim">&ldquo;{voice.interimText}&rdquo;</span>
          )}
          {voice.error && <span className="voice-error">{voice.error}</span>}
        </div>
      </div>

      <div className="voice-panel-options">
        <label className="voice-option">
          <input
            type="checkbox"
            checked={config.autoSubmit}
            onChange={e => void onUpdateConfig({ autoSubmit: e.target.checked })}
          />
          <span>Auto-send when I stop talking</span>
        </label>
        <label className="voice-option">
          <input
            type="checkbox"
            checked={config.outputEnabled}
            onChange={e => {
              void onUpdateConfig({ outputEnabled: e.target.checked })
              if (!e.target.checked) window.speechSynthesis.cancel()
            }}
          />
          <span>{config.outputEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />} Speak replies aloud</span>
        </label>
        <label className="voice-option">
          <input
            type="checkbox"
            checked={config.pushToTalk}
            onChange={e => void onUpdateConfig({ pushToTalk: e.target.checked })}
          />
          <span>Push-to-talk (hold mic button)</span>
        </label>
      </div>
    </section>
  )
}

export function speakIfEnabled(config: VoiceConfig, text: string, lastSpokenRef: React.MutableRefObject<string>) {
  if (!config.enabled || !config.outputEnabled || !text.trim()) return
  if (lastSpokenRef.current === text) return
  lastSpokenRef.current = text
  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(text.trim())
  utterance.rate = 1
  window.speechSynthesis.speak(utterance)
}
