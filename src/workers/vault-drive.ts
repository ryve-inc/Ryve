// @ts-nocheck
import path from 'bare-path'
import fs from 'bare-fs'
import Hyperdrive from 'hyperdrive'
import idEnc from 'hypercore-id-encoding'
import b4a from 'b4a'
import { buildChunkManifest } from './chunk-manifest'
import { pinCore } from './blind'
import { clearLocalChunksAfterReplication } from './prune'

function normalizePath(p) {
  if (!p || p === '/') return '/'
  const parts = []
  for (const part of String(p).split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (parts.length === 0) throw new Error('Invalid path: escapes root')
      parts.pop()
      continue
    }
    if (part.includes('\0')) throw new Error('Invalid path')
    parts.push(part)
  }
  return parts.length ? '/' + parts.join('/') : '/'
}

function joinPath(base, name) {
  if (!base || base === '/') return normalizePath('/' + name)
  return normalizePath(base + '/' + name)
}

function underPrefix(filePath, prefix) {
  const p = normalizePath(filePath)
  const pre = normalizePath(prefix || '/')
  if (pre === '/') return true
  return p === pre || p.startsWith(pre + '/')
}

class VaultDrive {
  constructor({ store, swarm, encryptionKey, blinds = null, globalPool = null }) {
    this.store = store
    this.swarm = swarm
    this.encryptionKey = encryptionKey
    this.blinds = blinds
    this.globalPool = globalPool
    this.drive = null
    this._discovery = null
  }

  async open() {
    this.drive = new Hyperdrive(this.store.namespace('vault'), {
      encryptionKey: this.encryptionKey
    })
    await this.drive.ready()
    this._discovery = this.swarm.join(this.drive.discoveryKey, { server: true, client: true })
    await this._discovery.flushed()
    if (this.globalPool) {
      this.globalPool.registerStore(this.store)
    }
    await pinCore(this.blinds, this.drive.core)
    if (this.drive.blobs?.core) await pinCore(this.blinds, this.drive.blobs.core)

    // Eagerly download all blob data from peers (not just metadata).
    // This ensures receiving peers cache the actual file chunks,
    // which enables the uploading peer's pruner to clear its local copy.
    this._startEagerDownload()

    return this
  }

  _startEagerDownload() {
    const drive = this.drive
    if (!drive) return

    const downloadAllBlobs = async () => {
      try {
        if (!drive.blobs) {
          try { await drive.getBlobs() } catch {}
        }
        if (!drive.blobs?.core) return

        const blobsCore = drive.blobs.core
        const len = blobsCore.length
        if (len === 0) return

        console.log(`[Receiver:EagerSync] Syncing ${len} encrypted blob blocks from peer...`)
        const range = blobsCore.download({ start: 0, end: len })
        await range.done()
        console.log(`[Receiver:EagerSync] Successfully cached ${len} encrypted blob blocks. Hosting data for uploader!`)
      } catch (err) {
        if (err?.message !== 'SESSION_CLOSED') {
          console.log(`[Receiver:EagerSync] Syncing in progress (waiting for peer stream)...`)
        }
      }
    }

    downloadAllBlobs()

    drive.core.on('append', () => {
      downloadAllBlobs()
    })
  }

  get key() {
    return this.drive?.key
  }

  get keyHex() {
    return this.drive ? idEnc.normalize(this.drive.key) : null
  }

  async list(dir = '/') {
    const folder = normalizePath(dir)
    const names = new Map()
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
        byteLength: exact?.value?.blob?.byteLength || 0,
        metadata: exact?.value?.metadata || null,
        chunkCount:
          exact?.value?.metadata?.chunkCount || exact?.value?.metadata?.chunks?.length || 0
      })
    }
    return [...names.values()].sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  }

  async mkdir(dirPath) {
    const p = normalizePath(dirPath)
    const keep = p === '/' ? '/.keep' : joinPath(p, '.keep')
    await this.drive.put(keep, b4a.alloc(0), {
      metadata: { directoryMarker: true }
    })
    return { path: p }
  }

  async upload(localPath, destPath, mime = null) {
    const dest = normalizePath(destPath)
    const data = await fs.promises.readFile(localPath)
    const meta = {
      mime,
      uploadedAt: Date.now(),
      sourceName: path.basename(localPath)
    }
    await this.drive.put(dest, data, { metadata: meta })
    const manifest = await buildChunkManifest(this.drive, dest)
    await this.drive.put(dest, data, {
      metadata: {
        ...meta,
        chunks: manifest.chunks,
        chunkCount: manifest.chunks.length
      }
    })
    clearLocalChunksAfterReplication(this.drive, dest, this.swarm).catch((err) => {
      console.error('[Uploader:Pruner] Error:', err)
    })
    return buildChunkManifest(this.drive, dest)
  }

  async download(entryPath, destLocalPath) {
    const p = normalizePath(entryPath)
    await this.drive.ready()
    const entry = await this.drive.entry(p)
    if (!entry || !entry.value) throw new Error('File not found: ' + p)

    if (!this.drive.blobs) {
      try { await this.drive.getBlobs() } catch {}
    }
    if (!this.drive.blobs?.core) {
      throw new Error('Blobs storage core not available')
    }

    const blob = entry.value.blob
    if (!blob) throw new Error('Entry has no blob data')

    const blobsCore = this.drive.blobs.core
    const start = blob.blockOffset
    const end = blob.blockOffset + blob.blockLength

    console.log(`[User:Download] Requesting ${blob.blockLength} blocks for ${p} from network peers...`)
    try {
      const range = blobsCore.download({ start, end })
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Peer hosting this file is offline or unavailable.')), 15000)
      })
      await Promise.race([range.done(), timeoutPromise])
      console.log(`[User:Download] Successfully fetched blocks [${start} - ${end}) from network peers.`)
    } catch (err) {
      console.error(`[User:Download] Fetch failed for ${p}:`, err?.message || err)
      throw new Error(`File unavailable: ${err?.message || 'Peer hosting this file is offline.'}`)
    }

    const data = await this.drive.get(p)
    if (!data || data.byteLength === 0) {
      throw new Error('File unavailable: Downloaded file data is empty. Peer hosting this file is offline.')
    }

    // Verify chunk integrity BEFORE writing to disk
    const manifest = await buildChunkManifest(this.drive, p)
    const expected = entry.value.metadata?.chunks
    if (expected && expected.length > 0) {
      const isVerified = expected.every((c, i) => manifest.chunks[i] && c.hash === manifest.chunks[i].hash)
      if (!isVerified) {
        throw new Error('Integrity error: Downloaded chunks do not match expected hashes. Peer hosting this file is offline.')
      }
    }

    await fs.promises.mkdir(path.dirname(destLocalPath), { recursive: true })
    await fs.promises.writeFile(destLocalPath, data)
    return { path: p, destLocalPath, verified: true, manifest }
  }

  async delete(entryPath) {
    const p = normalizePath(entryPath)
    await this.drive.del(p)
    return { path: p }
  }

  async getManifest(entryPath) {
    return buildChunkManifest(this.drive, normalizePath(entryPath))
  }

  async close() {
    if (this._discovery) await this._discovery.destroy().catch(() => {})
    this._discovery = null
    if (this.drive) await this.drive.close().catch(() => {})
    this.drive = null
  }
}

export { VaultDrive, normalizePath, joinPath, underPrefix }
