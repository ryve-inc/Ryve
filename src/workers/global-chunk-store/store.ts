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

  constructor({
    swarm,
    storageDir,
    publicCatalog = null,
    getNetworkKeyHex = null
  }: GlobalChunkStoreOptions & { publicCatalog?: any; getNetworkKeyHex?: (() => string | null) | null }) {
    this.swarm = swarm
    this.storageDir = storageDir
    this.cacheDir = path.join(storageDir, '.peer-cache')
    this.topic = null
    this.discovery = null
    this.publicCatalog = publicCatalog
    this.getNetworkKeyHex = getNetworkKeyHex
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
      this.getNetworkKeyHex || undefined
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
        await this.publicCatalog.mergeRemoteManifests(networkKeyHex, res.manifests)
        console.log(`[PublicCatalog:Sync] Merged ${res.manifests.length} public file manifest(s) from peer`)
      }
    } catch {}
  }

  async syncPublicCatalog(networkKeyHex: string) {
    const connections = Array.from(this.swarm.connections).filter((conn: any) => conn._chunkRpc && !conn._chunkRpc.closed)
    for (const conn of connections) {
      await this.syncPeerCatalog(conn, networkKeyHex).catch(() => {})
    }
  }

  async broadcastPublicFile(manifest: any) {
    const connections = Array.from(this.swarm.connections).filter((conn: any) => conn._chunkRpc && !conn._chunkRpc.closed)
    for (const conn of connections) {
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
   * Erasure Coding chunk offloading using dynamic peer-aware allocation.
   */
  async offloadChunks(chunkList: any[], K = DEFAULT_EC_K, M = DEFAULT_EC_M, keepLocalCopy = false) {
    // Save all chunks to local peer cache first for self-hosting / local fallback
    for (const chunk of chunkList) {
      const localPath = path.join(this.cacheDir, chunk.hash + '.bin')
      fs.promises.writeFile(localPath, chunk.buffer).catch(() => {})
    }

    const peers = Array.from(this.swarm.connections)
    const allocation = allocateChunksToPeers(chunkList, peers, K, M)

    if (allocation.warnings.length > 0) {
      for (const warn of allocation.warnings) {
        console.warn(`[ChunkStore:Uploader] ${warn}`)
      }
    }

    if (peers.length === 0) {
      console.log('[ChunkStore:Uploader] No online peers connected. Cached chunks locally.')
      return allocation
    }

    const offloadedHashes = new Set<string>()

    // Send allocated chunks to respective peers over connection sockets via RPC
    for (const [conn, peerChunks] of allocation.distribution.entries()) {
      const rpc = (conn as any)._chunkRpc
      if (!rpc || rpc.closed) continue
      for (const chunk of peerChunks) {
        try {
          await rpc.request('store-chunk', {
            hash: chunk.hash,
            data: b4a.toString(chunk.buffer, 'hex')
          })
          offloadedHashes.add(chunk.hash)
        } catch (err: any) {
          console.warn(`[ChunkStore:Uploader] Failed to store chunk ${chunk.hash.slice(0, 12)} on peer:`, err?.message || err)
        }
      }
    }

    // For private files (keepLocalCopy === false), purge successfully offloaded chunks from local storage to save space.
    // For public files (keepLocalCopy === true), retain local chunks so uploader serves as an active seed.
    if (!keepLocalCopy) {
      for (const hash of offloadedHashes) {
        const localPath = path.join(this.cacheDir, hash + '.bin')
        await fs.promises.unlink(localPath).catch(() => {})
      }
      console.log(
        `[ChunkStore:Uploader] ✓ Private upload: Offloaded ${chunkList.length} chunks across ${peers.length} peers. Purged ${offloadedHashes.size} local chunk file(s).`
      )
    } else {
      console.log(
        `[ChunkStore:Uploader] ✓ Public upload: Offloaded ${chunkList.length} chunks across ${peers.length} peers. Retained local chunk copies for seeding.`
      )
    }

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
  async fetchChunk(hash: string, timeoutMs = 15000) {
    // 1. Check local .peer-cache first
    const localChunkPath = path.join(this.cacheDir, hash + '.bin')
    try {
      const localBuf = await fs.promises.readFile(localChunkPath)
      return localBuf
    } catch {}

    // 2. Query online network peers over Protomux RPC
    const connections = Array.from(this.swarm.connections).filter((conn: any) => conn._chunkRpc && !conn._chunkRpc.closed)

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
