import type { FaultToleranceStatus } from '../../shared/types.ts'

export type EncodedShard = {
  index: number
  isParity: boolean
  buffer: Uint8Array
  hash?: string
}

export type ChunkPlacementResult = {
  distribution: Map<unknown, EncodedShard[]>
  faultTolerance: FaultToleranceStatus
  warnings: string[]
  maxChunksPerPeer: number
}

export type { FaultToleranceStatus }
