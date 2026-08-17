import path from 'bare-path'
import * as fs from 'bare-fs'
import * as b4a from 'b4a'
import Corestore from 'corestore'
import type Hyperswarm from 'hyperswarm'
import type { AppStatus } from '../shared/types.ts'
import { publicIdentity } from './identity'
import { VaultDrive } from './vault-drive'
import { createBlindClient, pinCore } from './blinds'
import {
  clearSession,
  loadSession,
  loadSettings,
  parseSessionKey,
  saveSession,
  SessionAuthError
} from './persistence'
import { statusPayload, type AppState } from './app-state'

export function vaultPathFor(storageDir: string, identityHex: string): string {
  return path.join(storageDir, 'vaults', identityHex)
}

export async function closeVault(state: AppState): Promise<void> {
  if (state.vault) await state.vault.close().catch(() => {})
  if (state.blinds) await state.blinds.close().catch(() => {})
  if (state.vaultStore) await state.vaultStore.close().catch(() => {})
  state.vault = null
  state.blinds = null
  state.vaultStore = null
}

export async function pinVaultCores(state: AppState): Promise<void> {
  if (!state.blinds || !state.vault?.drive) return
  await pinCore(state.blinds, state.vault.drive.core)
  if (state.vault.drive.blobs?.core) {
    await pinCore(state.blinds, state.vault.drive.blobs.core)
  }
}

export async function openVault({
  state,
  swarm,
  storageDir,
  keys,
  peers
}: {
  state: AppState
  swarm: Hyperswarm
  storageDir: string
  keys: { primaryKey: Uint8Array; encryptionKey: Uint8Array }
  peers: () => number
}): Promise<AppStatus> {
  state.settings = await loadSettings(storageDir)
  await closeVault(state)
  state.unlocked = false
  state.primaryKey = keys.primaryKey
  state.encryptionKey = keys.encryptionKey
  state.identityHex = b4a.toString(publicIdentity(keys.primaryKey), 'hex')

  try {
    const vaultPath = vaultPathFor(storageDir, state.identityHex)
    await fs.promises.mkdir(vaultPath, { recursive: true })
    state.vaultStore = new Corestore(vaultPath, { primaryKey: keys.primaryKey, unsafe: true })
    await state.vaultStore.ready()
    state.blinds = createBlindClient(swarm, state.vaultStore, state.settings.blindPeerKeys)

    for (const conn of swarm.connections) {
      state.vaultStore.replicate(conn)
    }

    const vault = new VaultDrive({
      store: state.vaultStore,
      swarm,
      encryptionKey: keys.encryptionKey,
      chunkStore: state.chunkStore
    })
    await vault.open()
    state.vault = vault
    state.unlocked = true
    await pinVaultCores(state)
    await saveSession(storageDir, {
      unlocked: true,
      primaryKey: b4a.toString(keys.primaryKey, 'hex'),
      encryptionKey: b4a.toString(keys.encryptionKey, 'hex'),
      identityHex: state.identityHex
    })
    return statusPayload(state, peers())
  } catch (err) {
    state.unlocked = false
    await closeVault(state)
    throw err
  }
}

export async function tryAutoUnlock({
  state,
  swarm,
  storageDir,
  peers,
  emit
}: {
  state: AppState
  swarm: Hyperswarm
  storageDir: string
  peers: () => number
  emit: (msg: unknown) => void
}): Promise<void> {
  state.settings = await loadSettings(storageDir)
  let session
  try {
    session = await loadSession(storageDir)
  } catch (err) {
    if (err instanceof SessionAuthError) await clearSession(storageDir)
    else console.error('auto unlock failed', err)
    emit({ type: 'event', name: 'auth', data: { needsAuth: true } })
    return
  }

  if (!session?.unlocked || !session.primaryKey || !session.encryptionKey) {
    emit({ type: 'event', name: 'auth', data: { needsAuth: true } })
    return
  }

  try {
    const primaryKey = parseSessionKey(session.primaryKey, 'primaryKey')
    const encryptionKey = parseSessionKey(session.encryptionKey, 'encryptionKey')
    const identityHex = b4a.toString(publicIdentity(primaryKey), 'hex')
    if (session.identityHex && session.identityHex !== identityHex) {
      throw new SessionAuthError('Session identity mismatch')
    }
    await openVault({ state, swarm, storageDir, keys: { primaryKey, encryptionKey }, peers })
    emit({
      type: 'event',
      name: 'auth',
      data: { needsAuth: false, status: statusPayload(state, peers()) }
    })
  } catch (err) {
    console.error('auto unlock failed', err)
    if (err instanceof SessionAuthError) await clearSession(storageDir)
    emit({ type: 'event', name: 'auth', data: { needsAuth: true } })
  }
}
