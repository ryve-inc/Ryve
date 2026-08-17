import path from 'bare-path'
import * as fs from 'bare-fs'
import * as b4a from 'b4a'
import hypercoreCrypto from 'hypercore-crypto'
import {
  allocateChunksToPeers,
  computeFaultTolerance,
  DEFAULT_EC_K,
  DEFAULT_EC_M
} from '../erasure-coding'
import type { EncodedShard, ChunkPlacementResult } from '../erasure-coding'
import type { FaultToleranceStatus } from '../../shared/types.ts'
import { setupConnectionRpc } from './rpc-handler'
import { emptyChunkMessage } from './encoding'
import { chunkFilePath, hashBuffer, normalizeChunkHash, writeFileAtomic } from './util'
import { asBytes } from '../as-bytes'
import type { GlobalChunkStoreOptions, SwarmSocket } from './types'

const CHUNK_POOL_TOPIC = 'p2cloud:chunk-pool-v2'

export class GlobalChunkStore {
  swarm: GlobalChunkStoreOptions['swarm']
  storageDir: string
  cacheDir: string
  topic: Uint8Array
  discovery: { flushed(): Promise<void>; destroy(): Promise<void> } | null
  ready: Promise<void>
  private _initPromise: Promise<void> | null
  private readonly _onConnection: (conn: SwarmSocket) => void

  constructor({ swarm, storageDir }: GlobalChunkStoreOptions) {
    this.swarm = swarm
    this.storageDir = storageDir
    this.cacheDir = path.join(storageDir, '.peer-cache')
    this.topic = hypercoreCrypto.hash(b4a.from(CHUNK_POOL_TOPIC))
    this.discovery = null
    this._initPromise = null
    this._onConnection = this._handleConnection.bind(this)
    this.ready = this.init()
  }

  async init(): Promise<void> {
    if (!this._initPromise) this._initPromise = this._doInit()
    return this._initPromise
  }

  private async _doInit(): Promise<void> {
    await fs.promises.mkdir(this.cacheDir, { recursive: true })
    this.swarm.on('connection', this._onConnection)
    for (const conn of this.swarm.connections) {
      this._onConnection(conn)
    }
    this.discovery = this.swarm.join(this.topic, { server: true, client: true })
    await this.discovery.flushed()
    console.log('[ChunkStore] Joined global chunk network pool on topic:', CHUNK_POOL_TOPIC)
  }

  private _handleConnection(conn: SwarmSocket): void {
    setupConnectionRpc(conn, this.swarm, this.cacheDir)
  }

  private async _readVerifiedLocal(hash: string): Promise<Uint8Array | null> {
    const normalized = normalizeChunkHash(hash)
    const localPath = chunkFilePath(this.cacheDir, normalized)
    let localBuf: Uint8Array
    try {
      localBuf = asBytes(await fs.promises.readFile(localPath))
    } catch {
      return null
    }
    if (hashBuffer(localBuf) !== normalized) {
      await fs.promises.unlink(localPath).catch(() => {})
      return null
    }
    return localBuf
  }

  async verifyLocalChunks(hashes: string[]): Promise<void> {
    await this.init()
    for (const hash of hashes) {
      const buf = await this._readVerifiedLocal(hash)
      if (!buf) {
        const short = typeof hash === 'string' ? hash.slice(0, 12) : '?'
        throw new Error(`Chunk ${short} missing from local cache`)
      }
    }
  }

