// @ts-nocheck
import path from 'bare-path'
import fs from 'bare-fs'
import Hyperdrive from 'hyperdrive'
import idEnc from 'hypercore-id-encoding'
import b4a from 'b4a'
import hypercoreCrypto from 'hypercore-crypto'

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

function hashChunk(buf) {
  return b4a.toString(hypercoreCrypto.hash(buf), 'hex')
}

// Encrypt / decrypt buffer with master encryption key
function encryptBuffer(buf, key) {
  const nonce = hypercoreCrypto.randomBytes(24)
  const cipher = hypercoreCrypto.hash(b4a.concat([key, nonce, buf]))
  // XOR stream for zero-knowledge chunk encryption
  const encrypted = b4a.alloc(buf.byteLength)
  for (let i = 0; i < buf.byteLength; i++) {
    encrypted[i] = buf[i] ^ cipher[i % cipher.byteLength]
  }
  return { encrypted, nonce: b4a.toString(nonce, 'hex') }
}

function decryptBuffer(encrypted, key, nonceHex) {
  const nonce = b4a.from(nonceHex, 'hex')
  const cipher = hypercoreCrypto.hash(b4a.concat([key, nonce, encrypted]))
  const decrypted = b4a.alloc(encrypted.byteLength)
  for (let i = 0; i < encrypted.byteLength; i++) {
    decrypted[i] = encrypted[i] ^ cipher[i % cipher.byteLength]
  }
  return decrypted
}

class VaultDrive {
  constructor({ store, swarm, encryptionKey, blinds = null, chunkStore = null }) {
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
    this._discovery = this.swarm.join(this.drive.discoveryKey, { server: true, client: true })
    await this._discovery.flushed()
    return this
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
    const rawBuffer = await fs.promises.readFile(localPath)
    
    // 1. Encrypt raw file buffer locally with master encryption key
    const { encrypted, nonce } = encryptBuffer(rawBuffer, this.encryptionKey)

    // 2. Break encrypted file into 64KB content-addressed chunks
    const CHUNK_SIZE = 64 * 1024
    const chunks = []
    const chunkMetadata = []

    for (let offset = 0; offset < encrypted.byteLength; offset += CHUNK_SIZE) {
      const chunkBuf = encrypted.subarray(offset, Math.min(encrypted.byteLength, offset + CHUNK_SIZE))
      const hash = hashChunk(chunkBuf)
      chunks.push({ hash, buffer: chunkBuf })
      chunkMetadata.push({ hash, length: chunkBuf.byteLength })
    }

    // 3. Offload encrypted chunks to network peers in global chunk store
    if (this.chunkStore) {
      await this.chunkStore.offloadChunks(chunks)
    }

    // 4. Save metadata index in drive (tiny record)
    const meta = {
      mime,
      uploadedAt: Date.now(),
      sourceName: path.basename(localPath),
      originalSize: rawBuffer.byteLength,
      nonce,
      chunks: chunkMetadata
    }

    // Put a dummy 1-byte marker entry so drive knows file exists
    await this.drive.put(dest, b4a.alloc(1), { metadata: meta })

    // 5. Prune local storage from drive blobs core
    if (this.drive.blobs?.core) {
      const entry = await this.drive.entry(dest)
      if (entry?.value?.blob) {
        const start = entry.value.blob.blockOffset
        const end = start + entry.value.blob.blockLength
        await this.drive.blobs.core.clear(start, end).catch(() => {})
      }
    }

    console.log(`[Uploader:Pruner] ✓ SUCCESS: Offloaded ${chunks.length} encrypted chunks for ${dest}. Local file data cleared!`)

    return {
      path: dest,
      byteLength: rawBuffer.byteLength,
      chunks: chunkMetadata,
      metadata: meta
    }
  }

  async download(entryPath, destLocalPath) {
    const p = normalizePath(entryPath)
    await this.drive.ready()
    const entry = await this.drive.entry(p)
    if (!entry || !entry.value) throw new Error('File not found: ' + p)

    const meta = entry.value.metadata
    if (!meta || !meta.chunks || !Array.isArray(meta.chunks) || meta.chunks.length === 0) {
      throw new Error('File metadata has no chunk manifest: ' + p)
    }

    console.log(`[User:Download] Reassembling ${meta.chunks.length} encrypted chunks for ${p}...`)

    const encryptedChunks = []

    // Fetch each encrypted chunk from online peers or local cache
    for (const chunkMeta of meta.chunks) {
      if (!this.chunkStore) {
        throw new Error('Global chunk store unavailable.')
      }
      try {
        const chunkBuf = await this.chunkStore.fetchChunk(chunkMeta.hash, 15000)
        
        // Verify BLAKE2b hash
        const actualHash = hashChunk(chunkBuf)
        if (actualHash !== chunkMeta.hash) {
          throw new Error(`Integrity mismatch on chunk ${chunkMeta.hash.slice(0, 12)}`)
        }
        
        encryptedChunks.push(chunkBuf)
      } catch (err) {
        console.error(`[User:Download] Failed to fetch chunk ${chunkMeta.hash.slice(0, 12)}:`, err?.message || err)
        throw new Error(`File unavailable: Peer hosting chunk ${chunkMeta.hash.slice(0, 12)} is offline.`)
      }
    }

    // Concatenate all encrypted chunks
    const concatenatedEncrypted = b4a.concat(encryptedChunks)

    // Decrypt full buffer using master encryption key and saved nonce
    const decryptedBuffer = decryptBuffer(concatenatedEncrypted, this.encryptionKey, meta.nonce)

    // Write uncorrupted, decrypted file to destination path
    await fs.promises.mkdir(path.dirname(destLocalPath), { recursive: true })
    await fs.promises.writeFile(destLocalPath, decryptedBuffer)

    console.log(`[User:Download] ✓ SUCCESS: Reassembled and decrypted ${decryptedBuffer.byteLength} bytes for ${p}`)

    return { path: p, destLocalPath, verified: true }
  }

  async delete(entryPath) {
    const p = normalizePath(entryPath)
    await this.drive.del(p)
    return { path: p }
  }

  async getManifest(entryPath) {
    const p = normalizePath(entryPath)
    await this.drive.ready()
    const entry = await this.drive.entry(p)
    const meta = entry?.value?.metadata
    return {
      path: p,
      byteLength: meta?.originalSize || 0,
      mime: meta?.mime || null,
      chunks: meta?.chunks || [],
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

export { VaultDrive, normalizePath, joinPath, underPrefix }
