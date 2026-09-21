import b4a from 'b4a'
import {
  createAccount,
  unlockFromMnemonic,
  publicIdentity,
  createNetworkKey,
  parseNetworkLink,
  deriveNetworkKeys
} from './identity'
import {
  saveSettings,
  clearSession,
  saveNetworks,
  createBlindClient,
  normalizeBlindKeys,
  pinCore
} from './blind'
import type { State } from './state'
import { statusPayload } from './state'
import { joinNetworkTopics, joinAllSavedNetworks } from './network-manager'
import { openVault, closeVault } from './vault-lifecycle'

export const mutateMethods = new Set([
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
  'setStorageQuota',
  'setNetworkStorageAllocation'
])

export function createRpcHandlers(
  state: State,
  swarm: any,
  storageDir: string,
  publicCatalog: any,
  emit: (msg: unknown) => void
): Record<string, (params: any) => Promise<any>> {
  return {
    async getStatus() {
      return statusPayload(state)
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
      await openVault(state, swarm, storageDir, publicCatalog, {
        primaryKey,
        encryptionKey,
        networkKeyHex,
        networkLink,
        swarmTopic: derived.swarmTopic,
        swarmChunkTopic: derived.swarmChunkTopic,
        topicHex: derived.topicHex,
        netName: name
      })
      return { status: statusPayload(state), networkLink, networkKeyHex }
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
      await openVault(state, swarm, storageDir, publicCatalog, {
        primaryKey,
        encryptionKey,
        networkKeyHex,
        networkLink: derived.networkLink,
        swarmTopic: derived.swarmTopic,
        swarmChunkTopic: derived.swarmChunkTopic,
        topicHex: derived.topicHex,
        netName: finalName
      })
      return { status: statusPayload(state), networkLink: derived.networkLink, networkKeyHex }
    },

    async switchNetwork({ id }: { id: string }) {
      const target = state.networks.find((n) => n.id === id)
      if (!target) throw new Error('Network not found.')
      if (!state.primaryKey || !state.encryptionKey) throw new Error('Not unlocked.')

      state.activeNetworkId = id
      state.networkKeyHex = target.networkKeyHex
      state.networkLink = target.networkLink
      state.topicHex = target.topicHex

      if (state.vault) {
        state.vault.networkKeyHex = target.networkKeyHex
      }

      if (!state.joinedTopics.has(id)) {
        const derived = deriveNetworkKeys(target.networkKeyHex, target.name)
        await joinNetworkTopics(state, swarm, id, derived.swarmTopic, derived.swarmChunkTopic)
      }

      return statusPayload(state)
    },

    async removeNetwork({ id }: { id: string }) {
      const targetNet = state.networks.find((n) => n.id === id)
      const handles = state.joinedTopics.get(id)
      if (handles) {
        await handles.networkDiscovery.destroy().catch(() => { })
        await handles.chunkDiscovery.destroy().catch(() => { })
        state.joinedTopics.delete(id)
        if (state.chunkStore) {
          await state.chunkStore.leaveNetwork(id)
        }
      }

      state.networks = state.networks.filter((n) => n.id !== id)
      await saveNetworks(storageDir, state.networks)
      if (state.storageManager) {
        state.storageManager.removeNetwork(id, targetNet?.networkKeyHex)
      }

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
      return statusPayload(state)
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
      const status = await openVault(state, swarm, storageDir, publicCatalog, keys)
      await joinAllSavedNetworks(state, swarm)
      return { status, mnemonic }
    },

    async unlock({ mnemonic, displayName }: { mnemonic: string; displayName?: string }) {
      const keys = unlockFromMnemonic(mnemonic)
      if (displayName) {
        state.displayName = displayName
        state.settings.displayName = displayName
        await saveSettings(storageDir, state.settings)
      }
      const status = await openVault(state, swarm, storageDir, publicCatalog, keys)
      await joinAllSavedNetworks(state, swarm)
      return { status }
    },

    async logout() {
      await closeVault(state)
      state.unlocked = false
      state.primaryKey = null
      state.encryptionKey = null
      state.identityHex = null
      state.networkKeyHex = null
      state.networkLink = null
      state.topicHex = null
      state.activeNetworkId = null
      await clearSession(storageDir)
      emit({ type: 'event', name: 'auth', data: { needsAuth: true, status: statusPayload(state) } })
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
      emit({ type: 'event', name: 'status', data: statusPayload(state) })
      return res
    },

    async download({ path: entryPath, destLocalPath }: { path: string; destLocalPath: string }) {
      if (!state.vault) throw new Error('Not unlocked')
      return state.vault.download(entryPath, destLocalPath)
    },

    async delete({ path: entryPath }: { path: string }) {
      if (!state.vault) throw new Error('Not unlocked')
      const res = await state.vault.delete(entryPath)
      emit({ type: 'event', name: 'status', data: statusPayload(state) })
      return res
    },

    async getChunkManifest({ path: entryPath }: { path: string }) {
      if (!state.vault) throw new Error('Not unlocked')
      return state.vault.getManifest(entryPath)
    },

    async setBlindPeers({ keys }: { keys: string[] }) {
      state.settings.blindPeerKeys = normalizeBlindKeys(keys)
      await saveSettings(storageDir, state.settings)
      if (state.blinds) await state.blinds.close().catch(() => { })
      if (state.vaultStore) {
        state.blinds = createBlindClient(swarm, state.vaultStore, state.settings.blindPeerKeys)
        if (state.vault?.drive) {
          await pinCore(state.blinds, state.vault.drive.core)
          if (state.vault.drive.blobs?.core) {
            await pinCore(state.blinds, state.vault.drive.blobs.core)
          }
        }
      }
      return statusPayload(state)
    },

    async setNetworkStorageAllocation({ id, allocatedBytes }: { id: string; allocatedBytes: number }) {
      if (!id || typeof allocatedBytes !== 'number' || allocatedBytes <= 0) {
        throw new Error('Invalid storage allocation parameters.')
      }
      if (!state.storageManager) throw new Error('Storage manager not initialized')
      const res = await state.storageManager.setNetworkAllocation(id, allocatedBytes, state.networks)
      const idx = state.networks.findIndex((n) => n.id === id)
      if (idx >= 0) {
        state.networks[idx].allocatedBytes = res.allocatedBytes
        await saveNetworks(storageDir, state.networks)

        const netKey = state.networks[idx].networkKeyHex
        if (netKey && state.chunkStore) {
          const used = state.storageManager.getUsedBytesForNetwork(netKey)
          const avail = await state.storageManager.getAvailableBytesForNetwork(netKey)
          state.chunkStore.broadcastStorageUpdate(netKey, res.allocatedBytes, used, avail).catch(() => {})
        }
      }
      emit({ type: 'event', name: 'status', data: statusPayload(state) })
      return statusPayload(state)
    },

    async setStorageQuota({ mode, quotaBytes }: { mode: 'limited' | 'all'; quotaBytes?: number }) {
      state.settings.storageQuotaMode = mode
      state.settings.storageQuotaBytes = quotaBytes
      await saveSettings(storageDir, state.settings)
      emit({ type: 'event', name: 'status', data: statusPayload(state) })
      return statusPayload(state)
    },

    async getStorageInfo() {
      if (!state.storageManager) throw new Error('Storage manager not initialized')
      return state.storageManager.getStorageInfo(state.networks)
    }
  }
}

export function setupRpcDispatcher({
  pipe,
  handlers,
  pear,
  withLock,
  reply
}: {
  pipe: any
  handlers: Record<string, (params: any) => Promise<any>>
  pear: any
  withLock: <T>(fn: () => Promise<T>) => Promise<T>
  reply: (id: number, ok: boolean, result: unknown, error?: unknown) => void
}) {
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
}
