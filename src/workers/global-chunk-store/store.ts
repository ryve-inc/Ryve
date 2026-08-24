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

  constructor({
    swarm,
    storageDir,
    publicCatalog = null,
    getNetworkKeyHex = null,
    getJoinedNetworkKeys = null,
    isNetworkJoined = null,
    onPublicCatalogUpdated = null
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
      if (netKey) this.syncPublicCatalog(netKey).catch(() => {})
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
      this.isNetworkJoined || undefined
    )
    if (this.getNetworkKeyHex) {
      const netKey = this.getNetworkKeyHex()
      if (netKey) this.syncPeerCatalog(conn, netKey).catch(() => {})
    }
  }

  async syncPeerCatalog(conn: any, networkKeyHex: string) {
    const rpc = (conn as any)._chunkRpc
    if (!rpc || rpc.closed || !this.publicCatalog || !networkKeyHex) return
    if (!this.isConnInNetwork(conn, networkKeyHex)) return

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
        }
      }
    } catch {}
  }

  _getActiveRpcConnections(): any[] {
    return Array.from(this.swarm.connections).filter((conn: any) => conn._chunkRpc && !conn._chunkRpc.closed)
  }

  async syncPublicCatalog(networkKeyHex: string) {
    const peers = this.getPeersForNetwork(networkKeyHex)
    for (const conn of peers) {
      await this.syncPeerCatalog(conn, networkKeyHex).catch(() => {})
    }
  }

  async broadcastPublicFile(manifest: any) {
    if (!manifest || !manifest.networkKeyHex) return
    const netKey = manifest.networkKeyHex
    const targetPeers = this.getPeersForNetwork(netKey)

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

  /**
   * Helper function to send allocated chunks over RPC to remote peers,
   * retain self-assigned chunks locally, and purge unassigned local chunk files.
   */
  async _distributeAndPruneChunks(chunkList: any[], allocation: any, networkKeyHex?: string | null) {
    const offloadedHashes = new Set<string>()
    const selfAssignedHashes = new Set<string>()

    for (const [node, peerChunks] of allocation.distribution.entries()) {
      if ((node as any)?.isSelf) {
        for (const chunk of peerChunks) {
          selfAssignedHashes.add(chunk.hash)
        }
        continue
      }

      const rpc = (node as any)._chunkRpc
      if (!rpc || rpc.closed) continue

      for (const chunk of peerChunks) {
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
          console.warn(`[ChunkStore:Uploader] Failed to store chunk ${chunk.hash.slice(0, 12)} on peer:`, err?.message || err)
        }
      }
    }

    // Purge local chunk files NOT assigned to self that were sent to remote peers or unassigned
    let purgedCount = 0
    for (const chunk of chunkList) {
      if (!selfAssignedHashes.has(chunk.hash)) {
        const localPath = path.join(this.cacheDir, chunk.hash + '.bin')
        await fs.promises.unlink(localPath).catch(() => {})
        purgedCount++
      }
    }

    console.log(
      `[ChunkStore:Uploader] Offloaded ${chunkList.length} chunks across nodes (Self retained ${selfAssignedHashes.size} chunk(s), purged ${purgedCount} local chunk file(s)).`
    )
  }

  /**
   * Erasure Coding chunk offloading strictly distributed only among peers of the specified network.
   */
  async offloadChunks(chunkList: any[], K = DEFAULT_EC_K, M = DEFAULT_EC_M, networkKeyHex?: string | null) {
    // 1. Save all chunks to local peer cache first
    for (const chunk of chunkList) {
      const localPath = path.join(this.cacheDir, chunk.hash + '.bin')
      await fs.promises.writeFile(localPath, chunk.buffer).catch(() => {})
    }

    const selfNode = { isSelf: true }
    // Strictly select ONLY peers that belong to this network
    const remotePeers = networkKeyHex ? this.getPeersForNetwork(networkKeyHex) : []
    const nodes = [selfNode, ...remotePeers]

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
      await fs.promises.unlink(localPath).catch(() => {})
    }
  }

  /**
   * Fetches an encrypted chunk from peers belonging to this network.
   */
  async fetchChunk(hash: string, networkKeyHex?: string | null, timeoutMs = 60000) {
    // 1. Check local .peer-cache first
    const localChunkPath = path.join(this.cacheDir, hash + '.bin')
    try {
      const localBuf = await fs.promises.readFile(localChunkPath)
      return localBuf
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
