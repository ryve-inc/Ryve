import path from 'bare-path'
import fs from 'bare-fs'
import b4a from 'b4a'
import hypercoreCrypto from 'hypercore-crypto'

import { allocateChunksToPeers, DEFAULT_EC_K, DEFAULT_EC_M } from '../erasure-coding'
import { setupConnectionRpc } from './rpc-handler'
import type { GlobalChunkStoreOptions } from './types'

/**
 * Stateless GlobalChunkStore for P2P chunk offloading & retrieval.
 * Supports joining multiple network chunk topics simultaneously so that
 * chunks are served/received across ALL joined networks in the background.
 */
class GlobalChunkStore {
  swarm: any
  storageDir: string
  cacheDir: string
  /** Map of networkId → { topic, discovery } for all joined networks */
  joinedChunkTopics: Map<string, { topic: Uint8Array; discovery: any }>
  publicCatalog: any
  getNetworkKeyHex: (() => string | null) | null
  getJoinedNetworkKeys: (() => string[]) | null
  isNetworkJoined: ((networkKeyHex: string) => boolean) | null
  onPublicCatalogUpdated: ((networkKeyHex: string) => void) | null
  storageManager: any
  onStorageChanged: (() => void) | null
  onPeerHandshake: ((conn: any, networkKeys: string[]) => void) | null

  _rebalanceTimers: Map<string, any>
  _isRebalancing: Map<string, boolean>

  constructor({
    swarm,
    storageDir,
    publicCatalog = null,
    getNetworkKeyHex = null,
    getJoinedNetworkKeys = null,
    isNetworkJoined = null,
    onPublicCatalogUpdated = null,
    storageManager = null,
    onStorageChanged = null,
    onPeerHandshake = null
  }: GlobalChunkStoreOptions) {
    this.swarm = swarm
    this.storageDir = storageDir
    this.cacheDir = path.join(storageDir, '.peer-cache')
    this.joinedChunkTopics = new Map()
    this.publicCatalog = publicCatalog
    this.getNetworkKeyHex = getNetworkKeyHex
    this.getJoinedNetworkKeys = getJoinedNetworkKeys
    this.isNetworkJoined = isNetworkJoined
    this.onPublicCatalogUpdated = onPublicCatalogUpdated
    this.storageManager = storageManager
    this.onStorageChanged = onStorageChanged
    this.onPeerHandshake = onPeerHandshake
    this._rebalanceTimers = new Map()
    this._isRebalancing = new Map()
    this._onConnection = this._onConnection.bind(this)
  }

  async init() {
    await fs.promises.mkdir(this.cacheDir, { recursive: true })
    this.swarm.on('connection', this._onConnection)
    for (const conn of this.swarm.connections) {
      this._onConnection(conn)
    }
  }

  /**
   * Check if an active connection belongs to a specific network.
   */
  isConnInNetwork(conn: any, networkKeyHex: string): boolean {
    if (!networkKeyHex) return false
    const netId = networkKeyHex.slice(0, 12)
    if (conn._networkKeyHexes && conn._networkKeyHexes.has(networkKeyHex)) {
      return true
    }
    if (Array.isArray(conn._networkIds) && conn._networkIds.includes(netId)) {
      return true
    }
    return false
  }

  /**
   * Get all active online RPC connections that belong to the specified network.
   */
  getPeersForNetwork(networkKeyHex: string): any[] {
    return this._getActiveRpcConnections().filter((conn) => this.isConnInNetwork(conn, networkKeyHex))
  }

