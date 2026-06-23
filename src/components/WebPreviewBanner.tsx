import { Download, X } from 'lucide-react'
import { useState } from 'react'

const RELEASE_URL = 'https://github.com/AaronGrace978/DinoClaw/releases/latest'
const REPO_URL = 'https://github.com/AaronGrace978/DinoClaw'

export default function WebPreviewBanner() {
  const [dismissed, setDismissed] = useState(
    () => sessionStorage.getItem('dinoclaw-preview-banner') === '1'
  )

  if (dismissed) return null

  return (
    <div className="web-preview-banner" role="status">
      <div className="web-preview-banner-inner">
        <span>
          <strong>Web preview</strong> — explore the UI here. Download the desktop app for missions,
          tools, Discord/Telegram, and desktop copilot.
        </span>
        <div className="web-preview-banner-actions">
          <a className="web-preview-btn primary" href={RELEASE_URL} target="_blank" rel="noreferrer">
            <Download size={14} />
            Download
          </a>
          <a className="web-preview-btn" href={REPO_URL} target="_blank" rel="noreferrer">
            GitHub
          </a>
          <button
            type="button"
            className="web-preview-btn icon"
            aria-label="Dismiss"
            onClick={() => {
              sessionStorage.setItem('dinoclaw-preview-banner', '1')
              setDismissed(true)
            }}
          >
            <X size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}
