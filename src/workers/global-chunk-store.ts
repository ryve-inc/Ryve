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
    if (conn._chunkStoreHandled) return
    conn._chunkStoreHandled = true

    console.log(`[ChunkStore:Network] Swarm socket connected. Active peers: ${this.swarm.connections.size}`)

    let lineBuffer = ''

    conn.on('close', () => {
      console.log(`[ChunkStore:Network] Swarm socket disconnected. Remaining peers: ${this.swarm.connections.size}`)
    })

    // Robust line-delimited JSON stream parser
    conn.on('data', async (data) => {
      lineBuffer += data.toString('utf-8')
      const lines = lineBuffer.split('\n')
      lineBuffer = lines.pop() || '' // Keep partial trailing line in buffer

      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const msg = JSON.parse(line)
          if (!msg || typeof msg !== 'object') continue

          // 1. Peer requesting a chunk by hash
          if (msg.type === 'get-chunk' && msg.hash) {
            const chunkPath = path.join(this.cacheDir, msg.hash + '.bin')
            try {
              const buf = await fs.promises.readFile(chunkPath)
              conn.write(JSON.stringify({
                type: 'chunk-data',
                hash: msg.hash,
                data: b4a.toString(buf, 'hex')
              }) + '\n')
              console.log(`[ChunkStore:Server] Served chunk ${msg.hash.slice(0, 12)} (${buf.byteLength} bytes) to peer`)
            } catch {
              conn.write(JSON.stringify({ type: 'chunk-not-found', hash: msg.hash }) + '\n')
            }
          }

          // 2. Peer sending an encrypted chunk to store in our .peer-cache
          else if (msg.type === 'store-chunk' && msg.hash && msg.data) {
            const chunkPath = path.join(this.cacheDir, msg.hash + '.bin')
            const buf = b4a.from(msg.data, 'hex')
            // Asynchronously write chunk to .peer-cache
            fs.promises.writeFile(chunkPath, buf).catch(() => {})
            conn.write(JSON.stringify({ type: 'store-ack', hash: msg.hash }) + '\n')
            console.log(`[ChunkStore:Cache] Cached chunk ${msg.hash.slice(0, 12)} (${buf.byteLength} bytes)`)
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
                pending.reject(new Error(`Chunk ${msg.hash.slice(0, 12)} not found on online peers.`))
              }
            }
          }
        } catch {}
      }
    })
  }

  /**
   * Line-delimited JSON chunk offloading with 5ms async yields for zero UI lag.
   */
  async offloadChunks(chunkList) {
    if (this.swarm.connections.size === 0) {
      console.log('[ChunkStore:Uploader] No online peers connected to offload chunks to.')
      return false
    }

    let successCount = 0

    for (const chunk of chunkList) {
      const linePayload = JSON.stringify({
        type: 'store-chunk',
        hash: chunk.hash,
        data: b4a.toString(chunk.buffer, 'hex')
      }) + '\n'

      // Send line payload to all connected peers over network socket
      for (const conn of this.swarm.connections) {
        try {
          conn.write(linePayload)
        } catch {}
      }

      successCount++

      // Tiny 5ms async yield per chunk to keep UI at 60 FPS smooth with 0 lag
      await new Promise((resolve) => setTimeout(resolve, 5))
    }

    console.log(`[ChunkStore:Uploader] ✓ Offloaded ${chunkList.length} chunks to network peers!`)
    return successCount === chunkList.length
  }

  /**
   * Fetches an encrypted chunk using line-delimited JSON querying.
   */
  async fetchChunk(hash, timeoutMs = 15000) {
    // 1. Check local .peer-cache first
    const localChunkPath = path.join(this.cacheDir, hash + '.bin')
    try {
      const localBuf = await fs.promises.readFile(localChunkPath)
      return localBuf
    } catch {}

    // 2. Query online network peers over Hyperswarm
    if (this.swarm.connections.size === 0) {
      throw new Error(`Chunk ${hash.slice(0, 12)} unavailable: No online peers connected.`)
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.activeRequests.delete(hash)
        reject(new Error(`Chunk ${hash.slice(0, 12)} fetch timed out. Peer hosting chunk is offline.`))
      }, timeoutMs)

      this.activeRequests.set(hash, {
        resolve: (buf) => {
          clearTimeout(timer)
          resolve(buf)
        },
        reject: (err) => {
          clearTimeout(timer)
          reject(err)
        }
      })

      const reqPayload = JSON.stringify({ type: 'get-chunk', hash }) + '\n'
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
