import * as fs from 'bare-fs'
import { asBytes } from '../as-bytes'
import ProtomuxRPC from 'protomux-rpc'
import { CHUNK_RPC_PROTOCOL, chunkMessageEncoding, emptyChunkMessage } from './encoding'
import { chunkFilePath, hashBuffer, normalizeChunkHash, writeFileAtomic } from './util'
import type { ChunkMessage, SwarmSocket } from './types'

export const MAX_STORE_CHUNK_BYTES = 256 * 1024 * 1024
const MAX_IN_FLIGHT_STORES = 4

function asChunkMessage(req: unknown): ChunkMessage {
  if (!req || typeof req !== 'object') throw new Error('Invalid chunk payload')
  const value = req as Partial<ChunkMessage>
  if (typeof value.hash !== 'string') throw new Error('Invalid chunk payload')
  return {
    hash: value.hash,
    data: value.data instanceof Uint8Array ? value.data : emptyChunkMessage().data,
    ok: value.ok !== false
  }
}

export function setupConnectionRpc(
  conn: SwarmSocket,
  swarm: { connections: { size: number } },
  cacheDir: string
): void {
  if (conn._chunkRpc) return

  console.log(
    `[ChunkStore:Network] Swarm socket connected. Active peers: ${swarm.connections.size}`
  )

  const rpc = new ProtomuxRPC(conn, {
    protocol: CHUNK_RPC_PROTOCOL,
    valueEncoding: chunkMessageEncoding
  })

  conn._chunkRpc = rpc
  let inFlightStores = 0

  rpc.respond('get-chunk', async (req) => {
    const message = asChunkMessage(req)
    const hash = normalizeChunkHash(message.hash)
    const chunkPath = chunkFilePath(cacheDir, hash)
    let buf: Uint8Array
    try {
      buf = asBytes(await fs.promises.readFile(chunkPath))
    } catch {
      throw new Error(`Chunk ${hash.slice(0, 12)} not found in local cache`)
    }
    if (hashBuffer(buf) !== hash) {
      await fs.promises.unlink(chunkPath).catch(() => {})
      throw new Error(`Chunk ${hash.slice(0, 12)} failed integrity check`)
    }
    console.log(`[ChunkStore:Server] Serving chunk ${hash.slice(0, 12)} (${buf.byteLength} bytes)`)
    return { hash, data: buf, ok: true }
  })

  rpc.respond('store-chunk', async (req) => {
    if (inFlightStores >= MAX_IN_FLIGHT_STORES) {
      throw new Error('Too many in-flight store requests')
    }
    inFlightStores++
    try {
      const message = asChunkMessage(req)
      const hash = normalizeChunkHash(message.hash)
      const buf = message.data
      if (!buf.byteLength) throw new Error('Invalid store chunk payload')
      if (buf.byteLength > MAX_STORE_CHUNK_BYTES) {
        throw new Error(`Chunk ${hash.slice(0, 12)} exceeds size limit`)
      }
      if (hashBuffer(buf) !== hash) {
        throw new Error(`Chunk ${hash.slice(0, 12)} hash mismatch`)
      }
      await writeFileAtomic(chunkFilePath(cacheDir, hash), buf)
      console.log(
        `[ChunkStore:Cache] Stored chunk ${hash.slice(0, 12)} (${buf.byteLength} bytes) from remote peer`
      )
      return { hash, data: emptyChunkMessage().data, ok: true }
    } finally {
      inFlightStores--
    }
  })

  conn.on('close', () => {
    if (conn._chunkRpc === rpc) conn._chunkRpc = null
    if (typeof rpc.destroy === 'function') rpc.destroy()
    console.log(
      `[ChunkStore:Network] Swarm socket disconnected. Remaining peers: ${swarm.connections.size}`
    )
  })
}
