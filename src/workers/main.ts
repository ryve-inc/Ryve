import PearRuntime from 'pear-runtime'
import Hyperswarm from 'hyperswarm'
import Corestore from 'corestore'
import goodbye from 'graceful-goodbye'
import FramedStream from 'framed-stream'
import path from 'bare-path'
import fs from 'bare-fs'
import dir from 'bare-storage'
import b4a from 'b4a'
import { isBareKit } from 'which-runtime'

import {
  createAccount,
  unlockFromMnemonic,
  publicIdentity,
  createNetworkKey,
  parseNetworkLink,
  deriveNetworkKeys
} from './identity'
import { VaultDrive } from './vault-drive'
import { PublicCatalogManager } from './vault-drive/public-catalog'
import { GlobalChunkStore } from './global-chunk-store'
import { StorageManager } from './storage-manager'
import {
  loadSettings,
  saveSettings,
  loadSession,
  saveSession,
  clearSession,
  loadNetworks,
  saveNetworks,
  NetworkStorageItem,
  createBlindClient,
  normalizeBlindKeys,
  pinCore
} from './blind'

const argv = (index: number) => (Bare as any).argv[index + (isBareKit ? 0 : 2)]

const updaterConfig = {
  updates: argv(0) !== 'false',
  version: argv(1),
  upgrade: argv(2),
  name: argv(3),
  dir: argv(4) || (dir as any).persistent(),
  app: argv(5)
}

const pipe = new FramedStream((Bare as any).IPC)
const pearStore = new Corestore(path.join(updaterConfig.dir, 'pear-runtime', 'corestore'))
const updaterSwarm = new Hyperswarm()
const swarm = new Hyperswarm()
const pear = new PearRuntime({ ...updaterConfig, swarm: updaterSwarm, store: pearStore })

pear.updater.on('error', console.error)
if (updaterConfig.updates !== false) {
  updaterSwarm.on('connection', (connection: any) => pearStore.replicate(connection))
  updaterSwarm.join(pear.updater.drive.core.discoveryKey, {
    client: true,
    server: false
  })
}

const storageDir = pear.storage || updaterConfig.dir
console.log('Application storage:', storageDir)

pear.updater.on('updating', () => pipe.write('updating'))
pear.updater.on('updated', () => pipe.write('updated'))

const publicCatalog = new PublicCatalogManager(storageDir)
publicCatalog.init().catch((err) => console.error('[PublicCatalog] Init error:', err))

const storageManager = new StorageManager({ storageDir })
storageManager.init().catch((err) => console.error('[StorageManager] Init error:', err))

const chunkStore = new GlobalChunkStore({
  swarm,
  storageDir,
  publicCatalog,
  storageManager,
  getNetworkKeyHex: () => state.networkKeyHex,
  getJoinedNetworkKeys: () => state.networks.map((n) => n.networkKeyHex),
  isNetworkJoined: (netKey) => state.networks.some((n) => n.networkKeyHex === netKey),
  onPublicCatalogUpdated: (netKey) => {
    if (netKey === state.networkKeyHex) {
      console.log(`[Main:Event] Public catalog updated for active network ${netKey.slice(0, 12)}. Emitting event to UI.`)
      emit({ type: 'event', name: 'public-catalog-updated', data: { networkKeyHex: netKey } })
      emit({ type: 'event', name: 'status', data: statusPayload() })
    }
  },
  onStorageChanged: () => {
    emit({ type: 'event', name: 'status', data: statusPayload() })
  }
})
chunkStore.init().catch((err) => console.error('[ChunkStore] Init error:', err))

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface State {
  unlocked: boolean
  primaryKey: Uint8Array | null
  encryptionKey: Uint8Array | null
  identityHex: string | null
  displayName: string | null
  /** The currently ACTIVE network (UI view). Other networks stay connected. */
  networkKeyHex: string | null
  networkLink: string | null
  topicHex: string | null
  /** Map of networkId → { networkDiscovery, chunkDiscovery, swarmTopic } for ALL joined networks */
  joinedTopics: Map<string, { networkDiscovery: any; chunkDiscovery: any; swarmTopic: Uint8Array; topicHex: string }>
  /** Per-network peer counts tracked via peerInfo.topics */
  networkPeerCounts: Map<string, number>
  vaultStore: any
  vault: VaultDrive | null
  chunkStore: GlobalChunkStore
  storageManager: StorageManager
  blinds: any
  settings: {
    blindPeerKeys: string[]
    displayName?: string
    storageQuotaMode?: 'limited' | 'all'
    storageQuotaBytes?: number
  }
  peerCount: number
  networks: NetworkStorageItem[]
  activeNetworkId: string | null
}

