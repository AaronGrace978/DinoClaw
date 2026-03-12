/// <reference types="vite/client" />

import type { DinoClawApi } from './shared/contracts'

declare global {
  interface Window {
    dinoClaw: DinoClawApi
  }
}

export {}
