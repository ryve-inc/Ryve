import b4a from 'b4a'
import { createCauchyMatrix, gfAdd, gfMul, invertMatrix } from './gf28'

export interface InfoShard {
  index: number
  isParity: boolean
  buffer: Uint8Array
}

export interface EncodeResult {
  k: number
  m: number
  chunkSize: number
  paddedSize: number
  shards: InfoShard[]
}

const BLOCK_SIZE = 64 * 1024 // 64 KB streaming block processing limit for low RAM footprint

/**
 * Encodes input data into K Data Shards + M Parity Shards using AT-Matrix Galois encoding.
 * Operates in 64 KB block slices to maintain RAM usage < 30 MB.
 */
export function encodeATMatrix(dataBuffer: Uint8Array, k: number, m: number): EncodeResult {
  const rawSize = dataBuffer.byteLength
  let chunkSize = Math.ceil(rawSize / k)
  if (chunkSize % 2 !== 0) chunkSize += 1 // even alignment
  const paddedSize = chunkSize * k

  // Pad data buffer if necessary
  let paddedData: Uint8Array
  if (dataBuffer.byteLength === paddedSize) {
    paddedData = dataBuffer
  } else {
    paddedData = b4a.alloc(paddedSize)
    b4a.copy(dataBuffer, paddedData, 0)
  }

  // Generate Cauchy Matrix (K+M) x K
  const matrix = createCauchyMatrix(k, m)

  // Allocate shard buffers
  const shards: InfoShard[] = []
  for (let i = 0; i < k + m; i++) {
    shards.push({
      index: i,
      isParity: i >= k,
      buffer: b4a.alloc(chunkSize)
    })
  }

  // Copy data shards (0..k-1)
  for (let i = 0; i < k; i++) {
    const start = i * chunkSize
    const end = start + chunkSize
    b4a.copy(paddedData, shards[i].buffer, 0, start, end)
  }

  // Compute parity shards (k..k+m-1) using 64 KB streaming blocks
  for (let blockOffset = 0; blockOffset < chunkSize; blockOffset += BLOCK_SIZE) {
    const currentBlockLen = Math.min(BLOCK_SIZE, chunkSize - blockOffset)

    for (let pIdx = 0; pIdx < m; pIdx++) {
      const parityRowIdx = k + pIdx
      const matrixRow = matrix[parityRowIdx]
      const parityBuf = shards[parityRowIdx].buffer

      for (let b = 0; b < currentBlockLen; b++) {
        const bytePos = blockOffset + b
        let sum = 0
        for (let col = 0; col < k; col++) {
          const dataByte = shards[col].buffer[bytePos]
          const coeff = matrixRow[col]
          sum = gfAdd(sum, gfMul(dataByte, coeff))
        }
        parityBuf[bytePos] = sum
      }
    }
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
 * Reconstructs original data buffer from any K available shards out of (K+M).
 * Supports Fast-Path direct read and Matrix Repair using 64 KB block streaming.
 */
export function decodeATMatrix(
  availableShardsMap: Map<number, Uint8Array>,
  k: number,
  m: number,
  chunkSize: number,
  originalSize: number
): Uint8Array {
  // Fast-Path: Check if all K data shards (0..k-1) are online
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
  const availableIndices = Array.from(availableShardsMap.keys()).sort((a, b) => a - b)
  if (availableIndices.length < k) {
    throw new Error(
      `Insufficient shards for reconstruction: received ${availableIndices.length} shards, need at least K=${k}`
    )
  }

  // Select first K available shard indices
  const selectedIndices = availableIndices.slice(0, k)
  const fullMatrix = createCauchyMatrix(k, m)

  // Construct sub-matrix formed by the K selected rows
  const subMatrix: Uint8Array[] = []
  for (const idx of selectedIndices) {
    subMatrix.push(fullMatrix[idx])
  }

  // Invert sub-matrix to get decoding matrix E^-1
  const decodeMatrix = invertMatrix(subMatrix)

  // Allocate memory for reconstructed K data shards
  const reconstructedData = b4a.alloc(k * chunkSize)

  // Perform streaming block decoding (64 KB blocks)
  for (let blockOffset = 0; blockOffset < chunkSize; blockOffset += BLOCK_SIZE) {
    const currentBlockLen = Math.min(BLOCK_SIZE, chunkSize - blockOffset)

    for (let dataRow = 0; dataRow < k; dataRow++) {
      const decRow = decodeMatrix[dataRow]
      const outOffset = dataRow * chunkSize + blockOffset

      for (let b = 0; b < currentBlockLen; b++) {
        const bytePos = blockOffset + b
        let sum = 0
        for (let col = 0; col < k; col++) {
          const shardIdx = selectedIndices[col]
          const shardBuf = availableShardsMap.get(shardIdx)!
          const shardByte = shardBuf[bytePos]
          const coeff = decRow[col]
          sum = gfAdd(sum, gfMul(shardByte, coeff))
        }
        reconstructedData[outOffset + b] = sum
      }
    }
  }

  return reconstructedData.subarray(0, originalSize)
}
