import path from 'bare-path'
import fs from 'bare-fs'
import b4a from 'b4a'

import { decodeBuffer, encodeBuffer } from '../erasure-coding'
import { normalizePath } from './path-utils'
import { decryptBuffer, hashChunk } from './crypto-utils'

export async function downloadFile({
  drive,
  chunkStore,
  encryptionKey,
  networkKeyHex = null,
  publicCatalog = null,
  entryPath,
  destLocalPath
}: {
  drive: any
  chunkStore: any
  encryptionKey: Uint8Array | string
  networkKeyHex?: string | null
  publicCatalog?: any
  entryPath: string
  destLocalPath: string
}) {
  const p = normalizePath(entryPath)
  await drive.ready()
  let meta: any = null
  let isPublicFile = false

  const entry = await drive.entry(p)
  if (entry && entry.value?.metadata) {
    meta = entry.value.metadata
  } else if (publicCatalog && networkKeyHex) {
    meta = await publicCatalog.getPublicManifest(networkKeyHex, p)
    if (meta) isPublicFile = true
  }

  if (!meta || !meta.chunks || !Array.isArray(meta.chunks) || meta.chunks.length === 0) {
    throw new Error('File metadata or chunk manifest not found: ' + p)
  }

  const effectiveKey = (isPublicFile && networkKeyHex) || (meta.isPrivate === false && networkKeyHex)
    ? b4a.from(networkKeyHex.slice(0, 64), 'hex')
    : encryptionKey

  console.log(`[User:Download] Reassembling chunks for ${p} (Public: ${isPublicFile})...`)

  let encryptedBuffer: Uint8Array
  let missingShardsDetected = false
  const fetchedBuffers = new Map<string, Uint8Array>()

  if (meta.erasureCoding) {
    const { k, m } = meta.erasureCoding
    const totalShardsPerBlock = k + m
    const numBlocks = meta.erasureCoding.numBlocks || (meta.chunks ? Math.ceil(meta.chunks.length / totalShardsPerBlock) : 1)
    const maxBlockSize = meta.erasureCoding.blockSize || (1 * 1024 * 1024)
    const totalEncryptedSize = meta.encryptedSize || (meta.originalSize ? meta.originalSize + 16 : 0)

    console.log(`[User:Download] Reassembling ${meta.chunks.length} chunks across ${numBlocks} block(s) (K=${k}, M=${m}) for ${p}...`)

    // Group chunk metadata by blockIndex
    const blocksMap = new Map<number, any[]>()
    for (const chunkMeta of meta.chunks) {
      const bIdx = chunkMeta.blockIndex !== undefined ? chunkMeta.blockIndex : Math.floor(chunkMeta.index / totalShardsPerBlock)
      if (!blocksMap.has(bIdx)) blocksMap.set(bIdx, [])
      blocksMap.get(bIdx)!.push(chunkMeta)
    }

    // Launch parallel fetch requests for all chunks
    const fetchPromises = meta.chunks.map(async (chunkMeta: any) => {
      if (!chunkStore) return
      try {
        const chunkBuf = await chunkStore.fetchChunk(chunkMeta.hash, networkKeyHex, 60000)
        const actualHash = hashChunk(chunkBuf)
        if (actualHash === chunkMeta.hash) {
          fetchedBuffers.set(chunkMeta.hash, chunkBuf)
        } else {
          console.warn(`[User:Download] Hash mismatch for chunk ${chunkMeta.hash.slice(0, 12)}`)
        }
      } catch (err: any) {
        console.warn(`[User:Download] Chunk ${chunkMeta.hash.slice(0, 12)} fetch failed:`, err?.message || err)
      }
    })

    await Promise.allSettled(fetchPromises)

    const reconstructedBlockBuffers: Uint8Array[] = []

    for (let b = 0; b < numBlocks; b++) {
      const blockChunks = blocksMap.get(b) || []
      const availableShardsMap = new Map<number, Uint8Array>()

      for (const chunkMeta of blockChunks) {
        const buf = fetchedBuffers.get(chunkMeta.hash)
        if (buf) {
          const rawShardIdx = chunkMeta.shardIndex !== undefined ? chunkMeta.shardIndex : (chunkMeta.index % totalShardsPerBlock)
          const shardIdx = rawShardIdx % totalShardsPerBlock
          availableShardsMap.set(shardIdx, buf)
        }
      }

      if (availableShardsMap.size < k) {
        throw new Error(
          `File unavailable: Block ${b + 1}/${numBlocks} received ${availableShardsMap.size}/${k + m} shards. Need at least K=${k} active peers.`
        )
      }

      const blockStart = b * maxBlockSize
      const blockEnd = Math.min(blockStart + maxBlockSize, totalEncryptedSize)
      const currentBlockEncryptedSize = blockEnd - blockStart
      const blockChunkSize = Math.ceil(currentBlockEncryptedSize / k)

      const blockDecoded = decodeBuffer(availableShardsMap, k, m, blockChunkSize, currentBlockEncryptedSize)
      reconstructedBlockBuffers.push(blockDecoded)
    }

    encryptedBuffer = b4a.concat(reconstructedBlockBuffers)
  } else {
    // Legacy download path for backward compatibility
    const encryptedChunks: Uint8Array[] = []
    for (const chunkMeta of meta.chunks) {
      if (!chunkStore) {
        throw new Error('Global chunk store unavailable.')
      }
      try {
        const chunkBuf = await chunkStore.fetchChunk(chunkMeta.hash, networkKeyHex, 60000)
        const actualHash = hashChunk(chunkBuf)
        if (actualHash !== chunkMeta.hash) {
          throw new Error(`Integrity mismatch on chunk ${chunkMeta.hash.slice(0, 12)}`)
        }
        encryptedChunks.push(chunkBuf)
        fetchedBuffers.set(chunkMeta.hash, chunkBuf)
      } catch (err: any) {
        console.error(`[User:Download] Failed to fetch chunk ${chunkMeta.hash.slice(0, 12)}:`, err?.message || err)
        throw new Error(`File unavailable: Peer hosting chunk ${chunkMeta.hash.slice(0, 12)} is offline.`)
      }
    }
    encryptedBuffer = b4a.concat(encryptedChunks)
  }

  // Decrypt full buffer using master encryption key or network key and saved nonce
  const decryptedBuffer = decryptBuffer(encryptedBuffer, effectiveKey, meta.nonce)

  // Write uncorrupted, decrypted file to destination path
  let finalDest = destLocalPath
  const expectedExt = path.extname(meta.sourceName || p)
  if (expectedExt && !path.extname(finalDest)) {
    finalDest += expectedExt
  }

  await fs.promises.mkdir(path.dirname(finalDest), { recursive: true })
  await fs.promises.writeFile(finalDest, decryptedBuffer)

  const isPublic = isPublicFile || meta.isPrivate === false

  if (isPublic && chunkStore && meta.chunks) {
    // For Public Files: Do NOT purge chunks. Seed fetched chunks & offload to online network peers!
    console.log(`[User:Download:PublicSeeding] Public file downloaded. Seeding chunks to network peers...`)
    try {
      const k = meta.erasureCoding?.k || 2
      const m = meta.erasureCoding?.m || 2
      const seedChunkList = meta.chunks
        .map((c: any) => ({
          index: c.index,
          blockIndex: c.blockIndex,
          shardIndex: c.shardIndex,
          isParity: c.isParity,
          buffer: fetchedBuffers.get(c.hash) || null,
          hash: c.hash
        }))
        .filter((c: any) => c.buffer && c.buffer.byteLength > 0)

      if (seedChunkList.length > 0) {
        await chunkStore.offloadChunks(seedChunkList, k, m, networkKeyHex)
      }
    } catch (err: any) {
      console.warn(`[User:Download:PublicSeeding] Public seeding offload warning:`, err?.message || err)
    }
  } else if (chunkStore && meta.chunks) {
    // For Private Files: Purge temporary chunk cache from local disk to save space
    await chunkStore.purgeChunks(meta.chunks.map((c: any) => c.hash))
  }

  console.log(`[User:Download] ✓ SUCCESS: Reassembled and decrypted ${decryptedBuffer.byteLength} bytes for ${p}`)

  return { path: p, destLocalPath: finalDest, verified: true }
}
