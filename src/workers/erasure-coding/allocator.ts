import type { FaultToleranceStatus } from '../../shared/types.ts'
import { DEFAULT_EC_K, DEFAULT_EC_M } from './rs-instance'
import type { ChunkPlacementResult, EncodedShard } from './types'

export function computeFaultTolerance(
  peerShardIndexes: Array<Set<number>>,
  k: number
): FaultToleranceStatus {
  const unique = new Set<number>()
  for (const shards of peerShardIndexes) {
    for (const index of shards) unique.add(index)
  }
  if (unique.size < k) return 'none'

  for (let drop = 0; drop < peerShardIndexes.length; drop++) {
    const remaining = new Set<number>()
    for (let i = 0; i < peerShardIndexes.length; i++) {
      if (i === drop) continue
      for (const index of peerShardIndexes[i]) remaining.add(index)
    }
    if (remaining.size < k) return 'degraded'
  }
  return 'full'
}

export function allocateChunksToPeers(
  chunks: EncodedShard[],
  peers: unknown[],
  K: number = DEFAULT_EC_K,
  M: number = DEFAULT_EC_M
): ChunkPlacementResult {
  const N = chunks.length
  if (N !== K + M) {
    throw new Error(`Expected ${K + M} chunks (K=${K}, M=${M}), got ${N}`)
  }
  const P = peers.length
  const distribution = new Map<unknown, EncodedShard[]>()
  const warnings: string[] = []

  for (const peer of peers) {
    distribution.set(peer, [])
  }

  if (P === 0) {
    warnings.push('No online peers connected. File stored in local cache only.')
    return { distribution, faultTolerance: 'none', warnings, maxChunksPerPeer: N }
  }

  if (P === 1) {
    distribution.get(peers[0])!.push(...chunks)
    warnings.push('Only 1 peer online. Remote copies depend on that peer remaining available.')
    return {
      distribution,
      faultTolerance: computeFaultTolerance([new Set(chunks.map((c) => c.index))], K),
      warnings,
      maxChunksPerPeer: N
    }
  }

  const dataChunks = chunks.filter((c) => !c.isParity)
  const parityChunks = chunks.filter((c) => c.isParity)
  const interleaved: EncodedShard[] = []
  const maxLen = Math.max(dataChunks.length, parityChunks.length)
  for (let i = 0; i < maxLen; i++) {
    if (i < dataChunks.length) interleaved.push(dataChunks[i])
    if (i < parityChunks.length) interleaved.push(parityChunks[i])
  }

  if (P === 2) {
    const targetPerPeer = K
    const step = Math.floor(N / P)
    peers.forEach((peer, pIdx) => {
      const peerList = distribution.get(peer)!
      const startOffset = (pIdx * step) % N
      for (let i = 0; i < targetPerPeer; i++) {
        const chunk = interleaved[(startOffset + i) % N]
        if (!peerList.some((c) => c.index === chunk.index)) {
          peerList.push(chunk)
        }
      }
    })
  } else {
    interleaved.forEach((chunk, i) => {
      distribution.get(peers[i % P])!.push(chunk)
    })
  }

  const lengths = Array.from(distribution.values()).map((list) => list.length)
  const maxChunksPerPeer = lengths.length ? Math.max(...lengths) : 0
  const planned = computeFaultTolerance(
    peers.map((peer) => new Set((distribution.get(peer) || []).map((c) => c.index))),
    K
  )

  if (P >= 3) {
    warnings.push(`Planned distribution across ${P} peers (${maxChunksPerPeer} chunks/peer).`)
  } else {
    warnings.push(`Planned 2-peer overlap (${maxChunksPerPeer} chunks/peer).`)
  }

  return {
    distribution,
    faultTolerance: planned,
    warnings,
    maxChunksPerPeer
  }
}
