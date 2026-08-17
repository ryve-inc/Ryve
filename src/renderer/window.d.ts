import type { BridgeApi } from '../shared/types.ts'

declare global {
  interface Window {
    bridge?: BridgeApi
  }
}

export {}