const state: State = {
  unlocked: false,
  primaryKey: null,
  encryptionKey: null,
  identityHex: null,
  displayName: null,
  networkKeyHex: null,
  networkLink: null,
  topicHex: null,
  joinedTopics: new Map(),
  networkPeerCounts: new Map(),
  vaultStore: null,
  vault: null,
  chunkStore,
  storageManager,
  blinds: null,
  settings: { blindPeerKeys: [] },
  peerCount: 0,
  networks: [],
  activeNetworkId: null
}

let rpcChain = Promise.resolve()

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = rpcChain.then(fn, fn)
  rpcChain = run.catch(() => {}) as Promise<void>
  return run
}

const activeNetworkPeers = new Set<any>()

/**
 * Resolve which networkIds a connection belongs to by matching
 * peerInfo.topics against our stored swarmTopic buffers.
 */
function resolveNetworkIds(peerInfo: any): string[] {
  if (!peerInfo?.topics || !Array.isArray(peerInfo.topics) || peerInfo.topics.length === 0) {
    return state.activeNetworkId ? [state.activeNetworkId] : []
  }
  const matched: string[] = []
  const peerTopicHexes = peerInfo.topics.map((t: any) =>
    typeof t === 'string' ? t : b4a.toString(t, 'hex')
  )

  for (const [netId, handles] of state.joinedTopics) {
    if (handles.topicHex && peerTopicHexes.includes(handles.topicHex)) {
      matched.push(netId)
    } else {
      for (const topic of peerInfo.topics) {
        if (b4a.equals(topic, handles.swarmTopic)) {
          matched.push(netId)
          break
        }
      }
    }
  }
  return matched.length > 0 ? matched : (state.activeNetworkId ? [state.activeNetworkId] : [])
}

swarm.on('connection', (conn: any, peerInfo: any) => {
  activeNetworkPeers.add(conn)
  state.peerCount = activeNetworkPeers.size

  // Track which networks this connection belongs to
  const netIds = resolveNetworkIds(peerInfo)
  ;(conn as any)._networkIds = netIds
  if (!(conn as any)._networkKeyHexes) {
    (conn as any)._networkKeyHexes = new Set<string>()
  }
  for (const netId of netIds) {
    const net = state.networks.find((n) => n.id === netId)
    if (net) {
      (conn as any)._networkKeyHexes.add(net.networkKeyHex)
    }
    state.networkPeerCounts.set(netId, (state.networkPeerCounts.get(netId) || 0) + 1)
  }

  console.log(`[Network:Swarm] Peer connected on networks [${netIds.join(', ')}]. Total peers: ${state.peerCount}`)
  emit({ type: 'event', name: 'status', data: statusPayload() })

  conn.on('close', () => {
    activeNetworkPeers.delete(conn)
    state.peerCount = activeNetworkPeers.size
    const connNetIds: string[] = (conn as any)._networkIds || []
    for (const netId of connNetIds) {
      const cur = state.networkPeerCounts.get(netId) || 0
      if (cur > 1) state.networkPeerCounts.set(netId, cur - 1)
      else state.networkPeerCounts.delete(netId)
    }
    console.log(`[Network:Swarm] Peer disconnected. Remaining peers: ${state.peerCount}`)
    emit({ type: 'event', name: 'status', data: statusPayload() })
  })

  if (state.vaultStore) state.vaultStore.replicate(conn)
})

function emit(msg: unknown) {
  pipe.write(JSON.stringify(msg))
}

function reply(id: number, ok: boolean, result: unknown, error?: unknown) {
  emit({ id, ok, result, error: error ? String((error as any).message || error) : undefined })
}

