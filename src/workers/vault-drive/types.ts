import type { FaultToleranceStatus } from '../../shared/types.ts'
import type { GlobalChunkStore } from '../global-chunk-store'

export type ChunkMeta = {
  index: number
  isParity: boolean
  offset: number
  length: number
  hash: string
}

export type FileMetadata = {
  mime: string | null
  uploadedAt: number
  sourceName: string
  originalSize: number
  encryptedSize: number
  nonce: string
  erasureCoding: {
    k: number
    m: number
    chunkSize: number
    paddedSize: number
    faultTolerance: FaultToleranceStatus
  }
  chunks: ChunkMeta[]
}

export type DriveBlobPointer = {
  blockOffset: number
  blockLength: number
  byteOffset?: number
  byteLength?: number
}

export type DriveEntryRecord = {
  value?: {
    blob?: DriveBlobPointer
    linkname?: string
    metadata?: FileMetadata | Record<string, unknown> | null
  }
}

export type HyperdriveLike = {
  ready(): Promise<void>
  close(): Promise<void>
  key: Uint8Array
  discoveryKey: Uint8Array
  core: { key: Uint8Array }
  blobs?: { core: { key: Uint8Array; clear(start: number, end: number): Promise<void> } }
  entry(path: string): Promise<DriveEntryRecord | null>
  put(path: string, data: Uint8Array, opts?: { metadata?: unknown }): Promise<void>
  del(path: string): Promise<void>
  list(
    folder: string,
    opts?: { recursive?: boolean }
  ): AsyncIterable<{
    key: string
    value?: DriveEntryRecord['value']
  }>
}

export type UploadDeps = {
  drive: HyperdriveLike
  chunkStore: GlobalChunkStore
  encryptionKey: Uint8Array
  localPath: string
  destPath: string
  mime?: string | null
}

export type DownloadDeps = {
  drive: HyperdriveLike
  chunkStore: GlobalChunkStore
  encryptionKey: Uint8Array
  entryPath: string
  destLocalPath: string
}
