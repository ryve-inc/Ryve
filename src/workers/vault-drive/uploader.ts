import path from 'bare-path'
import fs from 'bare-fs'
import b4a from 'b4a'

import { encodeBuffer, DEFAULT_EC_K, DEFAULT_EC_M } from '../erasure-coding'
import { normalizePath } from './path-utils'
import { encryptBuffer, hashChunk } from './crypto-utils'

export async function uploadFile({
  drive,
  chunkStore,
  encryptionKey,
  networkKeyHex = null,
  publicCatalog = null,
  localPath,
  destPath,
  mime = null,
  isPrivate = true
}: {
  drive: any
  chunkStore: any
  encryptionKey: Uint8Array | string
  networkKeyHex?: string | null
  publicCatalog?: any
  localPath: string
  destPath: string
  mime?: string | null
  isPrivate?: boolean
}) {
  const dest = normalizePath(destPath)
  const rawBuffer: any = await fs.promises.readFile(localPath)

  // For Public files, use network key so all network members can decrypt. For Private, use account key.
  const effectiveKey = (!isPrivate && networkKeyHex)
    ? b4a.from(networkKeyHex.slice(0, 64), 'hex')
    : encryptionKey

  // 1. Encrypt raw file buffer locally with effective key
  const { encrypted, nonce } = encryptBuffer(rawBuffer, effectiveKey)

  // 2. Slice encrypted buffer into 1MB blocks and perform Reed-Solomon Erasure Coding per block
  const MAX_BLOCK_SIZE = 1 * 1024 * 1024 // 1 MB per block
  const totalEncrypted = encrypted.byteLength
  const numBlocks = Math.ceil(totalEncrypted / MAX_BLOCK_SIZE) || 1
  const chunks: Array<{ index: number; blockIndex: number; shardIndex: number; isParity: boolean; buffer: Uint8Array; hash: string }> = []
  const chunkMetadata: Array<{ index: number; blockIndex: number; shardIndex: number; isParity: boolean; offset: number; length: number; hash: string }> = []

  let globalIndex = 0
  let sampleChunkSize = 0

  for (let b = 0; b < numBlocks; b++) {
    const start = b * MAX_BLOCK_SIZE
    const end = Math.min(start + MAX_BLOCK_SIZE, totalEncrypted)
    const blockBuf = encrypted.subarray(start, end)
    const ecResult = encodeBuffer(blockBuf, DEFAULT_EC_K, DEFAULT_EC_M)
    sampleChunkSize = ecResult.chunkSize

    for (const shard of ecResult.shards) {
      const hash = hashChunk(shard.buffer)
      chunks.push({
        index: globalIndex,
        blockIndex: b,
        shardIndex: shard.index,
        isParity: shard.isParity,
        buffer: shard.buffer,
        hash
      })
      chunkMetadata.push({
        index: globalIndex,
        blockIndex: b,
        shardIndex: shard.index,
        isParity: shard.isParity,
        offset: start + shard.index * ecResult.chunkSize,
        length: shard.buffer.byteLength,
        hash
      })
      globalIndex++
    }
  }

  // 3. Offload chunks to network nodes (distributed equally across uploader and peers)
  let allocation = null
  if (chunkStore) {
    allocation = await chunkStore.offloadChunks(chunks, DEFAULT_EC_K, DEFAULT_EC_M, networkKeyHex)
  }

  // 4. Save metadata index in drive (tiny record)
  const meta = {
    mime,
    isPrivate,
    uploadedAt: Date.now(),
    networkKeyHex,
    sourceName: path.basename(localPath),
    originalSize: rawBuffer.byteLength,
    encryptedSize: encrypted.byteLength,
    nonce,
    erasureCoding: {
      k: DEFAULT_EC_K,
      m: DEFAULT_EC_M,
      chunkSize: sampleChunkSize,
      blockSize: MAX_BLOCK_SIZE,
      numBlocks,
      faultTolerance: allocation ? allocation.faultTolerance : 'none'
    },
    chunks: chunkMetadata
  }

  // Put a dummy 1-byte marker entry so drive knows file exists
  await drive.put(dest, b4a.alloc(1), { metadata: meta })

  // 5. If file is Public, register manifest in PublicCatalog and broadcast to online peers
  if (!isPrivate && publicCatalog && networkKeyHex) {
    const publicManifest = {
      path: dest,
      name: path.basename(localPath),
      byteLength: rawBuffer.byteLength,
      mime,
      uploadedAt: meta.uploadedAt,
      uploaderIdentity: null,
      networkKeyHex,
      nonce,
      encryptedSize: encrypted.byteLength,
      originalSize: rawBuffer.byteLength,
      erasureCoding: meta.erasureCoding,
      chunks: chunkMetadata,
      isPrivate: false as const
    }
    await publicCatalog.addPublicFile(networkKeyHex, publicManifest)
    if (chunkStore && typeof chunkStore.broadcastPublicFile === 'function') {
      await chunkStore.broadcastPublicFile(publicManifest)
    }
    console.log(`[PublicCatalog:Uploader] ✓ Registered & broadcast public file ${dest} on network ${networkKeyHex.slice(0, 12)}`)
  }

  // 6. Prune local storage from drive blobs core
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

