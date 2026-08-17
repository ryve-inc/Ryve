import path from 'bare-path'
import * as fs from 'bare-fs'
import * as b4a from 'b4a'
import type { FilePreviewResult } from '../../shared/types.ts'
import { decodeBuffer } from '../erasure-coding'
import { normalizePath } from './path-utils'
import { decryptBuffer, hashChunk } from './crypto-utils'
import { randomTempSuffix } from '../global-chunk-store/util'
import type { DownloadDeps, FileMetadata, HyperdriveLike } from './types'
import type { GlobalChunkStore } from '../global-chunk-store'

export const MAX_PREVIEW_BYTES = 8 * 1024 * 1024

type ChunkRecord = {
  index: number
  hash: string
  isParity?: boolean
}

type AssembledFile = {
  decrypted: Uint8Array
  verified: boolean
  mime: string | null
  sourceName: string
}

function requireFileMetadata(meta: unknown, entryPath: string): FileMetadata {
  if (!meta || typeof meta !== 'object') {
    throw new Error('File metadata has no chunk manifest: ' + entryPath)
  }
  const value = meta as Partial<FileMetadata>
  if (!Array.isArray(value.chunks) || value.chunks.length === 0) {
    throw new Error('File metadata has no chunk manifest: ' + entryPath)
  }
  if (!value.nonce || typeof value.nonce !== 'string') {
    throw new Error('File metadata is missing nonce: ' + entryPath)
  }
  if (!Number.isInteger(value.encryptedSize) || (value.encryptedSize as number) <= 0) {
    throw new Error('File metadata is missing encryptedSize: ' + entryPath)
  }
  return value as FileMetadata
}

function requireErasureCoding(meta: FileMetadata, entryPath: string) {
  const ec = meta.erasureCoding
  if (!ec) return null
  if (!Number.isInteger(ec.k) || !Number.isInteger(ec.m) || ec.k <= 0 || ec.m < 0) {
    throw new Error('Invalid erasure-coding parameters: ' + entryPath)
  }
  if (!Number.isInteger(ec.chunkSize) || ec.chunkSize <= 0) {
    throw new Error('Invalid erasure-coding chunk size: ' + entryPath)
  }
  if (meta.chunks.length !== ec.k + ec.m) {
    throw new Error(
      `Erasure-coding shard count mismatch: expected ${ec.k + ec.m}, got ${meta.chunks.length}`
    )
  }
  return ec
}

async function fetchVerifiedShard(
  chunkStore: GlobalChunkStore,
  chunkMeta: ChunkRecord,
  available: Map<number, Uint8Array>
): Promise<boolean> {
  const chunkBuf = await chunkStore.fetchChunk(chunkMeta.hash, 15000)
  if (hashChunk(chunkBuf) !== String(chunkMeta.hash).toLowerCase()) {
    console.warn(`[User:Download] Hash mismatch for shard index ${chunkMeta.index}`)
    return false
  }
  available.set(chunkMeta.index, chunkBuf)
  return true
}

async function assembleEncrypted(
  chunkStore: GlobalChunkStore,
  meta: FileMetadata,
  entryPath: string
): Promise<{ encrypted: Uint8Array; verified: boolean }> {
  const ec = requireErasureCoding(meta, entryPath)
  let verified = true

  if (ec) {
    const { k, m, chunkSize } = ec
    const available = new Map<number, Uint8Array>()
    const seen = new Set<number>()
    const records: ChunkRecord[] = meta.chunks.map((chunk, i) => {
      const idx = Number(chunk.index ?? i)
      if (!Number.isInteger(idx) || idx < 0) {
        throw new Error(`Invalid shard index in metadata at position ${i}`)
      }
      if (seen.has(idx)) throw new Error(`Duplicate shard index ${idx} in metadata`)
      seen.add(idx)
      return { index: idx, hash: chunk.hash, isParity: chunk.isParity || idx >= k }
    })

    const dataShards = records.filter((chunk) => !chunk.isParity && chunk.index < k)
    const parityShards = records.filter((chunk) => chunk.isParity || chunk.index >= k)

    await Promise.all(
      dataShards.map(async (chunk) => {
        try {
          const ok = await fetchVerifiedShard(chunkStore, chunk, available)
          if (!ok) verified = false
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          console.warn(
            `[User:Download] Shard ${chunk.index} (${chunk.hash.slice(0, 12)}) fetch failed:`,
            message
          )
        }
      })
    )

    if (available.size < k) {
      await Promise.all(
        parityShards.map(async (chunk) => {
          try {
            const ok = await fetchVerifiedShard(chunkStore, chunk, available)
            if (!ok) verified = false
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            console.warn(
              `[User:Download] Shard ${chunk.index} (${chunk.hash.slice(0, 12)}) fetch failed:`,
              message
            )
          }
        })
      )
    }

    if (available.size < k) {
      throw new Error(
        `File unavailable: Received ${available.size} chunks out of ${k + m}. Need at least K=${k} shards.`
      )
    }

    return {
      encrypted: decodeBuffer(available, k, m, chunkSize, meta.encryptedSize),
      verified
    }
  }

  const ordered = meta.chunks
    .map((chunkMeta, i) => ({ chunkMeta, idx: Number(chunkMeta.index ?? i) }))
    .sort((a, b) => a.idx - b.idx)

  const encryptedChunks = await Promise.all(
    ordered.map(async ({ chunkMeta }) => {
      const chunkBuf = await chunkStore.fetchChunk(chunkMeta.hash, 15000)
      if (hashChunk(chunkBuf) !== String(chunkMeta.hash || '').toLowerCase()) {
        throw new Error(`Integrity mismatch on chunk ${String(chunkMeta.hash || '').slice(0, 12)}`)
      }
      return chunkBuf
    })
  )

  return { encrypted: b4a.concat(encryptedChunks), verified: true }
}