function statusPayload() {
  const currentNetwork = state.networks.find((n) => n.id === state.activeNetworkId) || state.networks[0] || null
  const networkItems = state.networks.map((n) => ({
    id: n.id,
    name: n.name,
    networkLink: n.networkLink,
    networkKeyHex: n.networkKeyHex,
    topicHex: n.topicHex,
    peers: state.networkPeerCounts.get(n.id) || 0,
    createdAt: n.createdAt
  }))

  const activePeers = currentNetwork ? (state.networkPeerCounts.get(currentNetwork.id) || 0) : 0

  return {
    unlocked: state.unlocked,
    identity: state.identityHex,
    displayName: state.displayName || state.settings.displayName || null,
    driveKey: state.vault?.keyHex || null,
    peers: activePeers,
    blindPeerKeys: state.settings.blindPeerKeys || [],
    network: {
      networkLink: currentNetwork?.networkLink || state.networkLink,
      networkKeyHex: currentNetwork?.networkKeyHex || state.networkKeyHex,
      topicHex: currentNetwork?.topicHex || state.topicHex,
      joined: state.networks.length > 0 || !!state.networkKeyHex,
      activeId: state.activeNetworkId || currentNetwork?.id || null,
      networks: networkItems
    },
    storage: state.storageManager.getStorageInfoSync()
  }
}

async function ensureSettings() {
  state.settings = await loadSettings(storageDir)
  if (state.settings.displayName) {
    state.displayName = state.settings.displayName
  }
  if (state.settings.storageQuotaMode) {
    await state.storageManager.setQuota(
      state.settings.storageQuotaMode,
      state.settings.storageQuotaBytes
    )
  }
}

function vaultPathFor(identityHex: string) {
  return path.join(storageDir, 'vaults', identityHex)
}

// ---------------------------------------------------------------------------
// Join a single network's Hyperswarm topics WITHOUT destroying existing ones
// ---------------------------------------------------------------------------

async function joinNetworkTopics(networkId: string, swarmTopic: Uint8Array, swarmChunkTopic: Uint8Array) {
  if (state.joinedTopics.has(networkId)) return

  const networkDiscovery = swarm.join(swarmTopic, { server: true, client: true })
  await networkDiscovery.flushed().catch(() => {})

  const chunkDiscovery = swarm.join(swarmChunkTopic, { server: true, client: true })
  await chunkDiscovery.flushed().catch(() => {})

  await state.chunkStore.joinNetwork(networkId, swarmChunkTopic)

  const topicHex = b4a.toString(swarmTopic, 'hex')
  state.joinedTopics.set(networkId, { networkDiscovery, chunkDiscovery, swarmTopic, topicHex })
  console.log(`[P2PNetwork] Joined network ${networkId} swarm topics (total joined: ${state.joinedTopics.size})`)
}

// ---------------------------------------------------------------------------
// Leave ALL network topics (logout / app exit)
// ---------------------------------------------------------------------------

async function leaveAllNetworkTopics() {
  for (const [netId, handles] of state.joinedTopics) {
    await handles.networkDiscovery.destroy().catch(() => {})
    await handles.chunkDiscovery.destroy().catch(() => {})
    console.log(`[P2PNetwork] Left network ${netId} swarm topics`)
  }
  state.joinedTopics.clear()
  await state.chunkStore.leaveAllNetworks()
}

// ---------------------------------------------------------------------------
// closeVault — full teardown (logout only)
// ---------------------------------------------------------------------------

