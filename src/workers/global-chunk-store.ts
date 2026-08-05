// @ts-nocheck
import path from 'bare-path'
import fs from 'bare-fs'
import b4a from 'b4a'
import hypercoreCrypto from 'hypercore-crypto'
import ProtomuxRPC from 'protomux-rpc'
import c from 'compact-encoding'

import { allocateChunksToPeers, DEFAULT_EC_K, DEFAULT_EC_M } from './erasure-coding'

const CHUNK_POOL_TOPIC = 'p2cloud:chunk-pool-v2'

class GlobalChunkStore {
  constructor({ swarm, storageDir }) {
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

  _onConnection(conn) {
    if (conn._chunkRpc) return

    console.log(`[ChunkStore:Network] Swarm socket connected. Active peers: ${this.swarm.connections.size}`)

    const rpc = new ProtomuxRPC(conn, {
      protocol: 'p2cloud-chunk-store-v1',
      valueEncoding: c.json
    })

    conn._chunkRpc = rpc

    rpc.respond('get-chunk', async (req) => {
      if (!req || !req.hash) throw new Error('Invalid request')
      const chunkPath = path.join(this.cacheDir, req.hash + '.bin')
      try {
        const buf = await fs.promises.readFile(chunkPath)
        console.log(`[ChunkStore:Server] Serving chunk ${req.hash.slice(0, 12)} (${buf.byteLength} bytes)`)
        return { hash: req.hash, data: b4a.toString(buf, 'hex') }
      } catch (err) {
        throw new Error(`Chunk ${req.hash.slice(0, 12)} not found in local cache`)
      }
    })

    rpc.respond('store-chunk', async (req) => {
      if (!req || !req.hash || !req.data) throw new Error('Invalid store chunk payload')
      const chunkPath = path.join(this.cacheDir, req.hash + '.bin')
      const buf = b4a.from(req.data, 'hex')
      await fs.promises.writeFile(chunkPath, buf)
      console.log(`[ChunkStore:Cache] Stored chunk ${req.hash.slice(0, 12)} (${buf.byteLength} bytes) from remote peer`)
      return { ok: true, hash: req.hash }
    })

    conn.on('close', () => {
      console.log(`[ChunkStore:Network] Swarm socket disconnected. Remaining peers: ${this.swarm.connections.size}`)
    })
  }

  /**
   * Erasure Coding chunk offloading using allocateChunksToPeers diversity placement algorithm.
   */
  async offloadChunks(chunkList, K = DEFAULT_EC_K, M = DEFAULT_EC_M) {
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

    // Send allocated chunks to respective peers over connection sockets via RPC
    for (const [conn, peerChunks] of allocation.distribution.entries()) {
      const rpc = conn._chunkRpc
      if (!rpc || rpc.closed) continue
      for (const chunk of peerChunks) {
        try {
          await rpc.request('store-chunk', {
            hash: chunk.hash,
            data: b4a.toString(chunk.buffer, 'hex')
          })
        } catch (err) {
          console.warn(`[ChunkStore:Uploader] Failed to store chunk ${chunk.hash.slice(0, 12)} on peer:`, err?.message || err)
        }
      }
    }

    console.log(
      `[ChunkStore:Uploader] ✓ Offloaded ${chunkList.length} chunks across ${peers.length} peers (Status: ${allocation.faultTolerance}, Max/Peer: ${allocation.maxChunksPerPeer})`
    )
    return allocation
  }

  /**
   * Fetches an encrypted chunk using ProtomuxRPC querying.
   */
  async fetchChunk(hash, timeoutMs = 15000) {
    // 1. Check local .peer-cache first
    const localChunkPath = path.join(this.cacheDir, hash + '.bin')
    try {
      const localBuf = await fs.promises.readFile(localChunkPath)
      return localBuf
    } catch {}

    // 2. Query online network peers over Protomux RPC
    const connections = Array.from(this.swarm.connections).filter((conn) => conn._chunkRpc && !conn._chunkRpc.closed)

    if (connections.length === 0) {
      throw new Error(`Chunk ${hash.slice(0, 12)} unavailable: No online peers connected.`)
    }

    const requests = connections.map(async (conn) => {
      const rpc = conn._chunkRpc
      if (!rpc || rpc.closed) throw new Error('RPC closed')
      const res = await rpc.request('get-chunk', { hash }, { timeout: timeoutMs })
      if (res && res.data) {
        const buf = b4a.from(res.data, 'hex')
        const actualHash = b4a.toString(hypercoreCrypto.hash(buf), 'hex')
        if (actualHash === hash) {
          // Cache locally for faster future lookups
          fs.promises.writeFile(localChunkPath, buf).catch(() => {})
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

export { GlobalChunkStore }

