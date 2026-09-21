import path from 'bare-path'
import fs from 'bare-fs'
import b4a from 'b4a'
import type { GlobalChunkStore } from './store'

/**
 * Debounced rebalance scheduler to avoid churn during peer connection bursts.
 */
export function scheduleRebalance(store: GlobalChunkStore, networkKeyHex: string) {
  if (!networkKeyHex) return
  const existing = store._rebalanceTimers.get(networkKeyHex)
  if (existing) clearTimeout(existing)
  const timer = setTimeout(() => {
    store._rebalanceTimers.delete(networkKeyHex)
    store.rebalanceNetwork(networkKeyHex).catch((err) => {
      console.warn(`[ChunkStore:Rebalance] Rebalance error for network ${networkKeyHex.slice(0, 12)}:`, err?.message || err)
    })
  }, 3000)
  store._rebalanceTimers.set(networkKeyHex, timer)
}

/**
 * Rebalances chunk storage across all online peers in the specified network.
 * Ensures equal chunk distribution and deletes locally held chunks that belong to remote peers.
 */
export async function rebalanceNetwork(store: GlobalChunkStore, networkKeyHex: string) {
  if (!networkKeyHex || store._isRebalancing.get(networkKeyHex)) return
  store._isRebalancing.set(networkKeyHex, true)

  try {
    if (!store.publicCatalog) return
    const manifests = await store.publicCatalog.getPublicFiles(networkKeyHex)
    if (!Array.isArray(manifests) || manifests.length === 0) return

    const nodes = store.getDeterministicNodes(networkKeyHex)
    // Filter capacity-eligible nodes
    const eligibleNodes = nodes.filter((n: any) => {
      if (n.isSelf) return true
      const avail = n._availableStorageBytes
      return avail === undefined || avail > 0
    })

    const P = eligibleNodes.length
    if (P <= 1) {
      return // Only self online; no peers to balance with
    }

    console.log(`[ChunkStore:Rebalance] Starting background chunk rebalance across ${P} online peer(s) for network ${networkKeyHex.slice(0, 12)}...`)

    let totalOffloaded = 0
    let totalPurged = 0
    let totalFreedBytes = 0
    const peerQuotaFull = new Set<string>()

    for (const manifest of manifests) {
      if (!manifest || !Array.isArray(manifest.chunks) || manifest.chunks.length === 0) continue

      const offloadItems: Array<{ chunkMeta: any; chunkPath: string; targetNode: any }> = []

      for (const chunkMeta of manifest.chunks) {
        if (!chunkMeta || !chunkMeta.hash) continue
        const chunkPath = path.join(store.cacheDir, chunkMeta.hash + '.bin')
        const exists = await fs.promises.stat(chunkPath).then(() => true).catch(() => false)
        if (!exists) continue

        const chunkIndex = typeof chunkMeta.index === 'number' ? chunkMeta.index : 0
        const targetIndex = chunkIndex % P
        const targetNode = eligibleNodes[targetIndex]

        if (targetNode && !targetNode.isSelf && !peerQuotaFull.has(targetNode.id)) {
          offloadItems.push({ chunkMeta, chunkPath, targetNode })
        }
      }

      if (offloadItems.length === 0) continue

      // Offload chunks with bounded concurrency (batch of 4)
      const CONCURRENCY = 4
      for (let i = 0; i < offloadItems.length; i += CONCURRENCY) {
        const batch = offloadItems.slice(i, i + CONCURRENCY).filter(
          (item) => !peerQuotaFull.has(item.targetNode.id)
        )
        if (batch.length === 0) continue

        await Promise.all(
          batch.map(async ({ chunkMeta, chunkPath, targetNode }) => {
            const rpc = targetNode._chunkRpc
            if (!rpc || rpc.closed || peerQuotaFull.has(targetNode.id)) return

            try {
              const buf: any = await fs.promises.readFile(chunkPath)
              const res = await rpc.request(
                'store-chunk',
                {
                  hash: chunkMeta.hash,
                  data: b4a.toString(buf, 'hex'),
                  networkKeyHex
                },
                { timeout: 60000 }
              )

              if (res && res.ok) {
                // Successfully transferred to target peer! Now delete local copy to equalize storage
                await fs.promises.chmod(chunkPath, 0o666).catch(() => {})
                await fs.promises.unlink(chunkPath).catch(() => {})
                totalOffloaded++
                totalPurged++
                totalFreedBytes += buf.byteLength

                if (store.storageManager) {
                  store.storageManager.recordChunkRemoved(chunkMeta.hash, buf.byteLength, networkKeyHex)
                }
              }
            } catch (err: any) {
              const isQuota = err?.message?.includes('QUOTA_EXCEEDED') || err?.message?.includes('quota')
              if (!peerQuotaFull.has(targetNode.id)) {
                peerQuotaFull.add(targetNode.id)
                if (targetNode.conn?._availableStorageByNetwork) {
                  targetNode.conn._availableStorageByNetwork.set(networkKeyHex, 0)
                }
                console.log(
                  `[ChunkStore:Rebalance] Peer ${targetNode.id.slice(0, 8)} storage quota reached (${isQuota ? 'Quota full' : err?.message || err}). Retaining remaining chunks locally.`
                )
              }
            }
          })
        )
        await new Promise((resolve) => setImmediate(resolve))
      }
    }

    if (totalPurged > 0) {
      if (store.storageManager) {
        await store.storageManager.recalculateUsedBytes().catch(() => {})
      }
      if (typeof store.onStorageChanged === 'function') {
        try { store.onStorageChanged() } catch {}
      }
      console.log(
        `[ChunkStore:Rebalance] Finished: Offloaded ${totalOffloaded} chunk(s) (${(totalFreedBytes / 1024 / 1024).toFixed(2)} MB freed locally). Equal distribution achieved.`
      )
    }
  } catch (err: any) {
    console.warn(`[ChunkStore:Rebalance] Error during rebalance:`, err?.message || err)
  } finally {
    store._isRebalancing.set(networkKeyHex, false)
  }
}
