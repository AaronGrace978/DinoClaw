import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

async function boot() {
  if (import.meta.env.VITE_WEB_PREVIEW === 'true') {
    const { installWebMock } = await import('./web/mock-api')
    installWebMock()
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void boot()
