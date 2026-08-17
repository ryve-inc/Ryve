import Hyperdrive from 'hyperdrive'
import idEnc from 'hypercore-id-encoding'
import * as b4a from 'b4a'
import type { ChunkManifest } from '../../shared/types.ts'
import type Corestore from 'corestore'
import type Hyperswarm from 'hyperswarm'
import type { GlobalChunkStore } from '../global-chunk-store'
import { normalizePath, joinPath } from './path-utils'
import { uploadFile } from './uploader'
import { downloadFile, previewFile } from './downloader'
import type { FileMetadata, HyperdriveLike } from './types'

function collectChunkHashes(entry: { value?: { metadata?: unknown } } | null, hashes: string[]) {
  const metadata = entry?.value?.metadata
  if (!metadata || typeof metadata !== 'object') return
  const chunks = (metadata as { chunks?: unknown }).chunks
  if (!Array.isArray(chunks)) return
  for (const chunk of chunks) {
    if (
      chunk &&
      typeof chunk === 'object' &&
      typeof (chunk as { hash?: unknown }).hash === 'string'
    ) {
      hashes.push((chunk as { hash: string }).hash)
    }
  }
}

export class VaultDrive {
  store: Corestore
  swarm: Hyperswarm
  encryptionKey: Uint8Array
  chunkStore: GlobalChunkStore
  drive: HyperdriveLike | null
  private _discovery: { flushed(): Promise<void>; destroy(): Promise<void> } | null

  constructor({
    store,
    swarm,
    encryptionKey,
    chunkStore
  }: {
    store: Corestore
    swarm: Hyperswarm
    encryptionKey: Uint8Array
    chunkStore: GlobalChunkStore
  }) {
    this.store = store
    this.swarm = swarm
    this.encryptionKey = encryptionKey
    this.chunkStore = chunkStore
    this.drive = null
    this._discovery = null
  }

  async open(): Promise<this> {
    if (this.drive) return this
    const drive = new Hyperdrive(this.store.namespace('vault'), {
      encryptionKey: this.encryptionKey
    }) as unknown as HyperdriveLike
    this.drive = drive
    try {
      await drive.ready()
      this._discovery = this.swarm.join(drive.discoveryKey, { server: true, client: true })
      await this._discovery.flushed()
      return this
    } catch (err) {
      await this.close()
      throw err
    }
  }

  get key(): Uint8Array | null {
    return this.drive?.key || null
  }

  get keyHex(): string | null {
    return this.drive ? idEnc.normalize(this.drive.key) : null
  }

  private requireDrive(): HyperdriveLike {
    if (!this.drive) throw new Error('Vault is not open')
    return this.drive
  }

  async list(dir = '/') {
    const drive = this.requireDrive()
    const folder = normalizePath(dir)
    const names = new Map<
      string,
      {
        path: string
        name: string
        isDirectory: boolean
        byteLength: number
        metadata: Record<string, unknown> | null
        chunkCount: number
      }
    >()
    const stream = drive.list(folder, { recursive: true })
    for await (const entry of stream) {
      const rest = folder === '/' ? entry.key.slice(1) : entry.key.slice(folder.length + 1)
      if (!rest) continue
      const name = rest.split('/')[0]
      if (!name || name === '.keep') continue
      const full = joinPath(folder, name)
      if (names.has(full)) continue
      const exact = await drive.entry(full)
      const isNestedOnly = rest.includes('/')
      const metadata = (exact?.value?.metadata || null) as Record<string, unknown> | null
      const originalSize =
        metadata && typeof metadata.originalSize === 'number' ? metadata.originalSize : 0
      const chunks = metadata && Array.isArray(metadata.chunks) ? metadata.chunks : []
      names.set(full, {
        path: full,
        name,
        isDirectory: exact ? !exact.value?.blob && !exact.value?.linkname : isNestedOnly,
        byteLength: originalSize || exact?.value?.blob?.byteLength || 0,
        metadata,
        chunkCount: chunks.length
      })
    }
    return [...names.values()].sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  }

  async mkdir(dirPath: string) {
    const p = normalizePath(dirPath)
    const keep = p === '/' ? '/.keep' : joinPath(p, '.keep')
    await this.requireDrive().put(keep, b4a.alloc(0), {
      metadata: { directoryMarker: true }
    })
    return { path: p }
  }

  async upload(localPath: string, destPath: string, mime: string | null = null) {
    return uploadFile({
      drive: this.requireDrive(),
      chunkStore: this.chunkStore,
      encryptionKey: this.encryptionKey,
      localPath,
      destPath,
      mime
    })
  }

  async download(entryPath: string, destLocalPath: string) {
    return downloadFile({
      drive: this.requireDrive(),
      chunkStore: this.chunkStore,
      encryptionKey: this.encryptionKey,
      entryPath,
      destLocalPath
    })
  }

  async preview(entryPath: string) {
    return previewFile({
      drive: this.requireDrive(),
      chunkStore: this.chunkStore,
      encryptionKey: this.encryptionKey,
      entryPath
    })
  }

  async delete(entryPath: string) {
    const drive = this.requireDrive()
    const p = normalizePath(entryPath)
    const paths = new Set<string>()
    const hashes: string[] = []

    const exact = await drive.entry(p)
    if (exact) {
      paths.add(p)
      collectChunkHashes(exact, hashes)
    }

    for await (const entry of drive.list(p, { recursive: true })) {
      if (!entry?.key) continue
      paths.add(entry.key)
      collectChunkHashes(entry, hashes)
    }

    for (const key of paths) {
      await drive.del(key)
    }

    if (hashes.length) await this.chunkStore.purgeChunks(hashes)
    return { path: p }
  }

  async getManifest(entryPath: string): Promise<ChunkManifest> {
    const drive = this.requireDrive()
    const p = normalizePath(entryPath)
    await drive.ready()
    const entry = await drive.entry(p)
    if (!entry?.value) throw new Error('File not found: ' + p)
    const meta = (entry.value.metadata || null) as FileMetadata | null
    const rawChunks = meta?.chunks || []
    const chunkSize = meta?.erasureCoding?.chunkSize || 64 * 1024
    const chunks = rawChunks.map((c, i) => ({
      index: c.index !== undefined ? c.index : i,
      offset: c.offset !== undefined ? c.offset : i * chunkSize,
      length: c.length || chunkSize,
      hash: c.hash,
      isParity: c.isParity
    }))
    return {
      path: p,
      byteLength: meta?.originalSize || 0,
      mime: meta?.mime || null,
      chunks,
      metadata: (meta || null) as Record<string, unknown> | null,
      erasureCoding: meta?.erasureCoding
    }
  }

  async close(): Promise<void> {
    if (this._discovery) await this._discovery.destroy().catch(() => {})
    this._discovery = null
    if (this.drive) await this.drive.close().catch(() => {})
    this.drive = null
  }
}