  /**
   * Returns a deterministically sorted list of online nodes (self + remote peers) for a network.
   * Enables all peers in the swarm to calculate the exact same chunk assignments.
   */
  getDeterministicNodes(networkKeyHex?: string | null): any[] {
    const myId = this.swarm?.keyPair?.publicKey
      ? b4a.toString(this.swarm.keyPair.publicKey, 'hex')
      : '00_self'
    const selfNode = { id: myId, isSelf: true }

    const candidatePeers = networkKeyHex ? this.getPeersForNetwork(networkKeyHex) : this._getActiveRpcConnections()
    const peers = candidatePeers.length > 0 ? candidatePeers : this._getActiveRpcConnections()

    const remoteNodes = peers.map((conn: any) => {
      const peerId = conn._peerId || (conn.remotePublicKey ? b4a.toString(conn.remotePublicKey, 'hex') : 'peer_' + Math.random().toString(16))
      return {
        id: peerId,
        isSelf: false,
        conn,
        _chunkRpc: conn._chunkRpc,
        _availableStorageBytes: conn._availableStorageBytes,
        _availableStorageByNetwork: conn._availableStorageByNetwork,
        _networkKeyHexes: conn._networkKeyHexes
      }
    })

    const allNodes = [selfNode, ...remoteNodes]
    allNodes.sort((a, b) => a.id.localeCompare(b.id))
    return allNodes
  }

  /**
   * Join a single network's chunk topic. Does NOT leave existing topics.
   * Safe to call multiple times for the same networkId (idempotent).
   */
  async joinNetwork(networkId: string, swarmChunkTopic: Uint8Array) {
    if (this.joinedChunkTopics.has(networkId)) return

    const discovery = this.swarm.join(swarmChunkTopic, {
      server: true,
      client: true
    })
    await discovery.flushed().catch(() => {})
    this.joinedChunkTopics.set(networkId, { topic: swarmChunkTopic, discovery })
    console.log(`[ChunkStore] Joined chunk topic for network ${networkId}`)

    if (this.getNetworkKeyHex) {
      const netKey = this.getNetworkKeyHex()
      if (netKey) {
        this.syncPublicCatalog(netKey).catch(() => {})
        this.scheduleRebalance(netKey)
      }
    }
  }

  /**
   * Leave a specific network's chunk topic.
   */
  async leaveNetwork(networkId: string) {
    const entry = this.joinedChunkTopics.get(networkId)
    if (!entry) return
    await entry.discovery.destroy().catch(() => {})
    this.joinedChunkTopics.delete(networkId)
    console.log(`[ChunkStore] Left chunk topic for network ${networkId}`)
  }

  /**
   * Leave ALL chunk topics (used on logout/app exit).
   */
  async leaveAllNetworks() {
    for (const [netId, entry] of this.joinedChunkTopics) {
      await entry.discovery.destroy().catch(() => {})
      console.log(`[ChunkStore] Left chunk topic for network ${netId}`)
    }
    this.joinedChunkTopics.clear()
  }

  _onConnection(conn: any) {
    setupConnectionRpc(
      conn,
      this.swarm,
      this.cacheDir,
      this.publicCatalog,
      this.getNetworkKeyHex || undefined,
      this.onPublicCatalogUpdated || undefined,
      this.getJoinedNetworkKeys || undefined,
      this.isNetworkJoined || undefined,
      this.storageManager || undefined,
      this.onStorageChanged || undefined,
      (handshakeConn: any, netKeys: string[]) => {
        if (typeof this.onPeerHandshake === 'function') {
          this.onPeerHandshake(handshakeConn, netKeys)
        }
        for (const k of netKeys) {
          this.scheduleRebalance(k)
        }
      }
    )
    if (this.getNetworkKeyHex) {
      const netKey = this.getNetworkKeyHex()
      if (netKey) {
        this.syncPeerCatalog(conn, netKey).catch(() => {})
        setTimeout(() => {
          this.syncPeerCatalog(conn, netKey).catch(() => {})
        }, 1000)
      }
    }
  }

  async syncPeerCatalog(conn: any, networkKeyHex: string) {
    const rpc = (conn as any)._chunkRpc
    if (!rpc || rpc.closed || !this.publicCatalog || !networkKeyHex) return

    try {
      const res = await rpc.request('get-public-catalog', { networkKeyHex }, { timeout: 10000 })
      if (res && Array.isArray(res.manifests) && res.manifests.length > 0) {
        const matching = res.manifests.filter((m: any) => m && m.networkKeyHex === networkKeyHex)
        if (matching.length > 0) {
          const added = await this.publicCatalog.mergeRemoteManifests(networkKeyHex, matching)
          if (added) {
            console.log(`[PublicCatalog:Sync] Merged ${matching.length} public file manifest(s) for network ${networkKeyHex.slice(0, 12)}`)
            if (this.onPublicCatalogUpdated) {
              this.onPublicCatalogUpdated(networkKeyHex)
            }
          }
          // Schedule background rebalance to equalize storage across peers
          this.scheduleRebalance(networkKeyHex)
        }
      }
    } catch {}
  }

