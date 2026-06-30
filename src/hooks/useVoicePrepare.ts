import { useEffect, useState } from 'react'
import type { VoicePrepareProgress } from '../shared/contracts'
import {
  getRendererVoiceStatus,
  onRendererVoiceStatus,
  prepareRendererVoice,
} from '../lib/voice-transcribe'

const IDLE: VoicePrepareProgress = {
  phase: 'idle',
  message: 'Turn Talk Mode on to load speech.',
}

function isDesktopApp(): boolean {
  return typeof window.dinoClaw?.getSnapshot === 'function'
}

export function useVoicePrepare(active: boolean) {
  const [status, setStatus] = useState<VoicePrepareProgress>(IDLE)
  const [preparing, setPreparing] = useState(false)

  useEffect(() => {
    if (!active || !isDesktopApp()) return

    let cancelled = false
    setPreparing(true)
    setStatus(getRendererVoiceStatus())

    const unsubscribe = onRendererVoiceStatus((next) => {
      if (!cancelled) setStatus(next)
    })

    void prepareRendererVoice()
      .then((result) => {
        if (!cancelled) setStatus(result)
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setStatus({
            phase: 'error',
            message: error instanceof Error ? error.message : 'Speech model setup failed.',
          })
        }
      })
      .finally(() => {
        if (!cancelled) setPreparing(false)
      })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [active])

  return { status, preparing }
}
