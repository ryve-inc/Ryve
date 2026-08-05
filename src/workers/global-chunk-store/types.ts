export type ChunkRpcGetRequest = { hash: string }
export type ChunkRpcGetResponse = { hash: string; data: string }
export type ChunkRpcStoreRequest = { hash: string; data: string }
export type ChunkRpcStoreResponse = { ok: boolean; hash: string }

export type GlobalChunkStoreOptions = {
  swarm: any
  storageDir: string
}
