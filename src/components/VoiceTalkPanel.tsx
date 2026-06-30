import { Mic, MicOff, Volume2, VolumeX } from 'lucide-react'
import type { VoiceConfig } from '../shared/contracts'
import { useVoiceMode } from '../hooks/useVoiceMode'
import { useVoicePrepare } from '../hooks/useVoicePrepare'
import { stopSpeech } from '../lib/voice-speak'

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
  const voicePrepare = useVoicePrepare(talkMode && config.enabled)
  const voice = useVoiceMode({
    config,
    talkMode,
    disabled: disabled || isRunning,
    onFinalTranscript: (text) => {
      if (config.autoSubmit) onSubmitTranscript(text)
      else onSubmitTranscript(text)
    },
  })

  const handleToggleTalkMode = () => {
    if (!config.enabled) void onUpdateConfig({ enabled: true, inputEnabled: true })
    onTalkModeChange(!talkMode)
  }

  if (voice.needsUpdate) {
    return (
      <section className="voice-panel voice-panel--unsupported">
        <MicOff size={18} />
        <div>
          <strong>Talk Mode needs an update</strong>
          <p>
            This build is too old for voice input (the &ldquo;network&rdquo; error).
            TTS still works, but speech-to-text needs v0.5.2+.
          </p>
          <p className="voice-help-cmd">
            curl -fsSL https://raw.githubusercontent.com/AaronGrace978/DinoClaw/main/install.sh | bash
          </p>
        </div>
      </section>
    )
  }

  if (!voice.supported) {
    return (
      <section className="voice-panel voice-panel--unsupported">
        <MicOff size={18} />
        <div>
          <strong>Talk mode unavailable</strong>
          <p>Use the desktop app for voice missions.</p>
        </div>
      </section>
    )
  }

  return (
    <section className={`voice-panel ${talkMode ? 'voice-panel--active' : ''} ${voice.recording ? 'voice-panel--listening' : ''}`}>
      <div className="voice-panel-head">
        <div>
          <h3>Talk Mode</h3>
          <p>Tap the mic, say your mission, tap again. Built-in speech recognition — no API key required.</p>
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
          className={`voice-mic-btn ${voice.recording ? 'listening' : ''}`}
          disabled={!config.enabled || !config.inputEnabled || !talkMode || disabled || voice.transcribing
            || (voicePrepare.preparing && voicePrepare.status.phase !== 'ready')}
          aria-pressed={voice.recording}
          onClick={voice.toggleRecording}
        >
          <span className="voice-mic-ring" />
          <Mic size={28} />
        </button>

        <div className="voice-panel-status">
          {!config.enabled && <span className="voice-status-line">Voice is off in Settings.</span>}
          {!talkMode && config.enabled && (
            <span className="voice-status-line">Turn Talk Mode on to set up voice (one-time ~40 MB download).</span>
          )}
          {talkMode && voicePrepare.preparing && voicePrepare.status.phase !== 'ready' && (
            <>
              <span className="voice-status-line voice-status-line--live">{voicePrepare.status.message}</span>
              {typeof voicePrepare.status.progress === 'number' && (
                <div className="voice-progress">
                  <div className="voice-progress-bar" style={{ width: `${voicePrepare.status.progress}%` }} />
                </div>
              )}
              <span className="voice-status-hint">First setup on Wi‑Fi often takes 3–10 minutes. It is not frozen — please wait.</span>
            </>
          )}
          {talkMode && voicePrepare.status.phase === 'ready' && !voice.recording && !voice.transcribing && !isRunning && (
            <span className="voice-status-line voice-status-line--live">{voicePrepare.status.message}</span>
          )}
          {talkMode && voicePrepare.status.phase === 'error' && (
            <span className="voice-error">{voicePrepare.status.message}</span>
          )}
          {talkMode && voice.recording && (
            <span className="voice-status-line voice-status-line--live">Recording… tap mic when done</span>
          )}
          {talkMode && !voice.recording && !voice.transcribing && !isRunning && voicePrepare.status.phase === 'ready' && (
            <span className="voice-status-line">Tap mic → speak → tap again to send</span>
          )}
          {voice.transcribing && (
            <span className="voice-status-line voice-status-line--live">Understanding your speech…</span>
          )}
          {isRunning && <span className="voice-status-line">DinoBuddy is working…</span>}
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
          <span>Auto-send mission when transcription finishes</span>
        </label>
        <label className="voice-option">
          <input
            type="checkbox"
            checked={config.outputEnabled}
            onChange={e => {
              if (!e.target.checked) stopSpeech()
              void onUpdateConfig({ outputEnabled: e.target.checked })
            }}
          />
          <span>{config.outputEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />} Speak replies aloud (TTS)</span>
        </label>
      </div>
    </section>
  )
}

export { speakIfEnabled } from '../lib/voice-speak'
