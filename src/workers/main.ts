// @ts-nocheck
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

import { createAccount, unlockFromMnemonic, publicIdentity } from './identity'
import { VaultDrive } from './vault-drive'
import { GlobalChunkStore } from './global-chunk-store'
import {
  loadSettings,
  saveSettings,
  loadSession,
  saveSession,
  clearSession,
  createBlindClient,
  normalizeBlindKeys,
  pinCore
} from './blind'

const argv = (index) => Bare.argv[index + (isBareKit ? 0 : 2)]

const updaterConfig = {
  updates: argv(0) !== 'false',
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
if (updaterConfig.updates !== false) {
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
chunkStore.init().catch((err) => console.error('[ChunkStore] Init error:', err))

const state = {
  unlocked: false,
  primaryKey: null,
  encryptionKey: null,
  identityHex: null,
  vaultStore: null,
  vault: null,
  chunkStore,
  blinds: null,
  settings: { blindPeerKeys: [] },
  peerCount: 0
}

let rpcChain = Promise.resolve()

function withLock(fn) {
  const run = rpcChain.then(fn, fn)
  rpcChain = run.catch(() => {})
  return run
}

swarm.on('connection', (conn) => {
  state.peerCount++
  emit({ type: 'event', name: 'status', data: statusPayload() })
  conn.on('close', () => {
    state.peerCount = Math.max(0, state.peerCount - 1)
    emit({ type: 'event', name: 'status', data: statusPayload() })
  })
  if (state.vaultStore) state.vaultStore.replicate(conn)
})

function emit(msg) {
  pipe.write(JSON.stringify(msg))
}

function reply(id, ok, result, error) {
  emit({ id, ok, result, error: error ? String(error.message || error) : undefined })
}

function statusPayload() {
  return {
    unlocked: state.unlocked,
    identity: state.identityHex,
    driveKey: state.vault?.keyHex || null,
    peers: state.peerCount,
    blindPeerKeys: state.settings.blindPeerKeys || [],
    shares: []
  }
}

async function ensureSettings() {
  state.settings = await loadSettings(storageDir)
}

function vaultPathFor(identityHex) {
  return path.join(storageDir, 'vaults', identityHex)
}

async function closeVault() {
  if (state.vault) await state.vault.close().catch(() => {})
  if (state.blinds) await state.blinds.close().catch(() => {})
  if (state.vaultStore) await state.vaultStore.close().catch(() => {})
  state.vault = null
  state.blinds = null
  state.vaultStore = null
}

async function openVault(keys) {
  await ensureSettings()
  await closeVault()

  state.primaryKey = keys.primaryKey
  state.encryptionKey = keys.encryptionKey
  state.identityHex = b4a.toString(publicIdentity(keys.primaryKey), 'hex')

  const vaultPath = vaultPathFor(state.identityHex)
  await fs.promises.mkdir(vaultPath, { recursive: true })
  state.vaultStore = new Corestore(vaultPath, { primaryKey: keys.primaryKey, unsafe: true })
  await state.vaultStore.ready()

  state.blinds = createBlindClient(swarm, state.vaultStore, state.settings.blindPeerKeys)

  for (const conn of swarm.connections) {
    state.vaultStore.replicate(conn)
  }

  state.vault = new VaultDrive({
    store: state.vaultStore,
    swarm,
    encryptionKey: keys.encryptionKey,
    blinds: state.blinds,
    chunkStore: state.chunkStore
  })
  await state.vault.open()

  state.unlocked = true

  await saveSession(storageDir, {
    unlocked: true,
    primaryKey: b4a.toString(keys.primaryKey, 'hex'),
    encryptionKey: b4a.toString(keys.encryptionKey, 'hex'),
    identityHex: state.identityHex
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
    await openVault({
      primaryKey: b4a.from(session.primaryKey, 'hex'),
      encryptionKey: b4a.from(session.encryptionKey, 'hex')
    })
    emit({ type: 'event', name: 'auth', data: { needsAuth: false, status: statusPayload() } })
  } catch (err) {
    console.error('auto unlock failed', err)
    await clearSession(storageDir)
    emit({ type: 'event', name: 'auth', data: { needsAuth: true } })
  }
}

const handlers = {
  async getStatus() {
    return statusPayload()
  },

  async createAccount() {
    const account = createAccount()
    return {
      mnemonic: account.mnemonic,
      previewIdentity: b4a.toString(publicIdentity(account.primaryKey), 'hex')
    }
  },

  async confirmCreateAccount({ mnemonic }) {
    const keys = unlockFromMnemonic(mnemonic)
    const status = await openVault(keys)
    return { status, mnemonic }
  },

  async unlock({ mnemonic }) {
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
    await clearSession(storageDir)
    emit({ type: 'event', name: 'auth', data: { needsAuth: true, status: statusPayload() } })
    return { needsAuth: true }
  },

  async list({ dir: listDir = '/' } = {}) {
    if (!state.vault) throw new Error('Not unlocked')
    return state.vault.list(listDir)
  },

  async mkdir({ path: dirPath }) {
    if (!state.vault) throw new Error('Not unlocked')
    return state.vault.mkdir(dirPath)
  },

  async upload({ localPath, destPath, mime }) {
    if (!state.vault) throw new Error('Not unlocked')
    return state.vault.upload(localPath, destPath, mime)
  },

  async download({ path: entryPath, destLocalPath }) {
    if (!state.vault) throw new Error('Not unlocked')
    return state.vault.download(entryPath, destLocalPath)
  },

  async delete({ path: entryPath }) {
    if (!state.vault) throw new Error('Not unlocked')
    return state.vault.delete(entryPath)
  },

  async getChunkManifest({ path: entryPath }) {
    if (!state.vault) throw new Error('Not unlocked')
    return state.vault.getManifest(entryPath)
  },

  async createReadShare() {
    return { invite: '', type: 'read', pathPrefix: '/', id: '' }
  },

  async createCollabShare() {
    return { invite: '', id: '', name: '', type: 'collab' }
  },

  async joinShare() {
    return { id: '', name: 'Shared', type: 'collab' }
  },

  async listShares() {
    return []
  },

  async listShareFiles() {
    return []
  },

  async uploadToShare() {
    throw new Error('Shares disabled')
  },

  async downloadFromShare() {
    throw new Error('Shares disabled')
  },

  async getShareManifest() {
    return { path: '', byteLength: 0, chunks: [] }
  },

  async setBlindPeers({ keys }) {
    state.settings.blindPeerKeys = normalizeBlindKeys(keys)
    await saveSettings(storageDir, state.settings)
    if (state.blinds) await state.blinds.close().catch(() => {})
    if (state.vaultStore) {
      state.blinds = createBlindClient(swarm, state.vaultStore, state.settings.blindPeerKeys)
      if (state.vault?.drive) {
        await pinCore(this.blinds, state.vault.drive.core)
        if (state.vault.drive.blobs?.core) {
          await pinCore(this.blinds, state.vault.drive.blobs.core)
        }
      }
    }
    return statusPayload()
  }
}

const mutateMethods = new Set([
  'confirmCreateAccount',
  'unlock',
  'logout',
  'upload',
  'download',
  'delete',
  'mkdir',
  'setBlindPeers'
])

pipe.on('data', async (data) => {
  const message = data.toString()
  if (message === 'pear:applyUpdate') {
    await pear.ready()
    await pear.updater.applyUpdate()
    pipe.write('pear:updateApplied')
    return
  }

  let msg
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
  return originalGetStatus()
}
