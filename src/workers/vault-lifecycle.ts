import fs from 'bare-fs'
import b4a from 'b4a'
import Corestore from 'corestore'

import { publicIdentity, deriveNetworkKeys } from './identity'
import { VaultDrive } from './vault-drive'
import {
  loadSettings,
  loadSession,
  saveSession,
  clearSession,
  loadNetworks,
  saveNetworks,
  NetworkStorageItem,
  createBlindClient
} from './blind'
import type { State } from './state'
import { activeNetworkPeers, statusPayload, vaultPathFor } from './state'
import { joinNetworkTopics, leaveAllNetworkTopics, joinAllSavedNetworks } from './network-manager'

export async function ensureSettings(state: State, storageDir: string) {
  state.settings = await loadSettings(storageDir)
  if (state.settings.displayName) {
    state.displayName = state.settings.displayName
  }
}

/**
 * closeVault — full teardown (logout only)
 */
export async function closeVault(state: State) {
  await leaveAllNetworkTopics(state)

  if (state.vault) await state.vault.close().catch(() => { })
  if (state.blinds) await state.blinds.close().catch(() => { })
  if (state.vaultStore) await state.vaultStore.close().catch(() => { })

  for (const conn of Array.from(activeNetworkPeers)) {
    try { conn.destroy() } catch { }
  }
  activeNetworkPeers.clear()

  state.vault = null
  state.blinds = null
  state.vaultStore = null
  state.networkKeyHex = null
  state.networkLink = null
  state.topicHex = null
  state.peerCount = 0
  state.networkPeerCounts.clear()
}

/**
 * openVault — initialise identity store + join the given network (additive)
 */
export async function openVault(
  state: State,
  swarm: any,
  storageDir: string,
  publicCatalog: any,
  keys: {
    primaryKey: Uint8Array
    encryptionKey: Uint8Array
    networkKeyHex?: string
    networkLink?: string
    topicHex?: string
    swarmTopic?: Uint8Array
    swarmChunkTopic?: Uint8Array
    netName?: string
  }
) {
  await ensureSettings(state, storageDir)

  state.primaryKey = keys.primaryKey
  state.encryptionKey = keys.encryptionKey
  state.identityHex = b4a.toString(publicIdentity(keys.primaryKey), 'hex')

  state.networks = await loadNetworks(storageDir)

  // --- Join the NEW network topic (additive, does NOT destroy existing) ---
  if (keys.networkKeyHex && keys.swarmTopic && keys.swarmChunkTopic) {
    const netId = keys.networkKeyHex.slice(0, 12)
    const existingIdx = state.networks.findIndex((n) => n.networkKeyHex === keys.networkKeyHex)
    const itemTitle = keys.netName || (existingIdx >= 0 ? state.networks[existingIdx].name : `Network ${netId.slice(0, 6)}`)

    const item: NetworkStorageItem = {
      id: netId,
      name: itemTitle,
      networkLink: keys.networkLink || `p2p-drive://network/${keys.networkKeyHex}?name=${encodeURIComponent(itemTitle)}`,
      networkKeyHex: keys.networkKeyHex,
      topicHex: keys.topicHex || b4a.toString(keys.swarmTopic, 'hex'),
      createdAt: existingIdx >= 0 ? state.networks[existingIdx].createdAt : Date.now(),
      allocatedBytes: existingIdx >= 0 ? (state.networks[existingIdx].allocatedBytes || 1073741824) : 1073741824
    }
    if (existingIdx >= 0) {
      state.networks[existingIdx] = item
    } else {
      state.networks.push(item)
    }
    state.activeNetworkId = netId
    await saveNetworks(storageDir, state.networks)
    if (state.storageManager) {
      state.storageManager.syncNetworks(state.networks)
    }

    state.networkKeyHex = keys.networkKeyHex
    state.networkLink = item.networkLink
    state.topicHex = item.topicHex

    await joinNetworkTopics(state, swarm, netId, keys.swarmTopic, keys.swarmChunkTopic)
  } else if (state.networks.length > 0 && !state.activeNetworkId) {
    state.activeNetworkId = state.networks[0].id
  }

  // --- Ensure identity store & vault are open (once) ---
  const vaultPath = vaultPathFor(storageDir, state.identityHex!)
  if (!state.vaultStore) {
    await fs.promises.mkdir(vaultPath, { recursive: true })
    state.vaultStore = new Corestore(vaultPath, { primaryKey: keys.primaryKey, unsafe: true })
    await state.vaultStore.ready()
    state.blinds = createBlindClient(swarm, state.vaultStore, state.settings.blindPeerKeys)
  }

  for (const conn of activeNetworkPeers) {
    state.vaultStore.replicate(conn)
  }

  if (!state.vault) {
    state.vault = new VaultDrive({
      store: state.vaultStore,
      swarm,
      encryptionKey: keys.encryptionKey,
      networkKeyHex: state.networkKeyHex,
      publicCatalog,
      blinds: state.blinds,
      chunkStore: state.chunkStore
    })
    await state.vault.open()
  } else {
    state.vault.networkKeyHex = state.networkKeyHex
  }

  state.unlocked = true

  await saveSession(storageDir, {
    unlocked: true,
    primaryKey: b4a.toString(keys.primaryKey, 'hex'),
    encryptionKey: b4a.toString(keys.encryptionKey, 'hex'),
    identityHex: state.identityHex,
    networkKeyHex: state.networkKeyHex,
    networkLink: state.networkLink,
    topicHex: state.topicHex
  })

  return statusPayload(state)
}

/**
 * Auto-unlock from saved session
 */
export async function tryAutoUnlock(
  state: State,
  swarm: any,
  storageDir: string,
  publicCatalog: any,
  emit: (msg: unknown) => void
) {
  await ensureSettings(state, storageDir)
  const session = await loadSession(storageDir)
  if (!session?.unlocked || !session.primaryKey || !session.encryptionKey) {
    emit({ type: 'event', name: 'auth', data: { needsAuth: true } })
    return
  }
  try {
    let networkDetails: any = {}
    if (session.networkKeyHex) {
      const derived = deriveNetworkKeys(session.networkKeyHex)
      networkDetails = {
        networkKeyHex: session.networkKeyHex,
        networkLink: derived.networkLink,
        swarmTopic: derived.swarmTopic,
        swarmChunkTopic: derived.swarmChunkTopic,
        topicHex: derived.topicHex
      }
    }
    await openVault(state, swarm, storageDir, publicCatalog, {
      primaryKey: b4a.from(session.primaryKey, 'hex'),
      encryptionKey: b4a.from(session.encryptionKey, 'hex'),
      ...networkDetails
    })
    // After unlocking, join ALL saved networks in background
    await joinAllSavedNetworks(state, swarm)
    emit({ type: 'event', name: 'auth', data: { needsAuth: false, status: statusPayload(state) } })
  } catch (err) {
    console.error('auto unlock failed', err)
    await clearSession(storageDir)
    emit({ type: 'event', name: 'auth', data: { needsAuth: true } })
  }
}
