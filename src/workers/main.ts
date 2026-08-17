import PearRuntime from 'pear-runtime'
import Hyperswarm from 'hyperswarm'
import Corestore from 'corestore'
import goodbye from 'graceful-goodbye'
import FramedStream from 'framed-stream'
import path from 'bare-path'
import dir from 'bare-storage'
import * as b4a from 'b4a'
import { isBareKit } from 'which-runtime'
import { createAccount, unlockFromMnemonic, publicIdentity } from './identity'
import { VaultDrive } from './vault-drive'
import { GlobalChunkStore } from './global-chunk-store'
import { saveSettings, clearSession } from './persistence'
import { createBlindClient, normalizeBlindKeys } from './blinds'
import { createAppState, statusPayload } from './app-state'
import { closeVault, openVault, pinVaultCores, tryAutoUnlock } from './vault-lifecycle'
import { createRpcServer, withLockFactory, type RpcHandler } from './rpc'

const argv = (index: number) => Bare.argv[index + (isBareKit ? 0 : 2)]

function updatesEnabled(value: unknown): boolean {
  return value !== false && value !== 'false'
}

const updaterConfig = {
  updates: updatesEnabled(argv(0)),
  version: argv(1),
  upgrade: argv(2),
  name: argv(3),
  dir: argv(4) || dir.persistent(),
  app: argv(5)
}

const pipe = new FramedStream(Bare.IPC)
const pearStore = new Corestore(path.join(updaterConfig.dir, 'pear-runtime', 'corestore'))
const swarm = new Hyperswarm()
const pear = new PearRuntime({ ...updaterConfig, swarm, store: pearStore })

pear.updater.on('error', console.error)
if (updaterConfig.updates) {
  swarm.on('connection', (connection) => pearStore.replicate(connection))
  swarm.join(pear.updater.drive.core.discoveryKey, {
    client: true,
    server: false
  })
}

const storageDir = pear.storage || updaterConfig.dir
console.log('Application storage:', storageDir)

pear.updater.on('updating', () => pipe.write('updating'))
pear.updater.on('updated', () => pipe.write('updated'))

const chunkStore = new GlobalChunkStore({ swarm, storageDir })
chunkStore.ready.catch((err) => console.error('[ChunkStore] Init error:', err))

const state = createAppState(chunkStore)
const withLock = withLockFactory()
const peers = () => swarm.connections.size

function emit(msg: unknown) {
  pipe.write(JSON.stringify(msg))
}

function requireVault(): VaultDrive {
  if (!state.unlocked || !state.vault) throw new Error('Not unlocked')
  return state.vault
}

swarm.on('connection', (conn) => {
  console.log(`[Network:Swarm] Peer connected! Active Hyperswarm peers: ${peers()}`)
  emit({ type: 'event', name: 'status', data: statusPayload(state, peers()) })
  conn.on('close', () => {
    console.log(`[Network:Swarm] Peer disconnected. Remaining peers: ${peers()}`)
    emit({ type: 'event', name: 'status', data: statusPayload(state, peers()) })
  })
  if (state.vaultStore) state.vaultStore.replicate(conn)
})

const handlers: Record<string, RpcHandler> = {
  async getStatus() {
    return statusPayload(state, peers())
  },

  async createAccount() {
    const account = createAccount()
    return {
      mnemonic: account.mnemonic,
      previewIdentity: b4a.toString(publicIdentity(account.primaryKey), 'hex')
    }
  },

  async confirmCreateAccount({ mnemonic }) {
    if (typeof mnemonic !== 'string') throw new Error('Mnemonic is required')
    const keys = unlockFromMnemonic(mnemonic)
    return { status: await openVault({ state, swarm, storageDir, keys, peers }), mnemonic }
  },

  async unlock({ mnemonic }) {
    if (typeof mnemonic !== 'string') throw new Error('Mnemonic is required')
    const keys = unlockFromMnemonic(mnemonic)
    return { status: await openVault({ state, swarm, storageDir, keys, peers }) }
  },

  async logout() {
    await closeVault(state)
    state.unlocked = false
    state.primaryKey = null
    state.encryptionKey = null
    state.identityHex = null
    await clearSession(storageDir)
    emit({
      type: 'event',
      name: 'auth',
      data: { needsAuth: true, status: statusPayload(state, peers()) }
    })
    return { needsAuth: true }
  },

  async list({ dir: listDir = '/' } = {}) {
    return requireVault().list(typeof listDir === 'string' ? listDir : '/')
  },

  async mkdir({ path: dirPath }) {
    if (typeof dirPath !== 'string') throw new Error('Path is required')
    return requireVault().mkdir(dirPath)
  },

  async upload({ localPath, destPath, mime }) {
    if (typeof localPath !== 'string' || typeof destPath !== 'string') {
      throw new Error('Upload paths are required')
    }
    return requireVault().upload(localPath, destPath, typeof mime === 'string' ? mime : null)
  },

  async download({ path: entryPath, destLocalPath }) {
    if (typeof entryPath !== 'string' || typeof destLocalPath !== 'string') {
      throw new Error('Download paths are required')
    }
    return requireVault().download(entryPath, destLocalPath)
  },

  async previewFile({ path: entryPath }) {
    if (typeof entryPath !== 'string') throw new Error('Path is required')
    return requireVault().preview(entryPath)
  },

  async delete({ path: entryPath }) {
    if (typeof entryPath !== 'string') throw new Error('Path is required')
    return requireVault().delete(entryPath)
  },

  async getChunkManifest({ path: entryPath }) {
    if (typeof entryPath !== 'string') throw new Error('Path is required')
    return requireVault().getManifest(entryPath)
  },

  async setBlindPeers({ keys }) {
    state.settings.blindPeerKeys = normalizeBlindKeys(keys)
    await saveSettings(storageDir, state.settings)
    if (state.blinds) await state.blinds.close().catch(() => {})
    state.blinds = null
    if (state.vaultStore) {
      state.blinds = createBlindClient(swarm, state.vaultStore, state.settings.blindPeerKeys)
      await pinVaultCores(state)
    }
    return statusPayload(state, peers())
  }
}

const lockedMethods = new Set([
  'confirmCreateAccount',
  'unlock',
  'logout',
  'upload',
  'download',
  'previewFile',
  'delete',
  'mkdir',
  'setBlindPeers',
  'list',
  'getChunkManifest'
])

createRpcServer({
  pipe,
  handlers,
  lockedMethods,
  withLock,
  onControl: async (message) => {
    if (message !== 'pear:applyUpdate') return false
    await pear.ready()
    await pear.updater.applyUpdate()
    pipe.write('pear:updateApplied')
    return true
  }
})

goodbye(async () => {
  await closeVault(state)
  await state.chunkStore.close().catch(() => {})
  await swarm.destroy()
  await pear.close()
  await pearStore.close()
})

emit({ type: 'event', name: 'ready', data: { storage: storageDir } })

const autoUnlockPromise = withLock(async () => {
  await chunkStore.ready
  await tryAutoUnlock({ state, swarm, storageDir, peers, emit })
}).catch((err) => {
  console.error(err)
})

const originalGetStatus = handlers.getStatus
handlers.getStatus = async () => {
  await autoUnlockPromise
  return originalGetStatus({})
}
