// @ts-nocheck
import path from 'bare-path'
import fs from 'bare-fs'
import b4a from 'b4a'
import hypercoreCrypto from 'hypercore-crypto'

const CHUNK_POOL_TOPIC = 'p2cloud:chunk-pool-v2'

// Binary Command IDs
const CMD_STORE_CHUNK = 0x01
const CMD_GET_CHUNK = 0x02
const CMD_CHUNK_DATA = 0x03
const CMD_NOT_FOUND = 0x04

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

    let buffer = b4a.alloc(0)

    conn.on('close', () => {
      console.log(`[ChunkStore:Network] Swarm socket disconnected. Remaining peers: ${this.swarm.connections.size}`)
    })

    // Zero-copy binary stream parser
    conn.on('data', async (data) => {
      buffer = b4a.concat([buffer, data])

      while (buffer.byteLength > 0) {
        const cmd = buffer[0]

        // 1. STORE_CHUNK: [1 byte cmd] [32 bytes hash] [4 bytes len] [payload]
        if (cmd === CMD_STORE_CHUNK) {
          if (buffer.byteLength < 37) break // Wait for header
          const hash = b4a.toString(buffer.subarray(1, 33), 'ascii')
          const length = buffer.readUInt32BE(33)
          const totalPacketSize = 37 + length
          if (buffer.byteLength < totalPacketSize) break // Wait for full payload

          const chunkBuf = buffer.subarray(37, totalPacketSize)
          const chunkPath = path.join(this.cacheDir, hash + '.bin')
          
          // Asynchronously write binary payload directly to cache without blocking thread
          fs.promises.writeFile(chunkPath, chunkBuf).catch(() => {})
          console.log(`[ChunkStore:Cache] Cached binary chunk ${hash.slice(0, 12)} (${length} bytes)`)

          buffer = buffer.subarray(totalPacketSize)
        }

        // 2. GET_CHUNK: [1 byte cmd] [32 bytes hash]
        else if (cmd === CMD_GET_CHUNK) {
          if (buffer.byteLength < 33) break
          const hash = b4a.toString(buffer.subarray(1, 33), 'ascii')
          buffer = buffer.subarray(33)

          const chunkPath = path.join(this.cacheDir, hash + '.bin')
          try {
            const rawBuf = await fs.promises.readFile(chunkPath)
            // Respond with binary frame: [0x03] [32b hash] [4b len] [payload]
            const header = b4a.alloc(37)
            header[0] = CMD_CHUNK_DATA
            header.write(hash, 1, 32, 'ascii')
            header.writeUInt32BE(rawBuf.byteLength, 33)
            conn.write(b4a.concat([header, rawBuf]))
            console.log(`[ChunkStore:Server] Served binary chunk ${hash.slice(0, 12)} (${rawBuf.byteLength} bytes)`)
          } catch {
            const notFoundHeader = b4a.alloc(33)
            notFoundHeader[0] = CMD_NOT_FOUND
            notFoundHeader.write(hash, 1, 32, 'ascii')
            conn.write(notFoundHeader)
          }
        }

        // 3. CHUNK_DATA: [1 byte cmd] [32 bytes hash] [4 bytes len] [payload]
        else if (cmd === CMD_CHUNK_DATA) {
          if (buffer.byteLength < 37) break
          const hash = b4a.toString(buffer.subarray(1, 33), 'ascii')
          const length = buffer.readUInt32BE(33)
          const totalPacketSize = 37 + length
          if (buffer.byteLength < totalPacketSize) break

          const chunkBuf = b4a.from(buffer.subarray(37, totalPacketSize))
          buffer = buffer.subarray(totalPacketSize)

          const pending = this.activeRequests.get(hash)
          if (pending) {
            this.activeRequests.delete(hash)
            pending.resolve(chunkBuf)
          }
        }

        // 4. NOT_FOUND: [1 byte cmd] [32 bytes hash]
        else if (cmd === CMD_NOT_FOUND) {
          if (buffer.byteLength < 33) break
          const hash = b4a.toString(buffer.subarray(1, 33), 'ascii')
          buffer = buffer.subarray(33)

          const pending = this.activeRequests.get(hash)
          if (pending) {
            pending.notFoundCount = (pending.notFoundCount || 0) + 1
            if (pending.notFoundCount >= this.swarm.connections.size) {
              this.activeRequests.delete(hash)
              pending.reject(new Error(`Chunk ${hash.slice(0, 12)} not found on online peers.`))
            }
          }
        }

        else {
          // Unknown header byte: discard byte and resync
          buffer = buffer.subarray(1)
        }
      }
    })
  }

  /**
   * Fast, zero-copy binary chunk offloading using sliding window backpressure.
   */
  async offloadChunks(chunkList) {
    if (this.swarm.connections.size === 0) {
      console.log('[ChunkStore:Uploader] No online peers connected to offload chunks to.')
      return false
    }

    const BATCH_SIZE = 4 // Process 4 chunks per batch (Sliding Window)

    for (let i = 0; i < chunkList.length; i += BATCH_SIZE) {
      const batch = chunkList.slice(i, i + BATCH_SIZE)

      for (const chunk of batch) {
        // Construct binary packet: [0x01] [32b hash] [4b len] [payload]
        const header = b4a.alloc(37)
        header[0] = CMD_STORE_CHUNK
        header.write(chunk.hash, 1, 32, 'ascii')
        header.writeUInt32BE(chunk.buffer.byteLength, 33)

        const packet = b4a.concat([header, chunk.buffer])

        for (const conn of this.swarm.connections) {
          try {
            const drained = conn.write(packet)
            // Respect socket backpressure if write buffer is full
            if (!drained && conn.once) {
              await new Promise((res) => conn.once('drain', res))
            }
          } catch {}
        }
      }

      // Small 10ms yield to keep JavaScript event loop 100% smooth and lag-free
      await new Promise((res) => setTimeout(res, 10))
    }

    console.log(`[ChunkStore:Uploader] ✓ Fast binary offload of ${chunkList.length} chunks completed!`)
    return true
  }

  /**
   * Fetches an encrypted chunk using binary framing.
   */
  async fetchChunk(hash, timeoutMs = 15000) {
    // 1. Check local .peer-cache first
    const localChunkPath = path.join(this.cacheDir, hash + '.bin')
    try {
      const localBuf = await fs.promises.readFile(localChunkPath)
      return localBuf
    } catch {}

    // 2. Request chunk from online network peers using binary command 0x02
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

      // Send binary request: [0x02] [32b hash]
      const reqHeader = b4a.alloc(33)
      reqHeader[0] = CMD_GET_CHUNK
      reqHeader.write(hash, 1, 32, 'ascii')

      for (const conn of this.swarm.connections) {
        try {
          conn.write(reqHeader)
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
