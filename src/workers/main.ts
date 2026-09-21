import PearRuntime from 'pear-runtime'
import Hyperswarm from 'hyperswarm'
import Corestore from 'corestore'
import goodbye from 'graceful-goodbye'
import FramedStream from 'framed-stream'
import path from 'bare-path'
import dir from 'bare-storage'
import { isBareKit } from 'which-runtime'

import { PublicCatalogManager } from './vault-drive/public-catalog'
import { GlobalChunkStore } from './global-chunk-store'
import { StorageManager } from './storage-manager'
import { createState, statusPayload } from './state'
import { setupSwarmListeners } from './network-manager'
import { closeVault, tryAutoUnlock } from './vault-lifecycle'
import { createRpcHandlers, setupRpcDispatcher } from './rpc-dispatcher'

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

function emit(msg: unknown) {
  pipe.write(JSON.stringify(msg))
}

function reply(id: number, ok: boolean, result: unknown, error?: unknown) {
  emit({ id, ok, result, error: error ? String((error as any).message || error) : undefined })
}

const publicCatalog = new PublicCatalogManager(storageDir)
publicCatalog.init().catch((err) => console.error('[PublicCatalog] Init error:', err))

const storageManager = new StorageManager({ storageDir })
storageManager.init().catch((err) => console.error('[StorageManager] Init error:', err))

const state = createState()

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
      emit({ type: 'event', name: 'status', data: statusPayload(state) })
    }
  },
  onStorageChanged: () => {
    emit({ type: 'event', name: 'status', data: statusPayload(state) })
  }
})
chunkStore.init().catch((err) => console.error('[ChunkStore] Init error:', err))

state.chunkStore = chunkStore
state.storageManager = storageManager

setupSwarmListeners(swarm, state, emit)

let rpcChain = Promise.resolve()

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = rpcChain.then(fn, fn)
  rpcChain = run.catch(() => { }) as Promise<void>
  return run
}

const handlers = createRpcHandlers(state, swarm, storageDir, publicCatalog, emit)

const autoUnlockPromise = withLock(() => tryAutoUnlock(state, swarm, storageDir, publicCatalog, emit)).catch((err) => {
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

setupRpcDispatcher({ pipe, handlers, pear, withLock, reply })

goodbye(async () => {
  await closeVault(state)
  if (state.chunkStore) await state.chunkStore.close().catch(() => { })
  await swarm.destroy()
  await updaterSwarm.destroy().catch(() => { })
  await pear.close()
  await pearStore.close()
})

emit({ type: 'event', name: 'ready', data: { storage: storageDir } })
