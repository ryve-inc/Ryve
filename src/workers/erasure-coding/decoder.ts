import * as b4a from 'b4a'
import { ReedSolomonErasure } from '@digitaldefiance/reed-solomon-erasure.wasm'
import { getRSInstance, DEFAULT_EC_K, DEFAULT_EC_M } from './rs-instance'

function requireShardSize(shardBuf: Uint8Array, chunkSize: number, index: number): void {
  if (!shardBuf || shardBuf.byteLength !== chunkSize) {
    throw new Error(
      `Shard ${index} has invalid size ${shardBuf?.byteLength ?? 0}, expected ${chunkSize}`
    )
  }
}

export function decodeBuffer(
  availableShardsMap: Map<number, Uint8Array>,
  k: number = DEFAULT_EC_K,
  m: number = DEFAULT_EC_M,
  chunkSize: number,
  originalSize: number
): Uint8Array {
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new Error(`Invalid erasure-coding chunk size: ${chunkSize}`)
  }
  const rs = getRSInstance()
  const totalShards = k + m

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
      const shardBuf = availableShardsMap.get(i)!
      requireShardSize(shardBuf, chunkSize, i)
      dataParts.push(shardBuf)
    }
    return b4a.concat(dataParts).subarray(0, originalSize)
  }

  let availableCount = 0
  const shardsAvailable = new Array<boolean>(totalShards).fill(false)
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

  const fullMemory = b4a.alloc(chunkSize * totalShards)
  for (let i = 0; i < totalShards; i++) {
    if (!shardsAvailable[i]) continue
    const shardBuf = availableShardsMap.get(i)!
    requireShardSize(shardBuf, chunkSize, i)
    b4a.copy(shardBuf, fullMemory, i * chunkSize)
  }

  const result = rs.reconstruct(fullMemory, k, m, shardsAvailable)
  if (result !== ReedSolomonErasure.RESULT_OK) {
    throw new Error(
      `Reed-Solomon reconstruction failed (${result}): ${ReedSolomonErasure.getResultMessage(result)}`
    )
  }

  return fullMemory.subarray(0, chunkSize * k).subarray(0, originalSize)
}
