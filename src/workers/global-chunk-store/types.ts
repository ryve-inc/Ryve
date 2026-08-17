import type { SwarmConnection } from 'hyperswarm'

export type ChunkMessage = {
  hash: string
  data: Uint8Array
  ok: boolean
}

export type ChunkRpcSession = {
  closed?: boolean
  request(method: string, value: ChunkMessage, opts?: { timeout?: number }): Promise<unknown>
  destroy?: () => void
}

export type SwarmSocket = SwarmConnection & {
  _chunkRpc?: ChunkRpcSession | null
}

export type GlobalChunkStoreOptions = {
  swarm: {
    connections: Set<SwarmSocket> | (Iterable<SwarmSocket> & { size: number })
    on(event: 'connection', listener: (conn: SwarmSocket) => void): unknown
    off(event: 'connection', listener: (conn: SwarmSocket) => void): unknown
    join(
      topic: Uint8Array,
      opts?: { server?: boolean; client?: boolean }
    ): { flushed(): Promise<void>; destroy(): Promise<void> }
  }
  storageDir: string
}
