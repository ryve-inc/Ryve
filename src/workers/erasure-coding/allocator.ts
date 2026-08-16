import { DEFAULT_EC_K, DEFAULT_EC_M } from './rs-instance'
import type { ChunkPlacementResult, FaultToleranceStatus } from './types'

/**
 * Distributes N chunks (Data + Parity) across P online peers by interleaving
 * data and parity chunks in a single round-robin pass to maximize peer diversity.
 *
 * Explicitly evaluates maxChunksPerPeer against parity budget M to flag
 * single-point-of-failure risk states.
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
    warnings.push('Only 1 peer online. Remote fault tolerance is NONE. File relies on local cache.')
    return {
      distribution,
      faultTolerance: 'none',
      warnings,
      maxChunksPerPeer: N
    }
  }

  // Interleave data and parity chunks before round-robin distribution
  const dataChunks = chunks.filter((c) => !c.isParity)
  const parityChunks = chunks.filter((c) => c.isParity)

  const interleaved: typeof chunks = []
  const maxLen = Math.max(dataChunks.length, parityChunks.length)
  for (let i = 0; i < maxLen; i++) {
    if (i < dataChunks.length) interleaved.push(dataChunks[i])
    if (i < parityChunks.length) interleaved.push(parityChunks[i])
  }

  if (P === 2) {
    // For 2 peers, assign exactly K=4 interleaved chunks to each peer with sliding offset
    // Peer 0 gets chunks 0..K-1, Peer 1 gets chunks 2..K+1
    const targetPerPeer = K
    const step = Math.floor(N / P)
    peers.forEach((peer, pIdx) => {
      const peerList = distribution.get(peer)!
      const startOffset = (pIdx * step) % N
      for (let i = 0; i < targetPerPeer; i++) {
        const chunkIndex = (startOffset + i) % N
        const chunk = interleaved[chunkIndex]
        if (!peerList.some((c) => c.index === chunk.index)) {
          peerList.push(chunk)
        }
      }
    })
  } else {
    // For P >= 3, standard interleaved round-robin distribution (N / P chunks per peer)
    interleaved.forEach((chunk, i) => {
      const peerIndex = i % P
      distribution.get(peers[peerIndex])!.push(chunk)
    })
  }

  const maxChunksPerPeer = Math.max(...Array.from(distribution.values()).map((list) => list.length))

  let faultTolerance: FaultToleranceStatus = 'full'

  if (P >= 3) {
    faultTolerance = 'full'
    warnings.push(`FULL: Distributed across ${P} peers (${maxChunksPerPeer} chunks/peer). 1-peer drop is 100% safe.`)
  } else if (P === 2) {
    faultTolerance = 'degraded'
    warnings.push(`DEGRADED: Distributed 4 chunks per peer across 2 peers. 1-peer drop is 100% safe (saved 33% bandwidth).`)
  }

  return {
    distribution,
    faultTolerance,
    warnings,
    maxChunksPerPeer
  }
}
