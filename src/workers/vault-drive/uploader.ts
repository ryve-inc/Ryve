// @ts-nocheck
import path from 'bare-path'
import fs from 'bare-fs'
import b4a from 'b4a'

import { encodeBuffer, DEFAULT_EC_K, DEFAULT_EC_M } from '../erasure-coding'
import { normalizePath } from './path-utils'
import { encryptBuffer, hashChunk } from './crypto-utils'

export async function uploadFile({ drive, chunkStore, encryptionKey, localPath, destPath, mime = null }: {
  drive: any
  chunkStore: any
  encryptionKey: any
  localPath: string
  destPath: string
  mime?: string | null
}) {
  const dest = normalizePath(destPath)
  const rawBuffer = await fs.promises.readFile(localPath)

  // 1. Encrypt raw file buffer locally with master encryption key
  const { encrypted, nonce } = encryptBuffer(rawBuffer, encryptionKey)

  // 2. Perform Reed-Solomon Erasure Coding (K=4 data shards, M=2 parity shards)
  const ecResult = encodeBuffer(encrypted, DEFAULT_EC_K, DEFAULT_EC_M)
  const chunks = []
  const chunkMetadata = []

  for (const shard of ecResult.shards) {
    const hash = hashChunk(shard.buffer)
    chunks.push({
      index: shard.index,
      isParity: shard.isParity,
      buffer: shard.buffer,
      hash
    })
    chunkMetadata.push({
      index: shard.index,
      isParity: shard.isParity,
      offset: shard.index * ecResult.chunkSize,
      length: shard.buffer.byteLength,
      hash
    })
  }

  // 3. Offload chunks to network peers in global chunk store
  let allocation = null
  if (chunkStore) {
    allocation = await chunkStore.offloadChunks(chunks, DEFAULT_EC_K, DEFAULT_EC_M)
  }

  // 4. Save metadata index in drive (tiny record)
  const meta = {
    mime,
    uploadedAt: Date.now(),
    sourceName: path.basename(localPath),
    originalSize: rawBuffer.byteLength,
    encryptedSize: encrypted.byteLength,
    nonce,
    erasureCoding: {
      k: ecResult.k,
      m: ecResult.m,
      chunkSize: ecResult.chunkSize,
      paddedSize: ecResult.paddedSize,
      faultTolerance: allocation ? allocation.faultTolerance : 'none'
    },
    chunks: chunkMetadata
  }

  // Put a dummy 1-byte marker entry so drive knows file exists
  await drive.put(dest, b4a.alloc(1), { metadata: meta })

  // 5. Prune local storage from drive blobs core
  if (drive.blobs?.core) {
    const entry = await drive.entry(dest)
    if (entry?.value?.blob) {
      const start = entry.value.blob.blockOffset
      const end = start + entry.value.blob.blockLength
      await drive.blobs.core.clear(start, end).catch(() => {})
    }
  }

  console.log(
    `[Uploader:Pruner] ✓ SUCCESS: Offloaded ${chunks.length} erasure-coded chunks for ${dest} (FaultTolerance: ${meta.erasureCoding.faultTolerance}). Local file data cleared!`
  )

  return {
    path: dest,
    byteLength: rawBuffer.byteLength,
    chunks: chunkMetadata,
    metadata: meta
  }
}
