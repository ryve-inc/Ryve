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

import sodium from 'sodium-universal'
import { encodeBuffer, decodeBuffer, DEFAULT_EC_K, DEFAULT_EC_M } from './erasure-coding'

function encryptBuffer(buf, key) {
  const nonce = b4a.alloc(sodium.crypto_secretbox_NONCEBYTES)
  sodium.randombytes_buf(nonce)
  const key32 = hypercoreCrypto.hash(key)
  const encrypted = b4a.alloc(buf.byteLength + sodium.crypto_secretbox_MACBYTES)
  sodium.crypto_secretbox_easy(encrypted, buf, nonce, key32)
  return {
    encrypted,
    nonce: b4a.toString(nonce, 'hex')
  }
}

function decryptBuffer(encrypted, key, nonceHex) {
  const nonce = b4a.from(nonceHex, 'hex')
  const key32 = hypercoreCrypto.hash(key)
  const decrypted = b4a.alloc(encrypted.byteLength - sodium.crypto_secretbox_MACBYTES)
  const ok = sodium.crypto_secretbox_open_easy(decrypted, encrypted, nonce, key32)
  if (!ok) {
    throw new Error('Cryptographic authentication failed. Key mismatch or corrupted file.')
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

    // 2. Perform Reed-Solomon Erasure Coding (K=4 data shards, M=2 parity shards)
    const ecResult = encodeBuffer(encrypted, DEFAULT_EC_K, DEFAULT_EC_M)
    const chunks = []
    const chunkMetadata = []

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

    // 3. Offload chunks to network peers in global chunk store
    let allocation = null
    if (this.chunkStore) {
      allocation = await this.chunkStore.offloadChunks(chunks, DEFAULT_EC_K, DEFAULT_EC_M)
    }

    // 4. Save metadata index in drive (tiny record)
    const meta = {
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
        faultTolerance: allocation ? allocation.faultTolerance : 'none'
      },
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

    console.log(
      `[Uploader:Pruner] ✓ SUCCESS: Offloaded ${chunks.length} erasure-coded chunks for ${dest} (FaultTolerance: ${meta.erasureCoding.faultTolerance}). Local file data cleared!`
    )

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

    console.log(`[User:Download] Reassembling chunks for ${p}...`)

    let encryptedBuffer

    if (meta.erasureCoding) {
      // Erasure Coding download path: parallel query across online peers
      const { k, m, chunkSize } = meta.erasureCoding
      const totalShards = k + m
      const availableShardsMap = new Map()

      console.log(`[User:Download] Reassembling ${totalShards} shards (K=${k}, M=${m}) for ${p}...`)

      // Launch parallel fetch requests for all N chunks
      const fetchPromises = meta.chunks.map(async (chunkMeta) => {
        if (!this.chunkStore) return null
        try {
          const chunkBuf = await this.chunkStore.fetchChunk(chunkMeta.hash, 15000)
          const actualHash = hashChunk(chunkBuf)
          if (actualHash === chunkMeta.hash) {
            availableShardsMap.set(chunkMeta.index, chunkBuf)
          } else {
            console.warn(`[User:Download] Hash mismatch for shard index ${chunkMeta.index}`)
          }
        } catch (err) {
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
        if (!this.chunkStore) {
          throw new Error('Global chunk store unavailable.')
        }
        try {
          const chunkBuf = await this.chunkStore.fetchChunk(chunkMeta.hash, 15000)
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
      encryptedBuffer = b4a.concat(encryptedChunks)
    }

    // Decrypt full buffer using master encryption key and saved nonce
    const decryptedBuffer = decryptBuffer(encryptedBuffer, this.encryptionKey, meta.nonce)

    // Write uncorrupted, decrypted file to destination path
    let finalDest = destLocalPath
    const expectedExt = path.extname(meta.sourceName || p)
    if (expectedExt && !path.extname(finalDest)) {
      finalDest += expectedExt
    }

    await fs.promises.mkdir(path.dirname(finalDest), { recursive: true })
    await fs.promises.writeFile(finalDest, decryptedBuffer)

    console.log(`[User:Download] ✓ SUCCESS: Reassembled and decrypted ${decryptedBuffer.byteLength} bytes for ${p}`)

    return { path: p, destLocalPath: finalDest, verified: true }
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
    const rawChunks = meta?.chunks || []
    const chunks = rawChunks.map((c, i) => ({
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

export { VaultDrive, normalizePath, joinPath, underPrefix }
