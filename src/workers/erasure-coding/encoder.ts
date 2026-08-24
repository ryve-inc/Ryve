import { encodeATMatrix, EncodeResult } from './at-matrix'
import { DEFAULT_EC_K, DEFAULT_EC_M } from './allocator'

/**
 * Encodes a buffer into K data shards + M parity shards using pure TypeScript AT-Matrix coding.
 */
export function encodeBuffer(
  dataBuffer: Uint8Array,
  k: number = DEFAULT_EC_K,
  m: number = DEFAULT_EC_M
): EncodeResult {
  return encodeATMatrix(dataBuffer, k, m)
}