async function assembleFile(
  drive: HyperdriveLike,
  chunkStore: GlobalChunkStore,
  encryptionKey: Uint8Array,
  entryPath: string
): Promise<AssembledFile> {
  const p = normalizePath(entryPath)
  await drive.ready()
  const entry = await drive.entry(p)
  if (!entry?.value) throw new Error('File not found: ' + p)
  const meta = requireFileMetadata(entry.value.metadata, p)
  const { encrypted, verified } = await assembleEncrypted(chunkStore, meta, p)
  return {
    decrypted: decryptBuffer(encrypted, encryptionKey, meta.nonce),
    verified,
    mime: meta.mime || null,
    sourceName: meta.sourceName || p
  }
}

export async function downloadFile({
  drive,
  chunkStore,
  encryptionKey,
  entryPath,
  destLocalPath
}: DownloadDeps) {
  if (!chunkStore) throw new Error('Global chunk store unavailable.')
  if (!destLocalPath || !String(destLocalPath).trim()) {
    throw new Error('Download destination path is required')
  }

  const assembled = await assembleFile(drive, chunkStore, encryptionKey, entryPath)
  const p = normalizePath(entryPath)

  let finalDest = path.resolve(String(destLocalPath))
  const expectedExt = path.extname(assembled.sourceName || p)
  if (expectedExt && !path.extname(finalDest)) finalDest += expectedExt

  const tmpDest = finalDest + '.tmp-' + randomTempSuffix()
  try {
    await fs.promises.mkdir(path.dirname(finalDest), { recursive: true })
    await fs.promises.writeFile(tmpDest, assembled.decrypted)
    await fs.promises.rename(tmpDest, finalDest)
  } catch (err) {
    await fs.promises.unlink(tmpDest).catch(() => {})
    throw err
  }

  console.log(
    `[User:Download] Reassembled and decrypted ${assembled.decrypted.byteLength} bytes for ${p}`
  )
  return { path: p, destLocalPath: finalDest, verified: assembled.verified }
}

export async function previewFile({
  drive,
  chunkStore,
  encryptionKey,
  entryPath,
  maxBytes = MAX_PREVIEW_BYTES
}: {
  drive: HyperdriveLike
  chunkStore: GlobalChunkStore
  encryptionKey: Uint8Array
  entryPath: string
  maxBytes?: number
}): Promise<FilePreviewResult> {
  if (!chunkStore) throw new Error('Global chunk store unavailable.')
  const assembled = await assembleFile(drive, chunkStore, encryptionKey, entryPath)
  const p = normalizePath(entryPath)
  const name = path.basename(assembled.sourceName || p)
  if (assembled.decrypted.byteLength > maxBytes) {
    return {
      tooLarge: true,
      path: p,
      name,
      mime: assembled.mime,
      byteLength: assembled.decrypted.byteLength
    }
  }
  return {
    tooLarge: false,
    path: p,
    name,
    mime: assembled.mime,
    bytes: b4a.toString(assembled.decrypted, 'base64'),
    verified: assembled.verified,
    byteLength: assembled.decrypted.byteLength
  }
}
