import path from 'bare-path'
import * as fs from 'bare-fs'
import * as b4a from 'b4a'
import { encodeBuffer, DEFAULT_EC_K, DEFAULT_EC_M } from '../erasure-coding'
import { normalizePath } from './path-utils'
import { asBytes } from '../as-bytes'
import { encryptBuffer, hashChunk } from './crypto-utils'
import type { ChunkMeta, FileMetadata, UploadDeps } from './types'

function asBlob(value: unknown): { blockOffset: number; blockLength: number } | null {
  if (!value || typeof value !== 'object') return null
  const blob = value as { blockOffset?: unknown; blockLength?: unknown }
  if (typeof blob.blockOffset !== 'number' || typeof blob.blockLength !== 'number') return null
  return { blockOffset: blob.blockOffset, blockLength: blob.blockLength }
}

function collectHashes(metadata: unknown): string[] {
  if (!metadata || typeof metadata !== 'object') return []
  const chunks = (metadata as { chunks?: unknown }).chunks
  if (!Array.isArray(chunks)) return []
  return chunks
    .map((chunk) =>
      chunk && typeof chunk === 'object' ? (chunk as { hash?: unknown }).hash : null
    )
    .filter((hash): hash is string => typeof hash === 'string' && Boolean(hash))
}

export async function uploadFile({
  drive,
  chunkStore,
  encryptionKey,
  localPath,
  destPath,
  mime = null
}: UploadDeps) {
  if (!chunkStore) throw new Error('Global chunk store unavailable.')

  const dest = normalizePath(destPath)
  const rawBuffer = asBytes(await fs.promises.readFile(localPath))

  const existing = await drive.entry(dest)
  const oldHashes = collectHashes(existing?.value?.metadata)
  const oldBlob = asBlob(existing?.value?.blob)

  const { encrypted, nonce } = encryptBuffer(rawBuffer, encryptionKey)
  const ecResult = encodeBuffer(encrypted, DEFAULT_EC_K, DEFAULT_EC_M)
  const chunks = []
  const chunkMetadata: ChunkMeta[] = []

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

  const newHashes = chunkMetadata.map((c) => c.hash)
  try {
    const allocation = await chunkStore.offloadChunks(chunks, DEFAULT_EC_K, DEFAULT_EC_M)
    await chunkStore.verifyLocalChunks(newHashes)

    const meta: FileMetadata = {
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
        faultTolerance: allocation.faultTolerance
      },
      chunks: chunkMetadata
    }

    await drive.put(dest, b4a.alloc(1), { metadata: meta })

    const newHashSet = new Set(newHashes)
    const staleHashes = oldHashes.filter((hash) => !newHashSet.has(hash))
    if (staleHashes.length) await chunkStore.purgeChunks(staleHashes)

    if (oldBlob && drive.blobs?.core) {
      const start = oldBlob.blockOffset
      const end = start + oldBlob.blockLength
      await drive.blobs.core.clear(start, end).catch(() => {})
    }

    console.log(
      `[Uploader:Pruner] Offloaded ${chunks.length} erasure-coded chunks for ${dest} (FaultTolerance: ${meta.erasureCoding.faultTolerance}).`
    )

    return {
      path: dest,
      byteLength: rawBuffer.byteLength,
      chunks: chunkMetadata,
      metadata: meta
    }
  } catch (err) {
    const oldSet = new Set(oldHashes)
    const orphaned = newHashes.filter((hash) => !oldSet.has(hash))
    if (orphaned.length) await chunkStore.purgeChunks(orphaned).catch(() => {})
    throw err
  }
}
