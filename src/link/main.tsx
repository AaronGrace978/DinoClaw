import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import LinkApp from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LinkApp />
  </StrictMode>,
)
