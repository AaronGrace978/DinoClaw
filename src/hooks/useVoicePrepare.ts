import { useEffect, useState } from 'react'
import type { VoicePrepareProgress } from '../shared/contracts'

const IDLE: VoicePrepareProgress = {
  phase: 'idle',
  message: 'Turn Talk Mode on to download the speech model (one-time, ~40 MB).',
}

export function useVoicePrepare(active: boolean) {
  const [status, setStatus] = useState<VoicePrepareProgress>(IDLE)
  const [preparing, setPreparing] = useState(false)

  useEffect(() => {
    if (!active || typeof window.dinoClaw?.prepareVoice !== 'function') return

    let cancelled = false
    setPreparing(true)

    void window.dinoClaw.getVoiceStatus?.()
      .then((current) => { if (!cancelled) setStatus(current) })
      .catch(() => { /* optional */ })

    const unsubscribe = window.dinoClaw.onVoiceStatus?.((next) => {
      if (!cancelled) setStatus(next)
    })

    void window.dinoClaw.prepareVoice()
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
      unsubscribe?.()
    }
  }, [active])

  return { status, preparing }
}
