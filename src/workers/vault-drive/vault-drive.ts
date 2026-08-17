import Hyperdrive from 'hyperdrive'
import idEnc from 'hypercore-id-encoding'
import b4a from 'b4a'

import { normalizePath, joinPath } from './path-utils'
import { uploadFile } from './uploader'
import { downloadFile } from './downloader'

class VaultDrive {
  store: any
  swarm: any
  encryptionKey: Uint8Array | string
  blinds: any
  chunkStore: any
  drive: any
  _discovery: any

  constructor({
    store,
    swarm,
    encryptionKey,
    blinds = null,
    chunkStore = null
  }: {
    store: any
    swarm: any
    encryptionKey: Uint8Array | string
    blinds?: any
    chunkStore?: any
  }) {
    this.store = store
    this.swarm = swarm
    this.encryptionKey = encryptionKey
    this.blinds = blinds
    this.chunkStore = chunkStore
    this.drive = null
    this._discovery = null
  }

  async open() {
    this.drive = new Hyperdrive(this.store.namespace('vault'), {
      encryptionKey: this.encryptionKey
    })
    await this.drive.ready()
    return this
  }

  get key() {
    return this.drive?.key
  }

  get keyHex(): string | null {
    return this.drive ? idEnc.normalize(this.drive.key) : null
  }

  async list(dir = '/') {
    const folder = normalizePath(dir)
    const names = new Map<string, any>()
    const stream = this.drive.list(folder, { recursive: true })
    for await (const entry of stream) {
      if (entry.key === '/.share.json') continue
      const rest = folder === '/' ? entry.key.slice(1) : entry.key.slice(folder.length + 1)
      if (!rest) continue
      const name = rest.split('/')[0]
      if (!name || name === '.keep') continue
      const full = joinPath(folder, name)
      if (names.has(full)) continue
      const exact = await this.drive.entry(full)
      const isNestedOnly = rest.includes('/')
      names.set(full, {
        path: full,
        name,
        isDirectory: exact ? !exact.value.blob && !exact.value.linkname : isNestedOnly,
        byteLength: exact?.value?.metadata?.originalSize || exact?.value?.blob?.byteLength || 0,
        metadata: exact?.value?.metadata || null,
        chunkCount: exact?.value?.metadata?.chunks?.length || 0
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
    await this.drive.put(keep, b4a.alloc(0), {
      metadata: { directoryMarker: true }
    })
    return { path: p }
  }

  async upload(localPath: string, destPath: string, mime: string | null = null) {
    return uploadFile({
      drive: this.drive,
      chunkStore: this.chunkStore,
      encryptionKey: this.encryptionKey,
      localPath,
      destPath,
      mime
    })
  }

  async download(entryPath: string, destLocalPath: string) {
    return downloadFile({
      drive: this.drive,
      chunkStore: this.chunkStore,
      encryptionKey: this.encryptionKey,
      entryPath,
      destLocalPath
    })
  }

  async delete(entryPath: string) {
    const p = normalizePath(entryPath)
    await this.drive.del(p)
    return { path: p }
  }

  async getManifest(entryPath: string) {
    const p = normalizePath(entryPath)
    await this.drive.ready()
    const entry = await this.drive.entry(p)
    const meta = entry?.value?.metadata
    const rawChunks = meta?.chunks || []
    const chunks = rawChunks.map((c: any, i: number) => ({
      index: c.index !== undefined ? c.index : i,
      offset: c.offset !== undefined ? c.offset : i * (64 * 1024),
      length: c.length || 64 * 1024,
      hash: c.hash
    }))
    return {
      path: p,
      byteLength: meta?.originalSize || 0,
      mime: meta?.mime || null,
      chunks,
      metadata: meta || null
    }
  }

  async close() {
    if (this._discovery) await this._discovery.destroy().catch(() => {})
    this._discovery = null
    if (this.drive) await this.drive.close().catch(() => {})
    this.drive = null
  }
}

export { VaultDrive }