  async offloadChunks(
    chunkList: EncodedShard[],
    K = DEFAULT_EC_K,
    M = DEFAULT_EC_M
  ): Promise<ChunkPlacementResult> {
    await this.init()

    await Promise.all(
      chunkList.map(async (chunk) => {
        const hash = normalizeChunkHash(chunk.hash || '')
        if (hashBuffer(chunk.buffer) !== hash) {
          throw new Error(`Chunk ${hash.slice(0, 12)} buffer hash mismatch before cache write`)
        }
        chunk.hash = hash
        await writeFileAtomic(chunkFilePath(this.cacheDir, hash), chunk.buffer)
      })
    )

    const peers = Array.from(this.swarm.connections)
    const allocation = allocateChunksToPeers(chunkList, peers, K, M)

    for (const warn of allocation.warnings) {
      console.warn(`[ChunkStore:Uploader] ${warn}`)
    }

    const offloadedHashes = new Set<string>()
    const peerShards: Array<Set<number>> = []

    await Promise.all(
      Array.from(allocation.distribution.entries()).map(async ([conn, peerChunks]) => {
        const rpc = (conn as SwarmSocket)._chunkRpc
        if (!rpc || rpc.closed) return
        const stored = new Set<number>()
        await Promise.all(
          peerChunks.map(async (chunk) => {
            try {
              await rpc.request('store-chunk', {
                hash: chunk.hash || '',
                data: chunk.buffer,
                ok: true
              })
              offloadedHashes.add(chunk.hash || '')
              stored.add(chunk.index)
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err)
              console.warn(
                `[ChunkStore:Uploader] Failed to store chunk ${String(chunk.hash || '').slice(0, 12)} on peer:`,
                message
              )
            }
          })
        )
        if (stored.size) peerShards.push(stored)
      })
    )

    const faultTolerance: FaultToleranceStatus = computeFaultTolerance(peerShards, K)
    allocation.faultTolerance = faultTolerance

    console.log(
      `[ChunkStore:Uploader] Cached ${chunkList.length} chunks locally; stored ${offloadedHashes.size} unique hashes on ${peerShards.length} remote peer(s) (Status: ${faultTolerance}).`
    )
    return allocation
  }

  async purgeChunks(hashes: string[]): Promise<void> {
    await this.init()
    for (const hash of hashes) {
      if (!hash) continue
      try {
        await fs.promises.unlink(chunkFilePath(this.cacheDir, hash)).catch(() => {})
      } catch {
        // Invalid hash — skip
      }
    }
  }

  async fetchChunk(hash: string, timeoutMs = 15000): Promise<Uint8Array> {
    await this.init()
    const normalized = normalizeChunkHash(hash)

    const localBuf = await this._readVerifiedLocal(normalized)
    if (localBuf) return localBuf

    const connections = Array.from(this.swarm.connections).filter(
      (conn) => conn._chunkRpc && !conn._chunkRpc.closed
    )

    if (connections.length === 0) {
      throw new Error(`Chunk ${normalized.slice(0, 12)} unavailable: No online peers connected.`)
    }

    const requests = connections.map(async (conn) => {
      const rpc = conn._chunkRpc
      if (!rpc || rpc.closed) throw new Error('RPC closed')
      const res = await rpc.request('get-chunk', emptyChunkMessage(normalized), {
        timeout: timeoutMs
      })
      const data =
        res && typeof res === 'object' && 'data' in res ? (res as { data?: Uint8Array }).data : null
      if (data && data.byteLength) {
        if (hashBuffer(data) === normalized) {
          await writeFileAtomic(chunkFilePath(this.cacheDir, normalized), data).catch(() => {})
          return data
        }
      }
      throw new Error('Hash mismatch or invalid data')
    })

    try {
      return await Promise.any(requests)
    } catch {
      throw new Error(
        `Chunk ${normalized.slice(0, 12)} fetch failed: Not found or timed out across all connected peers.`
      )
    }
  }

  async close(): Promise<void> {
    this.swarm.off('connection', this._onConnection)
    for (const conn of this.swarm.connections) {
      const rpc = conn._chunkRpc
      if (!rpc) continue
      conn._chunkRpc = null
      if (typeof rpc.destroy === 'function') {
        try {
          rpc.destroy()
        } catch {
          // Ignore destroy races
        }
      }
    }
    if (this.discovery) {
      await this.discovery.destroy().catch(() => {})
      this.discovery = null
    }
  }
}

export { CHUNK_POOL_TOPIC }
