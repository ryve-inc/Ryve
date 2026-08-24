import { decodeATMatrix } from './at-matrix'
import { DEFAULT_EC_K, DEFAULT_EC_M } from './allocator'

/**
 * Reconstructs original data buffer from available shards using AT-Matrix 3-level decoding.
 */
export function decodeBuffer(
  availableShardsMap: Map<number, Uint8Array>,
  k: number = DEFAULT_EC_K,
  m: number = DEFAULT_EC_M,
  chunkSize: number,
  originalSize: number
): Uint8Array {
  return decodeATMatrix(availableShardsMap, k, m, chunkSize, originalSize)
}
