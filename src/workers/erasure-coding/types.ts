// @ts-nocheck
export type FaultToleranceStatus = 'full' | 'degraded' | 'critical' | 'none'

export type ChunkPlacementResult = {
  distribution: Map<any, any[]>
  faultTolerance: FaultToleranceStatus
  warnings: string[]
  maxChunksPerPeer: number
}
