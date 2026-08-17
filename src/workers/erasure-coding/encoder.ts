import * as b4a from 'b4a'
import { ReedSolomonErasure } from '@digitaldefiance/reed-solomon-erasure.wasm'
import { getRSInstance, DEFAULT_EC_K, DEFAULT_EC_M } from './rs-instance'
import type { EncodedShard } from './types'

export type EncodeResult = {
  k: number
  m: number
  chunkSize: number
  paddedSize: number
  shards: EncodedShard[]
}

export function encodeBuffer(
  dataBuffer: Uint8Array,
  k: number = DEFAULT_EC_K,
  m: number = DEFAULT_EC_M
): EncodeResult {
  const rs = getRSInstance()
  const rawSize = dataBuffer.byteLength

  let chunkSize = Math.ceil(rawSize / k)
  if (chunkSize % 2 !== 0) chunkSize += 1
  const paddedSize = chunkSize * k
  const totalSize = chunkSize * (k + m)
  const fullMemory = b4a.alloc(totalSize)
  b4a.copy(dataBuffer, fullMemory, 0)

  const result = rs.encode(fullMemory, k, m)
  if (result !== ReedSolomonErasure.RESULT_OK) {
    throw new Error(
      `Reed-Solomon encoding failed (${result}): ${ReedSolomonErasure.getResultMessage(result)}`
    )
  }

  const shards: EncodedShard[] = []
  for (let i = 0; i < k + m; i++) {
    const start = i * chunkSize
    shards.push({
      index: i,
      isParity: i >= k,
      buffer: fullMemory.slice(start, start + chunkSize)
    })
  }

  return { k, m, chunkSize, paddedSize, shards }
}
