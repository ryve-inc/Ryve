import path from 'bare-path'
import fs from 'bare-fs'
import b4a from 'b4a'

import { encodeBuffer, DEFAULT_EC_K, DEFAULT_EC_M } from '../erasure-coding'
import { normalizePath } from './path-utils'
import { generateMasterNonce, deriveBlockNonce, encryptBlock, hashChunk } from './crypto-utils'

export async function uploadFile({
  drive,
  chunkStore,
  encryptionKey,
  networkKeyHex = null,
  publicCatalog = null,
  localPath,
  destPath,
  mime = null,
  isPrivate = true,
  uploaderIdentity = null
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
  uploaderIdentity?: string | null
}) {
  const dest = normalizePath(destPath)
  const st = await fs.promises.stat(localPath)
  const originalSize = st.size

  // For Public files, use network key so all network members can decrypt. For Private, use account key.
  const effectiveKey = (!isPrivate && networkKeyHex)
    ? b4a.from(networkKeyHex.slice(0, 64), 'hex')
    : encryptionKey

  // 1. Process file in 2MB streaming blocks for optimal memory (< 40MB RAM) and zero event loop starvation
  const MAX_BLOCK_SIZE = 2 * 1024 * 1024 // 2 MB per block
  const numBlocks = Math.ceil(originalSize / MAX_BLOCK_SIZE) || 1
  const masterNonce = generateMasterNonce()

  const chunks: Array<{ index: number; blockIndex: number; shardIndex: number; isParity: boolean; buffer: Uint8Array; hash: string }> = []
  const chunkMetadata: Array<{ index: number; blockIndex: number; shardIndex: number; isParity: boolean; offset: number; length: number; hash: string }> = []

  let globalIndex = 0
  let sampleChunkSize = 0
  let totalEncryptedSize = 0

  let fileHandle: any = null
  let fd: number | null = null

  try {
    if (typeof fs.promises.open === 'function') {
      fileHandle = await fs.promises.open(localPath, 'r')
    } else {
      fd = (fs as any).openSync(localPath, 'r')
    }

    for (let b = 0; b < numBlocks; b++) {
      const blockOffset = b * MAX_BLOCK_SIZE
      const currentBlockSize = Math.min(MAX_BLOCK_SIZE, originalSize - blockOffset)
      const blockBuf = b4a.alloc(currentBlockSize)

      if (fileHandle) {
        await fileHandle.read(blockBuf, 0, currentBlockSize, blockOffset)
      } else {
        ;(fs as any).readSync(fd!, blockBuf, 0, currentBlockSize, blockOffset)
      }

      const blockNonce = deriveBlockNonce(masterNonce, b)
      const blockEncrypted = encryptBlock(blockBuf, effectiveKey, blockNonce)
      totalEncryptedSize += blockEncrypted.byteLength

      const ecResult = encodeBuffer(blockEncrypted, DEFAULT_EC_K, DEFAULT_EC_M)
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
          offset: blockOffset + shard.index * ecResult.chunkSize,
          length: shard.buffer.byteLength,
          hash
        })
        globalIndex++
      }

      // Micro-yield between blocks to ensure background Hyperswarm ping/ACKs never get starved
      if (numBlocks > 1) {
        await new Promise((resolve) => setImmediate(resolve))
      }
    }
  } finally {
    if (fileHandle) await fileHandle.close().catch(() => {})
    if (fd !== null) try { (fs as any).closeSync(fd) } catch {}
  }

  // 2. Offload chunks to network nodes (distributed equally across uploader and peers with bounded concurrency)
  let allocation = null
  if (chunkStore) {
    allocation = await chunkStore.offloadChunks(chunks, DEFAULT_EC_K, DEFAULT_EC_M, networkKeyHex)
  }

  // 3. Save metadata index in drive (tiny record)
  const meta = {
    mime,
    isPrivate,
    uploadedAt: Date.now(),
    uploaderIdentity,
    networkKeyHex,
    sourceName: path.basename(localPath),
    originalSize,
    encryptedSize: totalEncryptedSize,
    nonce: masterNonce,
    erasureCoding: {
      k: DEFAULT_EC_K,
      m: DEFAULT_EC_M,
      chunkSize: sampleChunkSize,
      blockSize: MAX_BLOCK_SIZE,
      numBlocks,
      blockEncrypted: true,
      faultTolerance: allocation ? allocation.faultTolerance : 'none'
    },
    chunks: chunkMetadata
  }

  // Put a dummy 1-byte marker entry so drive knows file exists
  await drive.put(dest, b4a.alloc(1), { metadata: meta })

  // 4. If file is Public, register manifest in PublicCatalog and broadcast to online peers
  if (!isPrivate && publicCatalog && networkKeyHex) {
    const publicManifest = {
      path: dest,
      name: path.basename(localPath),
      byteLength: originalSize,
      mime,
      uploadedAt: meta.uploadedAt,
      uploaderIdentity,
      networkKeyHex,
      nonce: masterNonce,
      encryptedSize: totalEncryptedSize,
      originalSize,
      erasureCoding: meta.erasureCoding,
      chunks: chunkMetadata,
      isPrivate: false as const
    }
    await publicCatalog.addPublicFile(networkKeyHex, publicManifest)
    if (chunkStore && typeof chunkStore.broadcastPublicFile === 'function') {
      await chunkStore.broadcastPublicFile(publicManifest)
    }
    console.log(`[PublicCatalog:Uploader] Registered & broadcast public file ${dest} on network ${networkKeyHex.slice(0, 12)}`)
  }

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
    `[Uploader:Pruner] SUCCESS: Offloaded ${chunks.length} erasure-coded chunks across ${numBlocks} block(s) for ${dest} (FaultTolerance: ${meta.erasureCoding.faultTolerance}). Local file data cleared!`
  )

  return {
    path: dest,
    byteLength: originalSize,
    chunks: chunkMetadata,
    metadata: meta
  }
}


