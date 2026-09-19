import type { M3tr0Api } from '@shared/ipc-api'

declare global {
  interface Window {
    m3tr0: M3tr0Api
  }
}

export {}