async function closeVault() {
  await leaveAllNetworkTopics()

  if (state.vault) await state.vault.close().catch(() => {})
  if (state.blinds) await state.blinds.close().catch(() => {})
  if (state.vaultStore) await state.vaultStore.close().catch(() => {})

  for (const conn of Array.from(activeNetworkPeers)) {
    try { conn.destroy() } catch {}
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

// ---------------------------------------------------------------------------
// openVault — initialise identity store + join the given network (additive)
// ---------------------------------------------------------------------------

async function openVault(keys: {
  primaryKey: Uint8Array
  encryptionKey: Uint8Array
  networkKeyHex?: string
  networkLink?: string
  topicHex?: string
  swarmTopic?: Uint8Array
  swarmChunkTopic?: Uint8Array
  netName?: string
}) {
  await ensureSettings()

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
      createdAt: existingIdx >= 0 ? state.networks[existingIdx].createdAt : Date.now()
    }
    if (existingIdx >= 0) {
      state.networks[existingIdx] = item
    } else {
      state.networks.push(item)
    }
    state.activeNetworkId = netId
    await saveNetworks(storageDir, state.networks)

    state.networkKeyHex = keys.networkKeyHex
    state.networkLink = item.networkLink
    state.topicHex = item.topicHex

    await joinNetworkTopics(netId, keys.swarmTopic, keys.swarmChunkTopic)
  } else if (state.networks.length > 0 && !state.activeNetworkId) {
    state.activeNetworkId = state.networks[0].id
  }

  // --- Ensure identity store & vault are open (once) ---
  const vaultPath = vaultPathFor(state.identityHex!)
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

  return statusPayload()
}

// ---------------------------------------------------------------------------
// Join ALL previously saved networks' swarm topics (called after unlock)
// ---------------------------------------------------------------------------

async function joinAllSavedNetworks() {
  for (const net of state.networks) {
    if (state.joinedTopics.has(net.id)) continue
    try {
      const derived = deriveNetworkKeys(net.networkKeyHex, net.name)
      await joinNetworkTopics(net.id, derived.swarmTopic, derived.swarmChunkTopic)
    } catch (err) {
      console.error(`[P2PNetwork] Failed to join saved network ${net.name} (${net.id}):`, err)
    }
  }
}

// ---------------------------------------------------------------------------
// Auto-unlock
// ---------------------------------------------------------------------------

async function tryAutoUnlock() {
  await ensureSettings()
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
    await openVault({
      primaryKey: b4a.from(session.primaryKey, 'hex'),
      encryptionKey: b4a.from(session.encryptionKey, 'hex'),
      ...networkDetails
    })
    // After unlocking, join ALL saved networks in background
    await joinAllSavedNetworks()
    emit({ type: 'event', name: 'auth', data: { needsAuth: false, status: statusPayload() } })
  } catch (err) {
    console.error('auto unlock failed', err)
    await clearSession(storageDir)
    emit({ type: 'event', name: 'auth', data: { needsAuth: true } })
  }
}

// ---------------------------------------------------------------------------
// RPC Handlers
// ---------------------------------------------------------------------------

