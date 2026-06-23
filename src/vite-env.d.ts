/// <reference types="vite/client" />

import type { DinoClawApi } from './shared/contracts'

interface ImportMetaEnv {
  readonly VITE_WEB_PREVIEW?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare global {
  interface Window {
    dinoClaw: DinoClawApi
  }
}

export {}
