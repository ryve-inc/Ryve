// @ts-nocheck
import b4a from 'b4a'
import { ReedSolomonErasure } from '@digitaldefiance/reed-solomon-erasure.wasm'
import { getRSInstance, DEFAULT_EC_K, DEFAULT_EC_M } from './rs-instance'

/**
 * Encodes a buffer into K data shards + M parity shards using Reed-Solomon coding.
 */
export function encodeBuffer(
  dataBuffer: Uint8Array,
  k: number = DEFAULT_EC_K,
  m: number = DEFAULT_EC_M
): {
  k: number
  m: number
  chunkSize: number
  paddedSize: number
  shards: Array<{ index: number; isParity: boolean; buffer: Uint8Array }>
} {
  const rs = getRSInstance()
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
