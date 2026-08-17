import type Corestore from 'corestore'
import type { AppStatus } from '../shared/types.ts'
import type { DriveSettings } from './persistence'
import type { BlindClient } from './blinds'
import type { VaultDrive } from './vault-drive'
import type { GlobalChunkStore } from './global-chunk-store'

export type AppState = {
  unlocked: boolean
  primaryKey: Uint8Array | null
  encryptionKey: Uint8Array | null
  identityHex: string | null
  vaultStore: Corestore | null
  vault: VaultDrive | null
  chunkStore: GlobalChunkStore
  blinds: BlindClient | null
  settings: DriveSettings
}

export function createAppState(chunkStore: GlobalChunkStore): AppState {
  return {
    unlocked: false,
    primaryKey: null,
    encryptionKey: null,
    identityHex: null,
    vaultStore: null,
    vault: null,
    chunkStore,
    blinds: null,
    settings: { blindPeerKeys: [] }
  }
}

export function statusPayload(state: AppState, peers: number): AppStatus {
  return {
    unlocked: state.unlocked,
    identity: state.identityHex,
    driveKey: state.vault?.keyHex || null,
    peers,
    blindPeerKeys: state.settings.blindPeerKeys || []
  }
}
