import b4a from 'b4a'
import { ReedSolomonErasure } from '@digitaldefiance/reed-solomon-erasure.wasm'
import { getRSInstance, DEFAULT_EC_K, DEFAULT_EC_M } from './rs-instance'

/**
 * Reconstructs original data buffer from available shards (up to m missing shards allowed).
 */
export function decodeBuffer(
  availableShardsMap: Map<number, Uint8Array>,
  k: number = DEFAULT_EC_K,
  m: number = DEFAULT_EC_M,
  chunkSize: number,
  originalSize: number
): Uint8Array {
  const rs = getRSInstance()
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
    const dataParts: Uint8Array[] = []
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

