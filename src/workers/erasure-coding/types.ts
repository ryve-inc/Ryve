export type FaultToleranceStatus = 'full' | 'degraded' | 'critical' | 'none'

export type ChunkPlacementResult = {
  distribution: Map<any, Array<{ index: number; isParity: boolean; buffer: Uint8Array; hash: string }>>
  faultTolerance: FaultToleranceStatus
  warnings: string[]
  maxChunksPerPeer: number
}

