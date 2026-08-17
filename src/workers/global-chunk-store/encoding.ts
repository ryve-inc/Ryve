import * as b4a from 'b4a'
import c from 'compact-encoding'
import type { ChunkMessage } from './types'

export const CHUNK_RPC_PROTOCOL = 'p2cloud-chunk-store-v2'

export const chunkMessageEncoding = {
  preencode(state: unknown, value: ChunkMessage) {
    c.string.preencode(state, value.hash || '')
    c.buffer.preencode(state, value.data || b4a.alloc(0))
    c.bool.preencode(state, value.ok !== false)
  },
  encode(state: unknown, value: ChunkMessage) {
    c.string.encode(state, value.hash || '')
    c.buffer.encode(state, value.data || b4a.alloc(0))
    c.bool.encode(state, value.ok !== false)
  },
  decode(state: unknown): ChunkMessage {
    return {
      hash: c.string.decode(state),
      data: c.buffer.decode(state),
      ok: c.bool.decode(state)
    }
  }
}

export function emptyChunkMessage(hash = ''): ChunkMessage {
  return { hash, data: b4a.alloc(0), ok: true }
}