  _getActiveRpcConnections(): any[] {
    return Array.from(this.swarm.connections).filter(
      (conn: any) => conn._chunkRpc && !conn._chunkRpc.closed && conn._handshakeCompleted === true
    )
  }

  async syncPublicCatalog(networkKeyHex: string) {
    const candidatePeers = this.getPeersForNetwork(networkKeyHex)
    const peers = candidatePeers.length > 0 ? candidatePeers : this._getActiveRpcConnections()
    for (const conn of peers) {
      await this.syncPeerCatalog(conn, networkKeyHex).catch(() => {})
    }
  }

  async broadcastPublicFile(manifest: any) {
    if (!manifest || !manifest.networkKeyHex) return
    const netKey = manifest.networkKeyHex
    const candidatePeers = this.getPeersForNetwork(netKey)
    const targetPeers = candidatePeers.length > 0 ? candidatePeers : this._getActiveRpcConnections()

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

  async broadcastRemovePublicFile(entryPath: string, networkKeyHex: string) {
    if (!entryPath || !networkKeyHex) return
    const candidatePeers = this.getPeersForNetwork(networkKeyHex)
    const targetPeers = candidatePeers.length > 0 ? candidatePeers : this._getActiveRpcConnections()

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

  /**
   * Broadcasts storage allocation updates to all connected network peers in real-time.
   */
  async broadcastStorageUpdate(
    networkKeyHex: string,
    allocatedBytes: number,
    usedBytes: number,
    availableBytes: number
  ) {
    if (!networkKeyHex) return
    const candidatePeers = this.getPeersForNetwork(networkKeyHex)
    const targetPeers = candidatePeers.length > 0 ? candidatePeers : this._getActiveRpcConnections()

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

  /**
   * Debounced rebalance scheduler to avoid churn during peer connection bursts.
   */
  scheduleRebalance(networkKeyHex: string) {
    if (!networkKeyHex) return
    const existing = this._rebalanceTimers.get(networkKeyHex)
    if (existing) clearTimeout(existing)
    const timer = setTimeout(() => {
      this._rebalanceTimers.delete(networkKeyHex)
      this.rebalanceNetwork(networkKeyHex).catch((err) => {
        console.warn(`[ChunkStore:Rebalance] Rebalance error for network ${networkKeyHex.slice(0, 12)}:`, err?.message || err)
      })
    }, 3000)
    this._rebalanceTimers.set(networkKeyHex, timer)
  }

  /**
   * Rebalances chunk storage across all online peers in the specified network.
   * Ensures equal chunk distribution and deletes locally held chunks that belong to remote peers.
   */
  async rebalanceNetwork(networkKeyHex: string) {
    if (!networkKeyHex || this._isRebalancing.get(networkKeyHex)) return
    this._isRebalancing.set(networkKeyHex, true)

    try {
      if (!this.publicCatalog) return
      const manifests = await this.publicCatalog.getPublicFiles(networkKeyHex)
      if (!Array.isArray(manifests) || manifests.length === 0) return

      const nodes = this.getDeterministicNodes(networkKeyHex)
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
          const chunkPath = path.join(this.cacheDir, chunkMeta.hash + '.bin')
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

                  if (this.storageManager) {
                    this.storageManager.recordChunkRemoved(chunkMeta.hash, buf.byteLength, networkKeyHex)
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
        if (this.storageManager) {
          await this.storageManager.recalculateUsedBytes().catch(() => {})
        }
        if (typeof this.onStorageChanged === 'function') {
          try { this.onStorageChanged() } catch {}
        }
        console.log(
          `[ChunkStore:Rebalance] Finished: Offloaded ${totalOffloaded} chunk(s) (${(totalFreedBytes / 1024 / 1024).toFixed(2)} MB freed locally). Equal distribution achieved.`
        )
      }
    } catch (err: any) {
      console.warn(`[ChunkStore:Rebalance] Error during rebalance:`, err?.message || err)
    } finally {
      this._isRebalancing.set(networkKeyHex, false)
    }
  }



  /**
   * Helper function to send allocated chunks over RPC to remote peers with bounded concurrency,
   * retain self-assigned chunks locally, and purge unassigned local chunk files smoothly.
   */
  async _distributeAndPruneChunks(chunkList: any[], allocation: any, networkKeyHex?: string | null) {
    const offloadedHashes = new Set<string>()
    const selfAssignedHashes = new Set<string>()
    const peerQuotaFull = new Set<string>()

    for (const [node, peerChunks] of allocation.distribution.entries()) {
      if ((node as any)?.isSelf) {
        for (const chunk of peerChunks) {
          selfAssignedHashes.add(chunk.hash)
          if (this.storageManager) {
            this.storageManager.recordChunkAdded(chunk.hash, chunk.buffer.byteLength, networkKeyHex)
          }
        }
        continue
      }

      const rpc = (node as any)._chunkRpc
      if (!rpc || rpc.closed) continue

      const nodeId = (node as any).id || (node as any)._peerId || 'peer'
      if (peerQuotaFull.has(nodeId)) {
        for (const chunk of peerChunks) {
          selfAssignedHashes.add(chunk.hash)
        }
        continue
      }

      // Process peer chunks in bounded batches (concurrency of 4)
      const CONCURRENCY = 4
      for (let i = 0; i < peerChunks.length; i += CONCURRENCY) {
        if (peerQuotaFull.has(nodeId)) {
          for (const chunk of peerChunks.slice(i)) {
            selfAssignedHashes.add(chunk.hash)
          }
          break
        }
        const batch = peerChunks.slice(i, i + CONCURRENCY)
        await Promise.all(
          batch.map(async (chunk: any) => {
            if (peerQuotaFull.has(nodeId)) {
              selfAssignedHashes.add(chunk.hash)
              return
            }
            try {
              await rpc.request(
                'store-chunk',
                {
                  hash: chunk.hash,
                  data: b4a.toString(chunk.buffer, 'hex'),
                  networkKeyHex: networkKeyHex || undefined
                },
                { timeout: 60000 }
              )
              offloadedHashes.add(chunk.hash)
            } catch (err: any) {
              const isQuota = err?.message?.includes('QUOTA_EXCEEDED') || err?.message?.includes('quota')
              if (!peerQuotaFull.has(nodeId)) {
                peerQuotaFull.add(nodeId)
                console.log(
                  `[ChunkStore:Uploader] Peer ${nodeId.slice(0, 8)} storage quota reached (${isQuota ? 'Quota full' : err?.message || err}). Retaining remaining chunks locally.`
                )
              }
              if ((node as any)._availableStorageByNetwork && networkKeyHex) {
                ;(node as any)._availableStorageByNetwork.set(networkKeyHex, 0)
              } else {
                ;(node as any)._availableStorageBytes = 0
              }
              // Retain chunk locally to prevent data loss
              selfAssignedHashes.add(chunk.hash)
              if (this.storageManager) {
                this.storageManager.recordChunkAdded(chunk.hash, chunk.buffer.byteLength, networkKeyHex)
              }
            }
          })
        )
        // Yield to event loop after each batch to keep Hyperswarm UDP ping/ACKs alive
        await new Promise((resolve) => setImmediate(resolve))
      }
    }

    // Purge local chunk files NOT assigned to self that were sent to remote peers or unassigned
    let purgedCount = 0
    const PURGE_BATCH = 10
    for (let i = 0; i < chunkList.length; i += PURGE_BATCH) {
      const batch = chunkList.slice(i, i + PURGE_BATCH)
      await Promise.all(
        batch.map(async (chunk: any) => {
          const localPath = path.join(this.cacheDir, chunk.hash + '.bin')
          if (!selfAssignedHashes.has(chunk.hash)) {
            await fs.promises.chmod(localPath, 0o666).catch(() => {})
            await fs.promises.unlink(localPath).catch(() => {})
            purgedCount++
          } else {
            await fs.promises.chmod(localPath, 0o444).catch(() => {})
          }
        })
      )
      if (chunkList.length > 20) {
        await new Promise((resolve) => setImmediate(resolve))
      }
    }

    if (this.storageManager) {
      await this.storageManager.recalculateUsedBytes().catch(() => {})
    }

    if (typeof this.onStorageChanged === 'function') {
      try { this.onStorageChanged() } catch {}
    }

    console.log(
      `[ChunkStore:Uploader] Offloaded ${chunkList.length} chunks across nodes (Self retained ${selfAssignedHashes.size} chunk(s), purged ${purgedCount} local chunk file(s)).`
    )
  }

  /**
   * Erasure Coding chunk offloading strictly distributed only among peers of the specified network.
   */
  async offloadChunks(chunkList: any[], K = DEFAULT_EC_K, M = DEFAULT_EC_M, networkKeyHex?: string | null) {
    // 1. Save chunks to local peer cache in bounded batches (concurrency of 8)
    const WRITE_BATCH = 8
    for (let i = 0; i < chunkList.length; i += WRITE_BATCH) {
      const batch = chunkList.slice(i, i + WRITE_BATCH)
      await Promise.all(
        batch.map(async (chunk: any) => {
          const localPath = path.join(this.cacheDir, chunk.hash + '.bin')
          await fs.promises.writeFile(localPath, chunk.buffer).catch(() => {})
          await fs.promises.chmod(localPath, 0o444).catch(() => {})
        })
      )
      if (chunkList.length > WRITE_BATCH) {
        await new Promise((resolve) => setImmediate(resolve))
      }
    }


    // Strictly select ONLY peers that belong to this network and sort deterministically
    const nodes = this.getDeterministicNodes(networkKeyHex)

    const allocation = allocateChunksToPeers(chunkList, nodes, K, M)

    if (allocation.warnings.length > 0) {
      for (const warn of allocation.warnings) {
        console.warn(`[ChunkStore:Uploader] ${warn}`)
      }
    }

    // 2. Distribute chunks to remote network peers via RPC & prune unassigned local chunk files
    await this._distributeAndPruneChunks(chunkList, allocation, networkKeyHex)

    return allocation
  }


  /**
   * Purges specified chunk hashes from local storage.
   */
  async purgeChunks(hashes: string[]) {
    for (const hash of hashes) {
      if (!hash) continue
      const localPath = path.join(this.cacheDir, hash + '.bin')
      try {
        const st = await fs.promises.stat(localPath).catch(() => null)
        await fs.promises.chmod(localPath, 0o666).catch(() => {})
        await fs.promises.unlink(localPath)
        if (this.storageManager && st && typeof st.size === 'number') {
          this.storageManager.recordChunkRemoved(st.size)
        }
        console.log(`[ChunkStore:Purge] Purged local chunk ${hash.slice(0, 12)}`)
      } catch (err) {
        try {
          const st = await fs.promises.stat(localPath).catch(() => null)
          await fs.promises.chmod(localPath, 0o777).catch(() => {})
          await fs.promises.unlink(localPath)
          if (this.storageManager && st && typeof st.size === 'number') {
            this.storageManager.recordChunkRemoved(st.size)
          }
          console.log(`[ChunkStore:Purge] Purged local chunk ${hash.slice(0, 12)} (fallback)`)
        } catch {}
      }
    }
    if (this.storageManager) {
      await this.storageManager.recalculateUsedBytes().catch(() => {})
    }
    if (typeof this.onStorageChanged === 'function') {
      try { this.onStorageChanged() } catch {}
    }
  }


  /**
   * Purges specified chunk hashes from local storage and sends an RPC deletion request
   * to connected network peers to free up peer storage.
   */
  async broadcastDeleteChunks(hashes: string[], networkKeyHex?: string | null) {
    if (!hashes || hashes.length === 0) return
    // 1. Purge locally first
    await this.purgeChunks(hashes)

    // 2. Broadcast RPC delete request to connected network peers
    const candidatePeers = networkKeyHex ? this.getPeersForNetwork(networkKeyHex) : this._getActiveRpcConnections()
    const peers = candidatePeers.length > 0 ? candidatePeers : this._getActiveRpcConnections()
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

  /**
   * Automatically prunes oldest unmanaged chunk files if local cache exceeds actual configured storage bytes.
   */
  async pruneStorageQuota(maxBytes?: number) {
    if (!this.storageManager) return
    const limit = typeof maxBytes === 'number' && maxBytes > 0
      ? maxBytes
      : this.storageManager.getTotalAllocatedBytes()

    try {
      const files = await fs.promises.readdir(this.cacheDir)
      const chunkFiles: { name: string; path: string; size: number; mtime: number }[] = []
      let totalSize = 0

      for (const name of files) {
        if (!name.endsWith('.bin')) continue
        const filePath = path.join(this.cacheDir, name)
        try {
          const st = await fs.promises.stat(filePath)
          chunkFiles.push({ name, path: filePath, size: st.size, mtime: st.mtimeMs })
          totalSize += st.size
        } catch {}
      }

      if (totalSize <= limit) return

      // Sort by mtime ascending (oldest first)
      chunkFiles.sort((a, b) => a.mtime - b.mtime)

      const targetSize = limit * 0.9
      let freedBytes = 0

      for (const file of chunkFiles) {
        if (totalSize - freedBytes <= targetSize) break
        try {
          await fs.promises.chmod(file.path, 0o666).catch(() => {})
          await fs.promises.unlink(file.path)
          freedBytes += file.size
        } catch {}
      }

      if (this.storageManager && freedBytes > 0) {
        await this.storageManager.recalculateUsedBytes().catch(() => {})
      }
      if (freedBytes > 0 && typeof this.onStorageChanged === 'function') {
        try { this.onStorageChanged() } catch {}
      }

      console.log(`[ChunkStore:Quota] Storage quota reached (${(totalSize / 1024 / 1024).toFixed(1)} MB > ${(limit / 1024 / 1024).toFixed(1)} MB). Pruned ${(freedBytes / 1024 / 1024).toFixed(1)} MB of unpinned chunks.`)
    } catch {}
  }

  /**
   * Fetches an encrypted chunk from peers belonging to this network.
   */
  async fetchChunk(hash: string, networkKeyHex?: string | null, timeoutMs = 60000) {
    // 1. Check local .peer-cache first with integrity validation
    const localChunkPath = path.join(this.cacheDir, hash + '.bin')
    try {
      const localBuf = await fs.promises.readFile(localChunkPath)
      const localHash = b4a.toString(hypercoreCrypto.hash(localBuf), 'hex')
      if (localHash === hash) {
        return localBuf
      } else {
        console.warn(`[ChunkStore:Fetch] ⚠️ Local chunk ${hash.slice(0, 12)} corrupted/tampered on disk! Purging local file.`)
        await fs.promises.chmod(localChunkPath, 0o666).catch(() => {})
        await fs.promises.unlink(localChunkPath).catch(() => {})
      }
    } catch {}

    // 2. Query network peers over Protomux RPC
    const candidatePeers = networkKeyHex ? this.getPeersForNetwork(networkKeyHex) : this._getActiveRpcConnections()
    const connections = candidatePeers.length > 0 ? candidatePeers : this._getActiveRpcConnections()

    if (connections.length === 0) {
      throw new Error(`Chunk ${hash.slice(0, 12)} unavailable: No online peers connected.`)
    }

    const requests = connections.map(async (conn: any) => {
      const rpc = conn._chunkRpc
      if (!rpc || rpc.closed) throw new Error('RPC closed')
      const res = await rpc.request('get-chunk', { hash, networkKeyHex: networkKeyHex || undefined }, { timeout: timeoutMs })
      if (res && res.data) {
        const buf = b4a.from(res.data, 'hex')
        const actualHash = b4a.toString(hypercoreCrypto.hash(buf), 'hex')
        if (actualHash === hash) {
          return buf
        }
      }
      throw new Error('Hash mismatch or invalid data')
    })

    try {
      return await Promise.any(requests)
    } catch (err) {
      throw new Error(`Chunk ${hash.slice(0, 12)} fetch failed: Not found or timed out across network peers.`)
    }
  }

  async close() {
    this.swarm.off('connection', this._onConnection)
    await this.leaveAllNetworks()
  }
}

export { GlobalChunkStore }

