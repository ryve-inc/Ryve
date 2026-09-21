import path from 'bare-path'
import fs from 'bare-fs'
import b4a from 'b4a'

import { decodeBuffer, encodeBuffer } from '../erasure-coding'
import { normalizePath } from './path-utils'
import { decryptBuffer, decryptBlock, deriveBlockNonce, hashChunk } from './crypto-utils'

async function fetchBlockShards(
  chunkStore: any,
  blockChunks: any[],
  k: number,
  networkKeyHex: string | null,
  fetchedBuffers: Map<string, Uint8Array>
): Promise<Map<number, Uint8Array>> {
  const availableShardsMap = new Map<number, Uint8Array>()

  for (const chunkMeta of blockChunks) {
    const cached = fetchedBuffers.get(chunkMeta.hash)
    if (cached) {
      const shardIdx = chunkMeta.shardIndex !== undefined ? chunkMeta.shardIndex : chunkMeta.index
      availableShardsMap.set(shardIdx, cached)
    }
  }

  if (availableShardsMap.size >= k) {
    return availableShardsMap
  }

  const pending = blockChunks.filter(
    (c: any) => !availableShardsMap.has(c.shardIndex !== undefined ? c.shardIndex : c.index)
  )

  // Fetch chunks in bounded batches (concurrency of 4)
  const CONCURRENCY = 4
  for (let i = 0; i < pending.length && availableShardsMap.size < k; i += CONCURRENCY) {
    const batch = pending.slice(i, i + CONCURRENCY)
    await Promise.all(
      batch.map(async (chunkMeta: any) => {
        if (availableShardsMap.size >= k) return
        if (!chunkStore) return
        try {
          const chunkBuf = await chunkStore.fetchChunk(chunkMeta.hash, networkKeyHex, 60000)
          const actualHash = hashChunk(chunkBuf)
          if (actualHash === chunkMeta.hash) {
            fetchedBuffers.set(chunkMeta.hash, chunkBuf)
            const shardIdx = chunkMeta.shardIndex !== undefined ? chunkMeta.shardIndex : chunkMeta.index
            availableShardsMap.set(shardIdx, chunkBuf)
          }
        } catch (err: any) {
          console.warn(`[User:Download] Chunk ${chunkMeta.hash.slice(0, 12)} fetch failed:`, err?.message || err)
        }
      })
    )
    await new Promise((resolve) => setImmediate(resolve))
  }

  return availableShardsMap
}

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

  // Prepare destination path
  let finalDest = destLocalPath
  const expectedExt = path.extname(meta.sourceName || p)
  if (expectedExt && !path.extname(finalDest)) {
    finalDest += expectedExt
  }
  await fs.promises.mkdir(path.dirname(finalDest), { recursive: true })

  const fetchedBuffers = new Map<string, Uint8Array>()
  let totalDecryptedBytes = 0

  if (meta.erasureCoding) {
    const { k, m } = meta.erasureCoding
    const totalShardsPerBlock = k + m
    const numBlocks = meta.erasureCoding.numBlocks || (meta.chunks ? Math.ceil(meta.chunks.length / totalShardsPerBlock) : 1)
    const maxBlockSize = meta.erasureCoding.blockSize || (2 * 1024 * 1024)
    const totalOriginalSize = meta.originalSize || (meta.byteLength || 0)
    const isBlockEncrypted = Boolean(meta.erasureCoding.blockEncrypted)

    console.log(
      `[User:Download] Reassembling ${meta.chunks.length} chunks across ${numBlocks} block(s) (K=${k}, M=${m}, BlockEncrypted=${isBlockEncrypted}) for ${p}...`
    )

    // Group chunk metadata by blockIndex
    const blocksMap = new Map<number, any[]>()
    for (const chunkMeta of meta.chunks) {
      const bIdx = chunkMeta.blockIndex !== undefined ? chunkMeta.blockIndex : Math.floor(chunkMeta.index / totalShardsPerBlock)
      if (!blocksMap.has(bIdx)) blocksMap.set(bIdx, [])
      blocksMap.get(bIdx)!.push(chunkMeta)
    }

    if (isBlockEncrypted) {
      // -----------------------------------------------------------------------
      // STREAMING RECONSTRUCTION: Decode, Decrypt, and Write Block-by-Block
      // -----------------------------------------------------------------------
      let outHandle: any = null
      let outFd: number | null = null

      try {
        if (typeof fs.promises.open === 'function') {
          outHandle = await fs.promises.open(finalDest, 'w')
        } else {
          outFd = (fs as any).openSync(finalDest, 'w')
        }

        let currentWriteOffset = 0

        for (let b = 0; b < numBlocks; b++) {
          const blockChunks = blocksMap.get(b) || []
          const availableShardsMap = await fetchBlockShards(chunkStore, blockChunks, k, networkKeyHex, fetchedBuffers)

          if (availableShardsMap.size < k) {
            throw new Error(
              `File unavailable: Block ${b + 1}/${numBlocks} received ${availableShardsMap.size}/${k + m} shards. Need at least K=${k} active peers.`
            )
          }

          const expectedOriginalBlockSize = Math.min(maxBlockSize, totalOriginalSize - b * maxBlockSize)
          const expectedEncryptedBlockSize = expectedOriginalBlockSize + 16 // 16-byte Poly1305 MAC tag
          const blockChunkSize = Math.ceil(expectedEncryptedBlockSize / k)

          const blockDecoded = decodeBuffer(availableShardsMap, k, m, blockChunkSize, expectedEncryptedBlockSize)
          const blockNonce = deriveBlockNonce(meta.nonce, b)
          const blockDecrypted = decryptBlock(blockDecoded, effectiveKey, blockNonce)

          if (outHandle) {
            await outHandle.write(blockDecrypted, 0, blockDecrypted.byteLength, currentWriteOffset)
          } else {
            ;(fs as any).writeSync(outFd!, blockDecrypted, 0, blockDecrypted.byteLength, currentWriteOffset)
          }

          currentWriteOffset += blockDecrypted.byteLength
          totalDecryptedBytes += blockDecrypted.byteLength

          if (numBlocks > 1) {
            await new Promise((resolve) => setImmediate(resolve))
          }
        }
      } finally {
        if (outHandle) await outHandle.close().catch(() => {})
        if (outFd !== null) try { (fs as any).closeSync(outFd) } catch {}
      }
    } else {
      // -----------------------------------------------------------------------
      // LEGACY RECONSTRUCTION: Full-Buffer Reassembly & Decryption
      // -----------------------------------------------------------------------
      const reconstructedBlockBuffers: Uint8Array[] = []
      const totalEncryptedSize = meta.encryptedSize || (meta.originalSize ? meta.originalSize + 16 : 0)

      for (let b = 0; b < numBlocks; b++) {
        const blockChunks = blocksMap.get(b) || []
        const availableShardsMap = await fetchBlockShards(chunkStore, blockChunks, k, networkKeyHex, fetchedBuffers)

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

      const encryptedBuffer = b4a.concat(reconstructedBlockBuffers)
      const decryptedBuffer = decryptBuffer(encryptedBuffer, effectiveKey, meta.nonce)
      await fs.promises.writeFile(finalDest, decryptedBuffer)
      totalDecryptedBytes = decryptedBuffer.byteLength
    }
  } else {
    // -------------------------------------------------------------------------
    // LEGACY FALLBACK (Non-EC files)
    // -------------------------------------------------------------------------
    const encryptedChunks: Uint8Array[] = []
    for (const chunkMeta of meta.chunks) {
      if (!chunkStore) throw new Error('Global chunk store unavailable.')
      const chunkBuf = await chunkStore.fetchChunk(chunkMeta.hash, networkKeyHex, 60000)
      const actualHash = hashChunk(chunkBuf)
      if (actualHash !== chunkMeta.hash) {
        throw new Error(`Integrity mismatch on chunk ${chunkMeta.hash.slice(0, 12)}`)
      }
      encryptedChunks.push(chunkBuf)
      fetchedBuffers.set(chunkMeta.hash, chunkBuf)
    }
    const encryptedBuffer = b4a.concat(encryptedChunks)
    const decryptedBuffer = decryptBuffer(encryptedBuffer, effectiveKey, meta.nonce)
    await fs.promises.writeFile(finalDest, decryptedBuffer)
    totalDecryptedBytes = decryptedBuffer.byteLength
  }

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

  console.log(`[User:Download] ✓ SUCCESS: Reassembled and decrypted ${totalDecryptedBytes} bytes for ${p}`)

  return { path: p, destLocalPath: finalDest, verified: true }
}

