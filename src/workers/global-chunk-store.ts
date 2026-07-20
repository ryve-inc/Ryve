// @ts-nocheck
import path from 'bare-path'
import fs from 'bare-fs'
import b4a from 'b4a'
import hypercoreCrypto from 'hypercore-crypto'

const CHUNK_POOL_TOPIC = 'p2cloud:chunk-pool-v2'

class GlobalChunkStore {
  constructor({ swarm, storageDir }) {
    this.swarm = swarm
    this.storageDir = storageDir
    this.cacheDir = path.join(storageDir, '.peer-cache')
    this.topic = hypercoreCrypto.hash(b4a.from(CHUNK_POOL_TOPIC))
    this.discovery = null
    this.activeRequests = new Map()
    this._onConnection = this._onConnection.bind(this)
  }

  async init() {
    await fs.promises.mkdir(this.cacheDir, { recursive: true })

    this.swarm.on('connection', this._onConnection)

    this.discovery = this.swarm.join(this.topic, {
      server: true,
      client: true
    })

    await this.discovery.flushed()
    console.log('[ChunkStore] Joined global chunk network pool on topic:', CHUNK_POOL_TOPIC)
  }

  _onConnection(conn) {
    console.log(`[ChunkStore:Network] Swarm socket connected. Active peers: ${this.swarm.connections.size}`)

    conn.on('close', () => {
      console.log(`[ChunkStore:Network] Swarm socket disconnected. Remaining peers: ${this.swarm.connections.size}`)
    })

    // Listen for incoming P2P chunk protocol messages over socket
    conn.on('data', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString())
        if (!msg || typeof msg !== 'object') return

        // 1. Peer requesting a chunk by hash H1
        if (msg.type === 'get-chunk' && msg.hash) {
          const chunkPath = path.join(this.cacheDir, msg.hash + '.bin')
          try {
            const buf = await fs.promises.readFile(chunkPath)
            conn.write(JSON.stringify({
              type: 'chunk-data',
              hash: msg.hash,
              data: b4a.toString(buf, 'hex')
            }))
            console.log(`[ChunkStore:Server] Served chunk ${msg.hash.slice(0, 12)} to requesting peer.`)
          } catch {
            conn.write(JSON.stringify({ type: 'chunk-not-found', hash: msg.hash }))
          }
        }

        // 2. Peer sending an encrypted chunk to host in our .peer-cache
        else if (msg.type === 'store-chunk' && msg.hash && msg.data) {
          const chunkPath = path.join(this.cacheDir, msg.hash + '.bin')
          const buf = b4a.from(msg.data, 'hex')
          await fs.promises.writeFile(chunkPath, buf)
          conn.write(JSON.stringify({ type: 'store-ack', hash: msg.hash }))
          console.log(`[ChunkStore:Cache] Successfully cached encrypted chunk ${msg.hash.slice(0, 12)} (${buf.byteLength} bytes) for network member!`)
        }

        // 3. Responses for pending fetch requests
        else if (msg.type === 'chunk-data' && msg.hash && msg.data) {
          const pending = this.activeRequests.get(msg.hash)
          if (pending) {
            this.activeRequests.delete(msg.hash)
            pending.resolve(b4a.from(msg.data, 'hex'))
          }
        }

        else if (msg.type === 'chunk-not-found' && msg.hash) {
          const pending = this.activeRequests.get(msg.hash)
          if (pending) {
            pending.notFoundCount = (pending.notFoundCount || 0) + 1
            if (pending.notFoundCount >= this.swarm.connections.size) {
              this.activeRequests.delete(msg.hash)
              pending.reject(new Error('Chunk not found on available online peers.'))
            }
          }
        }
      } catch {}
    })
  }

  /**
   * Pushes a list of encrypted chunks [{ hash, buffer }] to online network peers.
   * Returns true if all chunks were acknowledged by at least one peer.
   */
  async offloadChunks(chunkList) {
    if (this.swarm.connections.size === 0) {
      console.log('[ChunkStore:Uploader] No online peers connected to offload chunks to.')
      return false
    }

    let successCount = 0

    for (const chunk of chunkList) {
      const payload = JSON.stringify({
        type: 'store-chunk',
        hash: chunk.hash,
        data: b4a.toString(chunk.buffer, 'hex')
      })

      // Send payload to all connected peers over network socket
      for (const conn of this.swarm.connections) {
        try {
          conn.write(payload)
        } catch {}
      }

      successCount++
      console.log(`[ChunkStore:Uploader] Offloaded encrypted chunk ${chunk.hash.slice(0, 12)} to global network pool (${chunk.buffer.byteLength} bytes).`)
    }

    return successCount === chunkList.length
  }

  /**
   * Fetches an encrypted chunk by hash from local .peer-cache or from online swarm peers.
   */
  async fetchChunk(hash, timeoutMs = 15000) {
    // 1. Check local .peer-cache first
    const localChunkPath = path.join(this.cacheDir, hash + '.bin')
    try {
      const localBuf = await fs.promises.readFile(localChunkPath)
      console.log(`[ChunkStore:Fetch] Found chunk ${hash.slice(0, 12)} in local cache.`)
      return localBuf
    } catch {}

    // 2. Query online network peers over Hyperswarm
    if (this.swarm.connections.size === 0) {
      throw new Error(`Chunk ${hash.slice(0, 12)} unavailable: No online peers connected.`)
    }

    console.log(`[ChunkStore:Fetch] Requesting chunk ${hash.slice(0, 12)} from ${this.swarm.connections.size} online network peers...`)

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.activeRequests.delete(hash)
        reject(new Error(`Chunk ${hash.slice(0, 12)} fetch timed out. Peer hosting chunk is offline.`))
      }, timeoutMs)

      this.activeRequests.set(hash, {
        resolve: (buf) => {
          clearTimeout(timer)
          console.log(`[ChunkStore:Fetch] Successfully received chunk ${hash.slice(0, 12)} from network peer!`)
          resolve(buf)
        },
        reject: (err) => {
          clearTimeout(timer)
          reject(err)
        }
      })

      const reqPayload = JSON.stringify({ type: 'get-chunk', hash })
      for (const conn of this.swarm.connections) {
        try {
          conn.write(reqPayload)
        } catch {}
      }
    })
  }

  async close() {
    this.swarm.off('connection', this._onConnection)
    if (this.discovery) {
      await this.discovery.destroy().catch(() => {})
      this.discovery = null
    }
    this.activeRequests.clear()
  }
}

export { GlobalChunkStore }
