import path from 'bare-path'
import fs from 'bare-fs'
import b4a from 'b4a'
import hypercoreCrypto from 'hypercore-crypto'

import { allocateChunksToPeers, DEFAULT_EC_K, DEFAULT_EC_M } from '../erasure-coding'
import { setupConnectionRpc } from './rpc-handler'
import type { GlobalChunkStoreOptions } from './types'

/**
 * Stateless GlobalChunkStore for P2P chunk offloading & retrieval.
 * Zero background daemons, zero idle CPU/RAM overhead, scale-proof.
 */
class GlobalChunkStore {
  swarm: any
  storageDir: string
  cacheDir: string
  topic: Uint8Array | null
  discovery: any
  publicCatalog: any
  getNetworkKeyHex: (() => string | null) | null
  onPublicCatalogUpdated: ((networkKeyHex: string) => void) | null

  constructor({
    swarm,
    storageDir,
    publicCatalog = null,
    getNetworkKeyHex = null,
    onPublicCatalogUpdated = null
  }: GlobalChunkStoreOptions & {
    publicCatalog?: any
    getNetworkKeyHex?: (() => string | null) | null
    onPublicCatalogUpdated?: ((networkKeyHex: string) => void) | null
  }) {
    this.swarm = swarm
    this.storageDir = storageDir
    this.cacheDir = path.join(storageDir, '.peer-cache')
    this.topic = null
    this.discovery = null
    this.publicCatalog = publicCatalog
    this.getNetworkKeyHex = getNetworkKeyHex
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

  async joinNetwork(swarmChunkTopic: Uint8Array) {
    await this.leaveNetwork()
    this.topic = swarmChunkTopic
    this.discovery = this.swarm.join(this.topic, {
      server: true,
      client: true
    })
    await this.discovery.flushed().catch(() => {})
    console.log('[ChunkStore] Joined private network chunk topic')
    if (this.getNetworkKeyHex) {
      const netKey = this.getNetworkKeyHex()
      if (netKey) this.syncPublicCatalog(netKey).catch(() => {})
    }
  }

  async leaveNetwork() {
    if (this.discovery) {
      await this.discovery.destroy().catch(() => {})
      this.discovery = null
    }
    this.topic = null
  }

  _onConnection(conn: any) {
    setupConnectionRpc(
      conn,
      this.swarm,
      this.cacheDir,
      this.publicCatalog,
      this.getNetworkKeyHex || undefined,
      this.onPublicCatalogUpdated || undefined
    )
    if (this.getNetworkKeyHex) {
      const netKey = this.getNetworkKeyHex()
      if (netKey) this.syncPeerCatalog(conn, netKey).catch(() => {})
    }
  }

  async syncPeerCatalog(conn: any, networkKeyHex: string) {
    const rpc = (conn as any)._chunkRpc
    if (!rpc || rpc.closed || !this.publicCatalog) return
    try {
      const res = await rpc.request('get-public-catalog', {}, { timeout: 10000 })
      if (res && Array.isArray(res.manifests) && res.manifests.length > 0) {
        const added = await this.publicCatalog.mergeRemoteManifests(networkKeyHex, res.manifests)
        if (added) {
          console.log(`[PublicCatalog:Sync] Merged ${res.manifests.length} public file manifest(s) from peer`)
          if (this.onPublicCatalogUpdated) {
            this.onPublicCatalogUpdated(networkKeyHex)
          }
        }
      }
    } catch {}
  }

  _getActiveRpcConnections(): any[] {
    return Array.from(this.swarm.connections).filter((conn: any) => conn._chunkRpc && !conn._chunkRpc.closed)
  }

  async syncPublicCatalog(networkKeyHex: string) {
    for (const conn of this._getActiveRpcConnections()) {
      await this.syncPeerCatalog(conn, networkKeyHex).catch(() => {})
    }
  }

  async broadcastPublicFile(manifest: any) {
    for (const conn of this._getActiveRpcConnections()) {
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
  async _distributeAndPruneChunks(chunkList: any[], allocation: any) {
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
              data: b4a.toString(chunk.buffer, 'hex')
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
      `[ChunkStore:Uploader] ✓ Offloaded ${chunkList.length} chunks across nodes (Self retained ${selfAssignedHashes.size} chunk(s), purged ${purgedCount} local chunk file(s)).`
    )
  }

  /**
   * Erasure Coding chunk offloading using dynamic peer-aware allocation across uploader and peers.
   */
  async offloadChunks(chunkList: any[], K = DEFAULT_EC_K, M = DEFAULT_EC_M) {
    // 1. Save all chunks to local peer cache first
    for (const chunk of chunkList) {
      const localPath = path.join(this.cacheDir, chunk.hash + '.bin')
      await fs.promises.writeFile(localPath, chunk.buffer).catch(() => {})
    }

    const selfNode = { isSelf: true }
    const remotePeers = Array.from(this.swarm.connections)
    const nodes = [selfNode, ...remotePeers]

    const allocation = allocateChunksToPeers(chunkList, nodes, K, M)

    if (allocation.warnings.length > 0) {
      for (const warn of allocation.warnings) {
        console.warn(`[ChunkStore:Uploader] ${warn}`)
      }
    }

    // 2. Distribute chunks to remote peers via RPC & prune unassigned local chunk files
    await this._distributeAndPruneChunks(chunkList, allocation)

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
   * Fetches an encrypted chunk using ProtomuxRPC querying.
   */
  async fetchChunk(hash: string, timeoutMs = 60000) {
    // 1. Check local .peer-cache first
    const localChunkPath = path.join(this.cacheDir, hash + '.bin')
    try {
      const localBuf = await fs.promises.readFile(localChunkPath)
      return localBuf
    } catch {}

    // 2. Query online network peers over Protomux RPC
    const connections = this._getActiveRpcConnections()

    if (connections.length === 0) {
      throw new Error(`Chunk ${hash.slice(0, 12)} unavailable: No online peers connected.`)
    }

    const requests = connections.map(async (conn: any) => {
      const rpc = conn._chunkRpc
      if (!rpc || rpc.closed) throw new Error('RPC closed')
      const res = await rpc.request('get-chunk', { hash }, { timeout: timeoutMs })
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
      throw new Error(`Chunk ${hash.slice(0, 12)} fetch failed: Not found or timed out across all connected peers.`)
    }
  }

  async close() {
    this.swarm.off('connection', this._onConnection)
    await this.leaveNetwork()
  }
}

export { GlobalChunkStore }
