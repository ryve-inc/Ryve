import { encodeBuffer, decodeBuffer, DEFAULT_EC_K, DEFAULT_EC_M } from '../src/workers/erasure-coding.js'

function runBenchmark(sizeMb: number) {
  const sizeBytes = sizeMb * 1024 * 1024
  const randomBuffer = new Uint8Array(sizeBytes)
  for (let i = 0; i < sizeBytes; i++) {
    randomBuffer[i] = (i * 31 + 17) & 0xff
  }

  // Measure Encode
  const startEncode = performance.now()
  const encoded = encodeBuffer(randomBuffer, DEFAULT_EC_K, DEFAULT_EC_M)
  const encodeTimeMs = performance.now() - startEncode

  // Prepare shards map and simulate dropping M parity/data shards
  const shardsMap = new Map<number, Uint8Array>()
  // Simulate dropping data shard 0 and data shard 1 (2 missing shards)
  for (const shard of encoded.shards) {
    if (shard.index !== 0 && shard.index !== 1) {
      shardsMap.set(shard.index, shard.buffer)
    }
  }

  // Measure Decode
  const startDecode = performance.now()
  const reconstructed = decodeBuffer(
    shardsMap,
    DEFAULT_EC_K,
    DEFAULT_EC_M,
    encoded.chunkSize,
    sizeBytes
  )
  const decodeTimeMs = performance.now() - startDecode

  // Verify byte equality
  let valid = true
  if (reconstructed.byteLength !== randomBuffer.byteLength) {
    valid = false
  } else {
    for (let i = 0; i < randomBuffer.byteLength; i += 4096) {
      if (reconstructed[i] !== randomBuffer[i]) {
        valid = false
        break
      }
    }
  }

  console.log(`[Benchmark] ${sizeMb} MB File (${encoded.shards.length} shards @ ${encoded.chunkSize} bytes):`)
  console.log(`  - Encode Time: ${encodeTimeMs.toFixed(2)} ms`)
  console.log(`  - Decode Time (with 2 missing shards): ${decodeTimeMs.toFixed(2)} ms`)
  console.log(`  - Byte Verification: ${valid ? 'PASS' : 'FAIL'}\n`)

  return {
    sizeMb,
    chunkSize: encoded.chunkSize,
    encodeTimeMs: encodeTimeMs.toFixed(2),
    decodeTimeMs: decodeTimeMs.toFixed(2),
    valid
  }
}

console.log('=== Starting Erasure Coding Performance Benchmarks ===\n')
runBenchmark(1)
runBenchmark(5)
runBenchmark(20)
console.log('=== Benchmark Complete ===')
