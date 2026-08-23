import type { ChunkPlacementResult, FaultToleranceStatus } from './types'

export const DEFAULT_EC_K = 2
export const DEFAULT_EC_M = 2

export interface ModeParameters {
  K: number
  M: number
  modeName: 'Extreme' | 'High' | 'Normal'
}

/**
 * Calculates adaptive (K, M) parameters based on connected peer count P.
 */
export function getAdaptiveParams(P: number): ModeParameters {
  if (P <= 1) {
    return { K: 1, M: 1, modeName: 'Extreme' }
  } else if (P <= 2) {
    return { K: 1, M: 2, modeName: 'Extreme' }
  } else if (P <= 4) {
    return { K: 2, M: 2, modeName: 'High' }
  } else {
    const K = Math.ceil(P / 2)
    const M = Math.max(2, Math.floor(P / 2))
    return { K, M, modeName: 'Normal' }
  }
}

/**
 * Distributes N chunks across P online peers using interleaved sliding group assignment.
 */
export function allocateChunksToPeers(
  chunks: Array<{ index: number; isParity: boolean; buffer: Uint8Array; hash: string }>,
  peers: any[],
  K: number = DEFAULT_EC_K,
  M: number = DEFAULT_EC_M
): ChunkPlacementResult {
  const N = chunks.length
  const P = peers.length
  const distribution = new Map<any, Array<{ index: number; isParity: boolean; buffer: Uint8Array; hash: string }>>()
  const warnings: string[] = []

  for (const peer of peers) {
    distribution.set(peer, [])
  }

  if (P === 0) {
    warnings.push('No online peers connected. File stored in local cache only.')
    return {
      distribution,
      faultTolerance: 'none',
      warnings,
      maxChunksPerPeer: N
    }
  }

  if (P === 1) {
    distribution.get(peers[0])!.push(...chunks)
    warnings.push('Extreme Mode: 1 peer online. Single-peer 100% full recovery enabled.')
    return {
      distribution,
      faultTolerance: 'full',
      warnings,
      maxChunksPerPeer: N
    }
  }

  // Interleaved sliding round-robin distribution
  const dataChunks = chunks.filter((c) => !c.isParity)
  const parityChunks = chunks.filter((c) => c.isParity)

  const interleaved: typeof chunks = []
  const maxLen = Math.max(dataChunks.length, parityChunks.length)
  for (let i = 0; i < maxLen; i++) {
    if (i < dataChunks.length) interleaved.push(dataChunks[i])
    if (i < parityChunks.length) interleaved.push(parityChunks[i])
  }

  interleaved.forEach((chunk, i) => {
    const peerIndex = i % P
    distribution.get(peers[peerIndex])!.push(chunk)
  })

  const maxChunksPerPeer = Math.max(...Array.from(distribution.values()).map((list) => list.length))
  const faultTolerance: FaultToleranceStatus = P >= 2 ? 'full' : 'degraded'

  warnings.push(`APRE Active: Distributed across ${P} peers. Need ${K} chunks to recover.`)

  return {
    distribution,
    faultTolerance,
    warnings,
    maxChunksPerPeer
  }
}