export async function readFileBuffer({
  drive,
  chunkStore,
  encryptionKey,
  networkKeyHex = null,
  publicCatalog = null,
  entryPath
}: {
  drive: any
  chunkStore: any
  encryptionKey: Uint8Array | string
  networkKeyHex?: string | null
  publicCatalog?: any
  entryPath: string
}): Promise<{ buffer: Uint8Array; mime: string | null; name: string; meta: any }> {
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

  console.log(`[User:Preview] Reassembling in-memory chunks for ${p} (Public: ${isPublicFile})...`)

  const fetchedBuffers = new Map<string, Uint8Array>()
  let resultBuffer: Uint8Array

  if (meta.erasureCoding) {
    const { k, m } = meta.erasureCoding
    const totalShardsPerBlock = k + m
    const numBlocks = meta.erasureCoding.numBlocks || (meta.chunks ? Math.ceil(meta.chunks.length / totalShardsPerBlock) : 1)
    const maxBlockSize = meta.erasureCoding.blockSize || (2 * 1024 * 1024)
    const totalOriginalSize = meta.originalSize || (meta.byteLength || 0)
    const isBlockEncrypted = Boolean(meta.erasureCoding.blockEncrypted)

    // Group chunk metadata by blockIndex
    const blocksMap = new Map<number, any[]>()
    for (const chunkMeta of meta.chunks) {
      const bIdx = chunkMeta.blockIndex !== undefined ? chunkMeta.blockIndex : Math.floor(chunkMeta.index / totalShardsPerBlock)
      if (!blocksMap.has(bIdx)) blocksMap.set(bIdx, [])
      blocksMap.get(bIdx)!.push(chunkMeta)
    }

    if (isBlockEncrypted) {
      const decryptedBlocks: Uint8Array[] = []

      for (let b = 0; b < numBlocks; b++) {
        const blockChunks = blocksMap.get(b) || []
        const availableShardsMap = await fetchBlockShards(chunkStore, blockChunks, k, networkKeyHex, fetchedBuffers)

        if (availableShardsMap.size < k) {
          throw new Error(
            `File unavailable: Block ${b + 1}/${numBlocks} received ${availableShardsMap.size}/${k + m} shards. Need at least K=${k} active peers.`
          )
        }

        const expectedOriginalBlockSize = Math.min(maxBlockSize, totalOriginalSize - b * maxBlockSize)
        const expectedEncryptedBlockSize = expectedOriginalBlockSize + 16
        const blockChunkSize = Math.ceil(expectedEncryptedBlockSize / k)

        const blockDecoded = decodeBuffer(availableShardsMap, k, m, blockChunkSize, expectedEncryptedBlockSize)
        const blockNonce = deriveBlockNonce(meta.nonce, b)
        const blockDecrypted = decryptBlock(blockDecoded, effectiveKey, blockNonce)

        decryptedBlocks.push(blockDecrypted)

        if (numBlocks > 1) {
          await new Promise((resolve) => setImmediate(resolve))
        }
      }

      resultBuffer = b4a.concat(decryptedBlocks)
    } else {
      const reconstructedBlockBuffers: Uint8Array[] = []
      const totalEncryptedSize = meta.encryptedSize || (meta.originalSize ? meta.originalSize + 16 : 0)

      for (let b = 0; b < numBlocks; b++) {
        const blockChunks = blocksMap.get(b) || []
        const availableShardsMap = await fetchBlockShards(chunkStore, blockChunks, k, networkKeyHex, fetchedBuffers)

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

      const encryptedBuffer = b4a.concat(reconstructedBlockBuffers)
      resultBuffer = decryptBuffer(encryptedBuffer, effectiveKey, meta.nonce)
    }
  } else {
    const encryptedChunks: Uint8Array[] = []
    for (const chunkMeta of meta.chunks) {
      if (!chunkStore) throw new Error('Global chunk store unavailable.')
      const chunkBuf = await chunkStore.fetchChunk(chunkMeta.hash, networkKeyHex, 60000)
      const actualHash = hashChunk(chunkBuf)
      if (actualHash !== chunkMeta.hash) {
        throw new Error(`Integrity mismatch on chunk ${chunkMeta.hash.slice(0, 12)}`)
      }
      encryptedChunks.push(chunkBuf)
      fetchedBuffers.set(chunkMeta.hash, chunkBuf)
    }
    const encryptedBuffer = b4a.concat(encryptedChunks)
    resultBuffer = decryptBuffer(encryptedBuffer, effectiveKey, meta.nonce)
  }

  const isPublic = isPublicFile || meta.isPrivate === false
  if (isPublic && chunkStore && meta.chunks) {
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
    } catch {}
  } else if (chunkStore && meta.chunks) {
    await chunkStore.purgeChunks(meta.chunks.map((c: any) => c.hash)).catch(() => {})
  }

  const fileName = meta.sourceName || meta.name || path.basename(p)
  return {
    buffer: resultBuffer,
    mime: meta.mime || null,
    name: fileName,
    meta
  }
}


