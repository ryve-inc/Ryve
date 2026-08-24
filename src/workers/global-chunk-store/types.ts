export type ChunkRpcGetRequest = { hash: string; networkKeyHex?: string }
export type ChunkRpcGetResponse = { hash: string; data: string }
export type ChunkRpcStoreRequest = { hash: string; data: string; networkKeyHex?: string }
export type ChunkRpcStoreResponse = { ok: boolean; hash: string }

export type GlobalChunkStoreOptions = {
  swarm: any
  storageDir: string
  publicCatalog?: any
  getNetworkKeyHex?: (() => string | null) | null
  getJoinedNetworkKeys?: (() => string[]) | null
  isNetworkJoined?: ((networkKeyHex: string) => boolean) | null
  onPublicCatalogUpdated?: ((networkKeyHex: string) => void) | null
}