const handlers: Record<string, (params: any) => Promise<any>> = {
  async getStatus() {
    return statusPayload()
  },

  async createNetwork({ name }: { name?: string } = {}) {
    let primaryKey = state.primaryKey
    let encryptionKey = state.encryptionKey
    if (!primaryKey || !encryptionKey) {
      const acct = createAccount()
      primaryKey = acct.primaryKey
      encryptionKey = acct.encryptionKey
    }

    const { networkKeyHex, networkLink } = createNetworkKey(name)
    const derived = deriveNetworkKeys(networkKeyHex, name)
    await openVault({
      primaryKey,
      encryptionKey,
      networkKeyHex,
      networkLink,
      swarmTopic: derived.swarmTopic,
      swarmChunkTopic: derived.swarmChunkTopic,
      topicHex: derived.topicHex,
      netName: name
    })
    return { status: statusPayload(), networkLink, networkKeyHex }
  },

  async joinNetwork({ link, name }: { link: string; name?: string }) {
    if (!link) throw new Error('Enter a valid network invite link.')
    let primaryKey = state.primaryKey
    let encryptionKey = state.encryptionKey
    if (!primaryKey || !encryptionKey) {
      const acct = createAccount()
      primaryKey = acct.primaryKey
      encryptionKey = acct.encryptionKey
    }

    const { networkKeyHex, name: parsedName } = parseNetworkLink(link)
    const finalName = name || parsedName || undefined
    const derived = deriveNetworkKeys(networkKeyHex, finalName)
    await openVault({
      primaryKey,
      encryptionKey,
      networkKeyHex,
      networkLink: derived.networkLink,
      swarmTopic: derived.swarmTopic,
      swarmChunkTopic: derived.swarmChunkTopic,
      topicHex: derived.topicHex,
      netName: finalName
    })
    return { status: statusPayload(), networkLink: derived.networkLink, networkKeyHex }
  },

  /**
   * switchNetwork is now a PURE UI pointer change.
   * It does NOT tear down Hyperswarm connections.
   * All networks stay connected in the background.
   */
  async switchNetwork({ id }: { id: string }) {
    const target = state.networks.find(n => n.id === id)
    if (!target) throw new Error('Network not found.')
    if (!state.primaryKey || !state.encryptionKey) throw new Error('Not unlocked.')

    // Just update the active pointer — no Hyperswarm changes
    state.activeNetworkId = id
    state.networkKeyHex = target.networkKeyHex
    state.networkLink = target.networkLink
    state.topicHex = target.topicHex

    // Update vault's active network key so file operations target the right network
    if (state.vault) {
      state.vault.networkKeyHex = target.networkKeyHex
    }

    // If this network's topics aren't joined yet (edge case), join them
    if (!state.joinedTopics.has(id)) {
      const derived = deriveNetworkKeys(target.networkKeyHex, target.name)
      await joinNetworkTopics(id, derived.swarmTopic, derived.swarmChunkTopic)
    }

    return statusPayload()
  },

  async removeNetwork({ id }: { id: string }) {
    // Leave only this network's topics
    const handles = state.joinedTopics.get(id)
    if (handles) {
      await handles.networkDiscovery.destroy().catch(() => {})
      await handles.chunkDiscovery.destroy().catch(() => {})
      state.joinedTopics.delete(id)
      await state.chunkStore.leaveNetwork(id)
    }

    state.networks = state.networks.filter(n => n.id !== id)
    await saveNetworks(storageDir, state.networks)

    if (state.activeNetworkId === id) {
      if (state.networks.length > 0) {
        const nextNet = state.networks[0]
        state.activeNetworkId = nextNet.id
        state.networkKeyHex = nextNet.networkKeyHex
        state.networkLink = nextNet.networkLink
        state.topicHex = nextNet.topicHex
        if (state.vault) state.vault.networkKeyHex = nextNet.networkKeyHex
      } else {
        state.activeNetworkId = null
        state.networkKeyHex = null
        state.networkLink = null
        state.topicHex = null
      }
    }
    return statusPayload()
  },

  async createAccount() {
    const account = createAccount()
    return {
      mnemonic: account.mnemonic,
      previewIdentity: b4a.toString(publicIdentity(account.primaryKey), 'hex')
    }
  },

  async confirmCreateAccount({ mnemonic, displayName }: { mnemonic: string; displayName?: string }) {
    const keys = unlockFromMnemonic(mnemonic)
    if (displayName) {
      state.displayName = displayName
      state.settings.displayName = displayName
      await saveSettings(storageDir, state.settings)
    }
    const status = await openVault(keys)
    await joinAllSavedNetworks()
    return { status, mnemonic }
  },

  async unlock({ mnemonic, displayName }: { mnemonic: string; displayName?: string }) {
    const keys = unlockFromMnemonic(mnemonic)
    if (displayName) {
      state.displayName = displayName
      state.settings.displayName = displayName
      await saveSettings(storageDir, state.settings)
    }
    const status = await openVault(keys)
    await joinAllSavedNetworks()
    return { status }
  },

  async logout() {
    await closeVault()
    state.unlocked = false
    state.primaryKey = null
    state.encryptionKey = null
    state.identityHex = null
    state.networkKeyHex = null
    state.networkLink = null
    state.topicHex = null
    state.activeNetworkId = null
    await clearSession(storageDir)
    emit({ type: 'event', name: 'auth', data: { needsAuth: true, status: statusPayload() } })
    return { needsAuth: true }
  },

  async list({ dir: listDir = '/' } = {}) {
    if (!state.vault) throw new Error('Not unlocked')
    return state.vault.list(listDir)
  },

  async mkdir({ path: dirPath }: { path: string }) {
    if (!state.vault) throw new Error('Not unlocked')
    return state.vault.mkdir(dirPath)
  },

  async upload({ localPath, destPath, mime, isPrivate }: { localPath: string; destPath: string; mime?: string; isPrivate?: boolean }) {
    if (!state.vault) throw new Error('Not unlocked')
    const res = await state.vault.upload(localPath, destPath, mime, isPrivate !== false)
    emit({ type: 'event', name: 'status', data: statusPayload() })
    return res
  },

  async download({ path: entryPath, destLocalPath }: { path: string; destLocalPath: string }) {
    if (!state.vault) throw new Error('Not unlocked')
    return state.vault.download(entryPath, destLocalPath)
  },

  async delete({ path: entryPath }: { path: string }) {
    if (!state.vault) throw new Error('Not unlocked')
    const res = await state.vault.delete(entryPath)
    emit({ type: 'event', name: 'status', data: statusPayload() })
    return res
  },

  async getChunkManifest({ path: entryPath }: { path: string }) {
    if (!state.vault) throw new Error('Not unlocked')
    return state.vault.getManifest(entryPath)
  },

  async setBlindPeers({ keys }: { keys: string[] }) {
    state.settings.blindPeerKeys = normalizeBlindKeys(keys)
    await saveSettings(storageDir, state.settings)
    if (state.blinds) await state.blinds.close().catch(() => {})
    if (state.vaultStore) {
      state.blinds = createBlindClient(swarm, state.vaultStore, state.settings.blindPeerKeys)
      if (state.vault?.drive) {
        await pinCore(state.blinds, state.vault.drive.core)
        if (state.vault.drive.blobs?.core) {
          await pinCore(state.blinds, state.vault.drive.blobs.core)
        }
      }
    }
    return statusPayload()
  },

  async setStorageQuota({ mode, quotaBytes }: { mode: 'limited' | 'all'; quotaBytes?: number }) {
    await state.storageManager.setQuota(mode, quotaBytes)
    state.settings.storageQuotaMode = mode
    if (quotaBytes) state.settings.storageQuotaBytes = quotaBytes
    await saveSettings(storageDir, state.settings)
    return statusPayload()
  },

  async getStorageInfo() {
    return state.storageManager.getStorageInfo()
  }
}

