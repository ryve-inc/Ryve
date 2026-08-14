// @ts-nocheck
import path from 'bare-path'
import fs from 'bare-fs'
import b4a from 'b4a'

import { decodeBuffer } from '../erasure-coding'
import { normalizePath } from './path-utils'
import { decryptBuffer, hashChunk } from './crypto-utils'

export async function downloadFile({ drive, chunkStore, encryptionKey, entryPath, destLocalPath }: {
  drive: any
  chunkStore: any
  encryptionKey: any
  entryPath: string
  destLocalPath: string
}) {
  const p = normalizePath(entryPath)
  await drive.ready()
  const entry = await drive.entry(p)
  if (!entry || !entry.value) throw new Error('File not found: ' + p)

  const meta = entry.value.metadata
  if (!meta || !meta.chunks || !Array.isArray(meta.chunks) || meta.chunks.length === 0) {
    throw new Error('File metadata has no chunk manifest: ' + p)
  }

  console.log(`[User:Download] Reassembling chunks for ${p}...`)

  let encryptedBuffer: Uint8Array

  if (meta.erasureCoding) {
    // Erasure Coding download path: parallel query across online peers
    const { k, m, chunkSize } = meta.erasureCoding
    const totalShards = k + m
    const availableShardsMap = new Map<number, Uint8Array>()

    console.log(`[User:Download] Reassembling ${totalShards} shards (K=${k}, M=${m}) for ${p}...`)

    // Launch parallel fetch requests for all N chunks
    const fetchPromises = meta.chunks.map(async (chunkMeta: any) => {
      if (!chunkStore) return null
      try {
        const chunkBuf = await chunkStore.fetchChunk(chunkMeta.hash, 15000)
        const actualHash = hashChunk(chunkBuf)
        if (actualHash === chunkMeta.hash) {
          availableShardsMap.set(chunkMeta.index, chunkBuf)
        } else {
          console.warn(`[User:Download] Hash mismatch for shard index ${chunkMeta.index}`)
        }
      } catch (err: any) {
        console.warn(`[User:Download] Shard ${chunkMeta.index} (${chunkMeta.hash.slice(0, 12)}) fetch failed:`, err?.message || err)
      }
    })

    // Wait for fetch promises
    await Promise.allSettled(fetchPromises)

    console.log(
      `[User:Download] Shards retrieved: ${availableShardsMap.size}/${totalShards} (Indices: ${Array.from(availableShardsMap.keys()).sort((a, b) => a - b).join(', ')})`
    )

    if (availableShardsMap.size < k) {
      throw new Error(
        `File unavailable: Received ${availableShardsMap.size} chunks out of ${totalShards}. Need at least K=${k} active peers.`
      )
    }

    const encryptedSize = meta.encryptedSize || (meta.originalSize ? meta.originalSize + 16 : 0)
    encryptedBuffer = decodeBuffer(availableShardsMap, k, m, chunkSize, encryptedSize)
  } else {
    // Legacy download path for backward compatibility
    const encryptedChunks = []
    for (const chunkMeta of meta.chunks) {
      if (!chunkStore) {
        throw new Error('Global chunk store unavailable.')
      }
      try {
        const chunkBuf = await chunkStore.fetchChunk(chunkMeta.hash, 15000)
        const actualHash = hashChunk(chunkBuf)
        if (actualHash !== chunkMeta.hash) {
          throw new Error(`Integrity mismatch on chunk ${chunkMeta.hash.slice(0, 12)}`)
        }
        encryptedChunks.push(chunkBuf)
      } catch (err: any) {
        console.error(`[User:Download] Failed to fetch chunk ${chunkMeta.hash.slice(0, 12)}:`, err?.message || err)
        throw new Error(`File unavailable: Peer hosting chunk ${chunkMeta.hash.slice(0, 12)} is offline.`)
      }
    }
    encryptedBuffer = b4a.concat(encryptedChunks)
  }

  // Decrypt full buffer using master encryption key and saved nonce
  const decryptedBuffer = decryptBuffer(encryptedBuffer, encryptionKey, meta.nonce)

  // Write uncorrupted, decrypted file to destination path
  let finalDest = destLocalPath
  const expectedExt = path.extname(meta.sourceName || p)
  if (expectedExt && !path.extname(finalDest)) {
    finalDest += expectedExt
  }

  await fs.promises.mkdir(path.dirname(finalDest), { recursive: true })
  await fs.promises.writeFile(finalDest, decryptedBuffer)

  // Purge temporary chunk cache from local disk to free space
  if (chunkStore && meta.chunks) {
    await chunkStore.purgeChunks(meta.chunks.map((c: any) => c.hash))
  }

  console.log(`[User:Download] ✓ SUCCESS: Reassembled and decrypted ${decryptedBuffer.byteLength} bytes for ${p}`)

  return { path: p, destLocalPath: finalDest, verified: true }
}
