import type { GlobalChunkStore } from './store'

export async function syncPeerCatalog(store: GlobalChunkStore, conn: any, networkKeyHex: string) {
  const rpc = (conn as any)._chunkRpc
  if (!rpc || rpc.closed || !store.publicCatalog || !networkKeyHex) return

  try {
    const res = await rpc.request('get-public-catalog', { networkKeyHex }, { timeout: 10000 })
    if (res && Array.isArray(res.manifests) && res.manifests.length > 0) {
      const matching = res.manifests.filter((m: any) => m && m.networkKeyHex === networkKeyHex)
      if (matching.length > 0) {
        const added = await store.publicCatalog.mergeRemoteManifests(networkKeyHex, matching)
        if (added) {
          console.log(`[PublicCatalog:Sync] Merged ${matching.length} public file manifest(s) for network ${networkKeyHex.slice(0, 12)}`)
          if (store.onPublicCatalogUpdated) {
            store.onPublicCatalogUpdated(networkKeyHex)
          }
        }
        // Schedule background rebalance to equalize storage across peers
        store.scheduleRebalance(networkKeyHex)
      }
    }
  } catch {}
}

export async function syncPublicCatalog(store: GlobalChunkStore, networkKeyHex: string) {
  const candidatePeers = store.getPeersForNetwork(networkKeyHex)
  const peers = candidatePeers.length > 0 ? candidatePeers : store._getActiveRpcConnections()
  for (const conn of peers) {
    await store.syncPeerCatalog(conn, networkKeyHex).catch(() => {})
  }
}

export async function broadcastPublicFile(store: GlobalChunkStore, manifest: any) {
  if (!manifest || !manifest.networkKeyHex) return
  const netKey = manifest.networkKeyHex
  const candidatePeers = store.getPeersForNetwork(netKey)
  const targetPeers = candidatePeers.length > 0 ? candidatePeers : store._getActiveRpcConnections()

  for (const conn of targetPeers) {
    const rpc = (conn as any)._chunkRpc
    if (!rpc || rpc.closed) continue
    try {
      await rpc.request('announce-public-file', { manifest }, { timeout: 5000 })
    } catch (err: any) {
      console.warn(`[PublicCatalog:Broadcast] Failed to announce public file to peer:`, err?.message || err)
    }
  }
}

export async function broadcastRemovePublicFile(store: GlobalChunkStore, entryPath: string, networkKeyHex: string) {
  if (!entryPath || !networkKeyHex) return
  const candidatePeers = store.getPeersForNetwork(networkKeyHex)
  const targetPeers = candidatePeers.length > 0 ? candidatePeers : store._getActiveRpcConnections()

  for (const conn of targetPeers) {
    const rpc = (conn as any)._chunkRpc
    if (!rpc || rpc.closed) continue
    try {
      await rpc.request('remove-public-file', { path: entryPath, networkKeyHex }, { timeout: 5000 })
    } catch (err: any) {
      console.warn(`[PublicCatalog:Broadcast] Failed to broadcast public file removal to peer:`, err?.message || err)
    }
  }
}

export async function broadcastStorageUpdate(
  store: GlobalChunkStore,
  networkKeyHex: string,
  allocatedBytes: number,
  usedBytes: number,
  availableBytes: number
) {
  if (!networkKeyHex) return
  const candidatePeers = store.getPeersForNetwork(networkKeyHex)
  const targetPeers = candidatePeers.length > 0 ? candidatePeers : store._getActiveRpcConnections()

  for (const conn of targetPeers) {
    const rpc = (conn as any)._chunkRpc
    if (!rpc || rpc.closed) continue
    try {
      await rpc.request(
        'storage-update',
        {
          networkKeyHex,
          allocatedBytes,
          usedBytes,
          availableBytes
        },
        { timeout: 5000 }
      )
    } catch (err: any) {
      console.warn(`[ChunkStore:BroadcastStorage] Failed to send storage update to peer:`, err?.message || err)
    }
  }
}

export async function broadcastDeleteChunks(store: GlobalChunkStore, hashes: string[], networkKeyHex?: string | null) {
  if (!hashes || hashes.length === 0) return
  // 1. Purge locally first
  await store.purgeChunks(hashes)

  // 2. Broadcast RPC delete request to connected network peers
  const candidatePeers = networkKeyHex ? store.getPeersForNetwork(networkKeyHex) : store._getActiveRpcConnections()
  const peers = candidatePeers.length > 0 ? candidatePeers : store._getActiveRpcConnections()
  let notifiedPeers = 0
  for (const conn of peers) {
    const rpc = (conn as any)._chunkRpc
    if (!rpc || rpc.closed) continue
    try {
      await rpc.request('delete-chunks', { hashes, networkKeyHex: networkKeyHex || undefined }, { timeout: 10000 })
      notifiedPeers++
    } catch (err: any) {
      console.warn(`[ChunkStore:DeleteRPC] Failed to request chunk deletion from peer:`, err?.message || err)
    }
  }
  console.log(`[ChunkStore:DeleteRPC] Broadcasted deletion for ${hashes.length} chunk(s) to ${notifiedPeers} online peer(s).`)
}