const mutateMethods = new Set([
  'createNetwork',
  'joinNetwork',
  'confirmCreateAccount',
  'unlock',
  'logout',
  'upload',
  'download',
  'delete',
  'mkdir',
  'setBlindPeers',
  'setStorageQuota'
])

pipe.on('data', async (data: any) => {
  const message = data.toString()
  if (message === 'pear:applyUpdate') {
    await pear.ready()
    await pear.updater.applyUpdate()
    pipe.write('pear:updateApplied')
    return
  }

  let msg: any
  try {
    msg = JSON.parse(message)
  } catch {
    console.log(message)
    return
  }

  if (!msg || msg.type !== 'rpc') return
  const { id, method, params } = msg
  const handler = handlers[method]
  if (!handler) {
    reply(id, false, null, new Error('Unknown method: ' + method))
    return
  }

  const run = async () => {
    try {
      const result = await handler(params || {})
      reply(id, true, result)
    } catch (err) {
      console.error('rpc error', method, err)
      reply(id, false, null, err)
    }
  }

  if (mutateMethods.has(method)) await withLock(run)
  else await run()
})

goodbye(async () => {
  await closeVault()
  if (state.chunkStore) await state.chunkStore.close().catch(() => {})
  await swarm.destroy()
  await updaterSwarm.destroy().catch(() => {})
  await pear.close()
  await pearStore.close()
})

emit({ type: 'event', name: 'ready', data: { storage: storageDir } })

const autoUnlockPromise = withLock(() => tryAutoUnlock()).catch((err) => {
  console.error(err)
})

const originalGetStatus = handlers.getStatus
handlers.getStatus = async () => {
  await autoUnlockPromise
  return originalGetStatus({})
}

const originalList = handlers.list
handlers.list = async (params: any) => {
  await autoUnlockPromise
  if (!state.vault) return []
  return originalList(params)
}

