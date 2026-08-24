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

const chunkStore = new GlobalChunkStore({
  swarm,
  storageDir,
  publicCatalog,
  getNetworkKeyHex: () => state.networkKeyHex,
  onPublicCatalogUpdated: (netKey) => {
    if (netKey === state.networkKeyHex) {
      console.log(`[Main:Event] Public catalog updated for active network ${netKey.slice(0, 12)}. Emitting event to UI.`)
      emit({ type: 'event', name: 'public-catalog-updated', data: { networkKeyHex: netKey } })
    }
  }
})
chunkStore.init().catch((err) => console.error('[ChunkStore] Init error:', err))

interface State {
  unlocked: boolean
  primaryKey: Uint8Array | null
  encryptionKey: Uint8Array | null
  identityHex: string | null
  networkKeyHex: string | null
  networkLink: string | null
  topicHex: string | null
  networkDiscovery: any
  chunkDiscovery: any
  vaultStore: any
  vault: VaultDrive | null
  chunkStore: GlobalChunkStore
  blinds: any
  settings: { blindPeerKeys: string[] }
  peerCount: number
  networks: NetworkStorageItem[]
  activeNetworkId: string | null
}

const state: State = {
  unlocked: false,
  primaryKey: null,
  encryptionKey: null,
  identityHex: null,
  networkKeyHex: null,
  networkLink: null,
  topicHex: null,
  networkDiscovery: null,
  chunkDiscovery: null,
  vaultStore: null,
  vault: null,
  chunkStore,
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

swarm.on('connection', (conn: any) => {
  if (!state.networkKeyHex) {
    try { conn.destroy() } catch {}
    return
  }

  activeNetworkPeers.add(conn)
  state.peerCount = activeNetworkPeers.size
  console.log(`[Network:Swarm] Private network peer connected! Active network peers: ${state.peerCount}`)
  emit({ type: 'event', name: 'status', data: statusPayload() })
  conn.on('close', () => {
    activeNetworkPeers.delete(conn)
    state.peerCount = activeNetworkPeers.size
    console.log(`[Network:Swarm] Private network peer disconnected. Remaining network peers: ${state.peerCount}`)
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
    peers: state.peerCount,
    createdAt: n.createdAt
  }))

  return {
    unlocked: state.unlocked,
    identity: state.identityHex,
    driveKey: state.vault?.keyHex || null,
    peers: state.networkKeyHex ? state.peerCount : 0,
    blindPeerKeys: state.settings.blindPeerKeys || [],
    network: {
      networkLink: currentNetwork?.networkLink || state.networkLink,
      networkKeyHex: currentNetwork?.networkKeyHex || state.networkKeyHex,
      topicHex: currentNetwork?.topicHex || state.topicHex,
      joined: state.networks.length > 0 || !!state.networkKeyHex,
      activeId: state.activeNetworkId || currentNetwork?.id || null,
      networks: networkItems
    }
  }
}

async function ensureSettings() {
  state.settings = await loadSettings(storageDir)
}

function vaultPathFor(identityHex: string) {
  return path.join(storageDir, 'vaults', identityHex)
}

async function closeVault() {
  if (state.networkDiscovery) {
    await state.networkDiscovery.destroy().catch(() => {})
    state.networkDiscovery = null
  }
  if (state.chunkDiscovery) {
    await state.chunkDiscovery.destroy().catch(() => {})
    state.chunkDiscovery = null
  }
  await state.chunkStore.leaveNetwork().catch(() => {})
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
}

async function openVault(keys: {
  primaryKey: Uint8Array
  encryptionKey: Uint8Array
  networkKeyHex?: string
  networkLink?: string
  topicHex?: string
  swarmTopic?: Uint8Array
  swarmChunkTopic?: Uint8Array
}) {
  await ensureSettings()
  await closeVault()

  state.primaryKey = keys.primaryKey
  state.encryptionKey = keys.encryptionKey
  state.identityHex = b4a.toString(publicIdentity(keys.primaryKey), 'hex')

  state.networks = await loadNetworks(storageDir)

  if (keys.networkKeyHex && keys.swarmTopic && keys.swarmChunkTopic) {
    const netId = keys.networkKeyHex.slice(0, 12)
    const existingIdx = state.networks.findIndex((n) => n.networkKeyHex === keys.networkKeyHex)
    const item: NetworkStorageItem = {
      id: netId,
      name: `Network ${netId.slice(0, 6)}`,
      networkLink: keys.networkLink || `p2p-drive://network/${keys.networkKeyHex}`,
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

    // Join Network topic on Hyperswarm
    state.networkDiscovery = swarm.join(keys.swarmTopic, { server: true, client: true })
    await state.networkDiscovery.flushed().catch(() => {})

    state.chunkDiscovery = swarm.join(keys.swarmChunkTopic, { server: true, client: true })
    await state.chunkDiscovery.flushed().catch(() => {})

    await state.chunkStore.joinNetwork(keys.swarmChunkTopic)
    console.log(`[P2PNetwork] Joined network swarm topic: ${state.topicHex}`)
  } else if (state.networks.length > 0 && !state.activeNetworkId) {
    state.activeNetworkId = state.networks[0].id
  }

  const vaultPath = vaultPathFor(state.identityHex!)
  await fs.promises.mkdir(vaultPath, { recursive: true })
  state.vaultStore = new Corestore(vaultPath, { primaryKey: keys.primaryKey, unsafe: true })
  await state.vaultStore.ready()

  state.blinds = createBlindClient(swarm, state.vaultStore, state.settings.blindPeerKeys)

  for (const conn of activeNetworkPeers) {
    state.vaultStore.replicate(conn)
  }

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
    emit({ type: 'event', name: 'auth', data: { needsAuth: false, status: statusPayload() } })
  } catch (err) {
    console.error('auto unlock failed', err)
    await clearSession(storageDir)
    emit({ type: 'event', name: 'auth', data: { needsAuth: true } })
  }
}

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

    const { networkKeyHex, networkLink } = createNetworkKey()
    const derived = deriveNetworkKeys(networkKeyHex)
    const status = await openVault({
      primaryKey,
      encryptionKey,
      networkKeyHex,
      networkLink,
      swarmTopic: derived.swarmTopic,
      swarmChunkTopic: derived.swarmChunkTopic,
      topicHex: derived.topicHex
    })
    if (name && state.activeNetworkId) {
      const item = state.networks.find(n => n.id === state.activeNetworkId)
      if (item) {
        item.name = name
        await saveNetworks(storageDir, state.networks)
      }
    }
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

    const networkKeyHex = parseNetworkLink(link)
    const derived = deriveNetworkKeys(networkKeyHex)
    const status = await openVault({
      primaryKey,
      encryptionKey,
      networkKeyHex,
      networkLink: derived.networkLink,
      swarmTopic: derived.swarmTopic,
      swarmChunkTopic: derived.swarmChunkTopic,
      topicHex: derived.topicHex
    })
    if (name && state.activeNetworkId) {
      const item = state.networks.find(n => n.id === state.activeNetworkId)
      if (item) {
        item.name = name
        await saveNetworks(storageDir, state.networks)
      }
    }
    return { status: statusPayload(), networkLink: derived.networkLink, networkKeyHex }
  },

  async switchNetwork({ id }: { id: string }) {
    const target = state.networks.find(n => n.id === id)
    if (!target) throw new Error('Network not found.')
    if (!state.primaryKey || !state.encryptionKey) throw new Error('Not unlocked.')
    const derived = deriveNetworkKeys(target.networkKeyHex)
    await openVault({
      primaryKey: state.primaryKey,
      encryptionKey: state.encryptionKey,
      networkKeyHex: target.networkKeyHex,
      networkLink: target.networkLink,
      swarmTopic: derived.swarmTopic,
      swarmChunkTopic: derived.swarmChunkTopic,
      topicHex: derived.topicHex
    })
    state.activeNetworkId = id
    return statusPayload()
  },

  async removeNetwork({ id }: { id: string }) {
    state.networks = state.networks.filter(n => n.id !== id)
    await saveNetworks(storageDir, state.networks)
    if (state.activeNetworkId === id) {
      state.activeNetworkId = state.networks[0]?.id || null
      if (state.activeNetworkId) {
        const nextNet = state.networks[0]
        const derived = deriveNetworkKeys(nextNet.networkKeyHex)
        if (state.primaryKey && state.encryptionKey) {
          await openVault({
            primaryKey: state.primaryKey,
            encryptionKey: state.encryptionKey,
            networkKeyHex: nextNet.networkKeyHex,
            networkLink: nextNet.networkLink,
            swarmTopic: derived.swarmTopic,
            swarmChunkTopic: derived.swarmChunkTopic,
            topicHex: derived.topicHex
          })
        }
      } else {
        await closeVault()
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

  async confirmCreateAccount({ mnemonic }: { mnemonic: string }) {
    const keys = unlockFromMnemonic(mnemonic)
    const status = await openVault(keys)
    return { status, mnemonic }
  },

  async unlock({ mnemonic }: { mnemonic: string }) {
    const keys = unlockFromMnemonic(mnemonic)
    const status = await openVault(keys)
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
    return state.vault.upload(localPath, destPath, mime, isPrivate !== false)
  },

  async download({ path: entryPath, destLocalPath }: { path: string; destLocalPath: string }) {
    if (!state.vault) throw new Error('Not unlocked')
    return state.vault.download(entryPath, destLocalPath)
  },

  async delete({ path: entryPath }: { path: string }) {
    if (!state.vault) throw new Error('Not unlocked')
    return state.vault.delete(entryPath)
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
  'setBlindPeers'
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

