// @ts-nocheck
import path from 'bare-path'
import fs from 'bare-fs'
import b4a from 'b4a'
import hypercoreCrypto from 'hypercore-crypto'

import { allocateChunksToPeers, DEFAULT_EC_K, DEFAULT_EC_M } from '../erasure-coding'
import { setupConnectionRpc } from './rpc-handler'
import type { GlobalChunkStoreOptions } from './types'

const CHUNK_POOL_TOPIC = 'p2cloud:chunk-pool-v2'

class GlobalChunkStore {
  swarm: any
  storageDir: string
  cacheDir: string
  topic: Uint8Array
  discovery: any

  constructor({ swarm, storageDir }: GlobalChunkStoreOptions) {
    this.swarm = swarm
    this.storageDir = storageDir
    this.cacheDir = path.join(storageDir, '.peer-cache')
    this.topic = hypercoreCrypto.hash(b4a.from(CHUNK_POOL_TOPIC))
    this.discovery = null
    this._onConnection = this._onConnection.bind(this)
  }

  async init() {
    await fs.promises.mkdir(this.cacheDir, { recursive: true })

    this.swarm.on('connection', this._onConnection)
    for (const conn of this.swarm.connections) {
      this._onConnection(conn)
    }

    this.discovery = this.swarm.join(this.topic, {
      server: true,
      client: true
    })

    await this.discovery.flushed()
    console.log('[ChunkStore] Joined global chunk network pool on topic:', CHUNK_POOL_TOPIC)
  }

  _onConnection(conn: any) {
    setupConnectionRpc(conn, this.swarm, this.cacheDir)
  }

  /**
   * Erasure Coding chunk offloading using allocateChunksToPeers diversity placement algorithm.
   */
  async offloadChunks(chunkList: any[], K = DEFAULT_EC_K, M = DEFAULT_EC_M) {
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

    // Delete successfully offloaded chunks from local storage to save space
    for (const hash of offloadedHashes) {
      const localPath = path.join(this.cacheDir, hash + '.bin')
      await fs.promises.unlink(localPath).catch(() => {})
    }

    console.log(
      `[ChunkStore:Uploader] ✓ Offloaded ${chunkList.length} chunks across ${peers.length} peers (Status: ${allocation.faultTolerance}). Purged ${offloadedHashes.size} local chunk file(s).`
    )
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
    if (this.discovery) {
      await this.discovery.destroy().catch(() => {})
      this.discovery = null
    }
  }
}

export { GlobalChunkStore, CHUNK_POOL_TOPIC }
