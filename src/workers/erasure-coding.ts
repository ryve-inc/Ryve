// @ts-nocheck
import b4a from 'b4a'
import { ReedSolomonErasure } from '@digitaldefiance/reed-solomon-erasure.wasm'

export const DEFAULT_EC_K = 4
export const DEFAULT_EC_M = 2

let rsInstance: ReedSolomonErasure | null = null
let rsInitPromise: Promise<ReedSolomonErasure> | null = null

export async function getRSInstance(): Promise<ReedSolomonErasure> {
  if (rsInstance) return rsInstance
  if (!rsInitPromise) {
    rsInitPromise = (async () => {
      let fs: any
      let path: any

      if (typeof Bare !== 'undefined') {
        fs = (0, eval)('require')('bare-fs')
        path = (0, eval)('require')('bare-path')
      } else {
        const nodeFs = await import('node:fs')
        const nodePath = await import('node:path')
        fs = nodeFs.default || nodeFs
        path = nodePath.default || nodePath
      }

      if (!fs || !path) {
        throw new Error('[ErasureCoding] Could not initialize filesystem module.')
      }

      const candidatePaths = [
        path.resolve('dist/workers/reed_solomon_erasure_bg.wasm'),
        path.resolve('node_modules/@digitaldefiance/reed-solomon-erasure.wasm/dist/reed_solomon_erasure_bg.wasm'),
        './dist/workers/reed_solomon_erasure_bg.wasm',
        './node_modules/@digitaldefiance/reed-solomon-erasure.wasm/dist/reed_solomon_erasure_bg.wasm'
      ]

      let wasmBytes: Uint8Array | null = null
      for (const p of candidatePaths) {
        try {
          wasmBytes = fs.readFileSync(p)
          if (wasmBytes && wasmBytes.byteLength > 0) break
        } catch {}
      }

      if (!wasmBytes) {
        throw new Error('[ErasureCoding] Failed to locate reed_solomon_erasure_bg.wasm binary.')
      }

      rsInstance = ReedSolomonErasure.fromBytes(wasmBytes)
      return rsInstance
    })()
  }
  return rsInitPromise
}

export type FaultToleranceStatus = 'full' | 'degraded' | 'critical' | 'none'

export type ChunkPlacementResult = {
  distribution: Map<any, any[]>
  faultTolerance: FaultToleranceStatus
  warnings: string[]
  maxChunksPerPeer: number
}

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
  const distribution = new Map<any, any[]>()
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

  interleaved.forEach((chunk, i) => {
    const peerIndex = i % P
    distribution.get(peers[peerIndex])!.push(chunk)
  })

  const maxChunksPerPeer = Math.max(...Array.from(distribution.values()).map((list) => list.length))

  let faultTolerance: FaultToleranceStatus = 'full'

  if (maxChunksPerPeer > M) {
    faultTolerance = 'critical'
    warnings.push(
      `CRITICAL: A single peer holds ${maxChunksPerPeer} chunks, exceeding parity budget M=${M}. One disconnect will cause permanent data loss.`
    )
  } else if (P < N || maxChunksPerPeer > 1) {
    faultTolerance = 'degraded'
    warnings.push(
      `DEGRADED: Distributed across ${P} peers (max ${maxChunksPerPeer} chunks/peer). Single peer dropout is safe.`
    )
  }

  return {
    distribution,
    faultTolerance,
    warnings,
    maxChunksPerPeer
  }
}

/**
 * Encodes a buffer into K data shards + M parity shards using Reed-Solomon coding.
 */
export async function encodeBuffer(
  dataBuffer: Uint8Array,
  k: number = DEFAULT_EC_K,
  m: number = DEFAULT_EC_M
): Promise<{
  k: number
  m: number
  chunkSize: number
  paddedSize: number
  shards: Array<{ index: number; isParity: boolean; buffer: Uint8Array }>
}> {
  const rs = await getRSInstance()
  const rawSize = dataBuffer.byteLength

  // Shard size must be even integer (or multiple of 2) for RS WASM alignment
  let chunkSize = Math.ceil(rawSize / k)
  if (chunkSize % 2 !== 0) chunkSize += 1
  const paddedSize = chunkSize * k

  // Allocate contiguous memory for total (k + m) shards
  const totalSize = chunkSize * (k + m)
  const fullMemory = b4a.alloc(totalSize)

  // Copy original data into first k shards
  b4a.copy(dataBuffer, fullMemory, 0)

  // Perform Reed-Solomon encoding (fills parity shards in-place)
  const result = rs.encode(fullMemory, k, m)
  if (result !== ReedSolomonErasure.RESULT_OK) {
    const errorMsg = ReedSolomonErasure.getResultMessage(result)
    throw new Error(`Reed-Solomon encoding failed (${result}): ${errorMsg}`)
  }

  // Extract individual shard buffers
  const shards = []
  for (let i = 0; i < k + m; i++) {
    const start = i * chunkSize
    const end = start + chunkSize
    const shardBuf = fullMemory.subarray(start, end)
    shards.push({
      index: i,
      isParity: i >= k,
      buffer: b4a.from(shardBuf)
    })
  }

  return {
    k,
    m,
    chunkSize,
    paddedSize,
    shards
  }
}

/**
 * Reconstructs original data buffer from available shards (up to m missing shards allowed).
 */
export async function decodeBuffer(
  availableShardsMap: Map<number, Uint8Array>,
  k: number = DEFAULT_EC_K,
  m: number = DEFAULT_EC_M,
  chunkSize: number,
  originalSize: number
): Promise<Uint8Array> {
  const rs = await getRSInstance()
  const totalShards = k + m

  // Check if all K data shards (0..k-1) are present for fast-path bypass
  let allDataPresent = true
  for (let i = 0; i < k; i++) {
    if (!availableShardsMap.has(i)) {
      allDataPresent = false
      break
    }
  }

  if (allDataPresent) {
    const dataParts = []
    for (let i = 0; i < k; i++) {
      dataParts.push(availableShardsMap.get(i)!)
    }
    const concatenated = b4a.concat(dataParts)
    return concatenated.subarray(0, originalSize)
  }

  // Count available shards
  let availableCount = 0
  const shardsAvailable = new Array(totalShards).fill(false)
  for (let i = 0; i < totalShards; i++) {
    if (availableShardsMap.has(i)) {
      shardsAvailable[i] = true
      availableCount++
    }
  }

  if (availableCount < k) {
    throw new Error(
      `Insufficient shards for reconstruction: received ${availableCount} valid shards, need at least K=${k}`
    )
  }

  // Assemble contiguous memory buffer for RS reconstruct call
  const totalSize = chunkSize * totalShards
  const fullMemory = b4a.alloc(totalSize)

  for (let i = 0; i < totalShards; i++) {
    if (shardsAvailable[i]) {
      const shardBuf = availableShardsMap.get(i)!
      const offset = i * chunkSize
      b4a.copy(shardBuf, fullMemory, offset)
    }
  }

  // Execute RS reconstruction
  const result = rs.reconstruct(fullMemory, k, m, shardsAvailable)
  if (result !== ReedSolomonErasure.RESULT_OK) {
    const errorMsg = ReedSolomonErasure.getResultMessage(result)
    throw new Error(`Reed-Solomon reconstruction failed (${result}): ${errorMsg}`)
  }

  // Extract reconstructed data shards (0..k-1) and return original size
  const dataSubarray = fullMemory.subarray(0, chunkSize * k)
  return dataSubarray.subarray(0, originalSize)
}
