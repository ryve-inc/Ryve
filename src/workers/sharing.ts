// @ts-nocheck
import b4a from 'b4a'
import z32 from 'z32'
import Hyperdrive from 'hyperdrive'
import Corestore from 'corestore'
import idEnc from 'hypercore-id-encoding'
import hypercoreCrypto from 'hypercore-crypto'
import fs from 'bare-fs'
import path from 'bare-path'
import { buildChunkManifest } from './chunk-manifest'
import { normalizePath, joinPath, underPrefix } from './vault-drive'
import { pinCore, loadSharesIndex, saveSharesIndex } from './blind'
import { clearLocalChunksAfterReplication } from './prune'

function encodeInvite(payload) {
  return 'drive:' + z32.encode(b4a.from(JSON.stringify(payload)))
}

function decodeInvite(invite) {
  const raw = String(invite).trim()
  const body = raw.startsWith('drive:') ? raw.slice(6) : raw
  try {
    return JSON.parse(b4a.toString(z32.decode(body)))
  } catch {
    throw new Error('Invalid share invite')
  }
}

function deriveRoomEncryption(seed) {
  const seedBuf = typeof seed === 'string' ? b4a.from(seed, 'hex') : seed
  return hypercoreCrypto.hash(b4a.concat([b4a.from('pear-drive/share-enc/v1'), seedBuf]))
}

function assertUnderPrefix(filePath, prefix) {
  if (!underPrefix(filePath, prefix)) {
    throw new Error('Path is outside the shared prefix')
  }
}

class ShareManager {
  constructor({ store, swarm, blinds, identityHex, storageDir }) {
    this.store = store
    this.swarm = swarm
    this.blinds = blinds
    this.identityHex = identityHex
    this.storageDir = storageDir
    this.readShares = new Map()
    this.collabShares = new Map()
    this._discoveries = new Set()
  }

  async _persistIndex() {
    const shares = []
    for (const r of this.readShares.values()) {
      const driveKey = idEnc.normalize(r.drive?.key || r.id.split(':')[0])
      shares.push({
        id: r.id,
        type: 'read',
        name: r.name,
        pathPrefix: r.pathPrefix || '/',
        driveKey,
        encryptionKey: b4a.toString(r.encryptionKey, 'hex'),
        from: r.from || null,
        writable: false,
        outbound: !!r.outbound
      })
    }
    for (const r of this.collabShares.values()) {
      shares.push({
        id: r.id,
        type: 'collab',
        name: r.name,
        seed: r.seed,
        from: r.from || null,
        writable: true
      })
    }
    await saveSharesIndex(this.storageDir, shares)
  }

  async restoreFromDisk() {
    const listed = await loadSharesIndex(this.storageDir)
    for (const item of listed) {
      try {
        if (item.type === 'collab' && item.seed) {
          await this._joinCollab({
            seed: item.seed,
            name: item.name,
            from: item.from || null
          })
        } else if (item.type === 'read' && item.outbound) {
          if (!this.readShares.has(item.id)) {
            this.readShares.set(item.id, {
              id: item.id,
              type: 'read',
              drive: null,
              encryptionKey: b4a.from(item.encryptionKey, 'hex'),
              pathPrefix: item.pathPrefix || '/',
              writable: false,
              name: item.name || 'Shared folder',
              from: item.from || null,
              outbound: true
            })
          }
        } else if (item.type === 'read' && item.driveKey && item.encryptionKey && !item.outbound) {
          await this._joinRead({
            driveKey: item.driveKey,
            encryptionKey: item.encryptionKey,
            pathPrefix: item.pathPrefix || '/',
            from: item.from || null,
            name: item.name
          })
        }
      } catch (err) {
        console.error('Failed to restore share', item.id, err)
      }
    }

    try {
      const sharesRoot = path.join(this.storageDir, 'shares')
      const dirs = await fs.promises.readdir(sharesRoot).catch(() => [])
      for (const seedHex of dirs) {
        if (!/^[0-9a-f]{64}$/i.test(seedHex)) continue
        const already = [...this.collabShares.values()].some((s) => s.seed === seedHex)
        if (already) continue
        await this._joinCollab({ seed: seedHex, name: 'Shared folder' })
      }
    } catch {}

    await this._persistIndex()
  }

  _trackDiscovery(disc) {
    if (disc) this._discoveries.add(disc)
    return disc
  }

  async createReadShare(vaultDrive, pathPrefix = '/') {
    const prefix = normalizePath(pathPrefix)
    const invite = encodeInvite({
      v: 1,
      type: 'read',
      driveKey: idEnc.normalize(vaultDrive.key),
      encryptionKey: b4a.toString(vaultDrive.encryptionKey, 'hex'),
      pathPrefix: prefix,
      capability: 'read',
      from: this.identityHex
    })

    // Track outbound read share for UI persistence (still whole-drive capability until dedicated subtree)
    const id = idEnc.normalize(vaultDrive.key) + ':' + prefix
    if (!this.readShares.has(id)) {
      this.readShares.set(id, {
        id,
        type: 'read',
        drive: vaultDrive.drive,
        encryptionKey: vaultDrive.encryptionKey,
        pathPrefix: prefix,
        writable: false,
        name: 'Shared folder · ' + (prefix === '/' ? 'root' : prefix),
        from: this.identityHex,
        outbound: true
      })
      await this._persistIndex()
    }

    return { invite, type: 'read', pathPrefix: prefix, id }
  }

  async createCollabShare(name = 'Shared folder') {
    const seed = hypercoreCrypto.randomBytes(32)
    const seedHex = b4a.toString(seed, 'hex')
    const encryptionKey = deriveRoomEncryption(seed)
    const sharePath = path.join(this.storageDir, 'shares', seedHex)
    await fs.promises.mkdir(sharePath, { recursive: true })
    const roomStore = new Corestore(sharePath, { primaryKey: seed, unsafe: true })
    await roomStore.ready()
    for (const conn of this.swarm.connections) roomStore.replicate(conn)
    const drive = new Hyperdrive(roomStore, { encryptionKey })
    await drive.ready()
    this._trackDiscovery(this.swarm.join(drive.discoveryKey, { server: true, client: true }))
    await pinCore(this.blinds, drive.core)
    if (drive.blobs?.core) await pinCore(this.blinds, drive.blobs.core)
    await drive.put('/.share.json', b4a.from(JSON.stringify({ name, createdAt: Date.now() })))
    const id = idEnc.normalize(drive.key)
    const record = {
      id,
      name,
      type: 'collab',
      drive,
      roomStore,
      encryptionKey,
      seed: seedHex,
      writable: true
    }
    this.collabShares.set(id, record)
    await this._persistIndex()
    const invite = encodeInvite({
      v: 1,
      type: 'collab',
      seed: seedHex,
      name,
      capability: 'write',
      from: this.identityHex
    })
    return { invite, id, name, type: 'collab' }
  }

  async joinShare(inviteStr) {
    const payload = decodeInvite(inviteStr)
    if (payload.type === 'read') {
      const info = await this._joinRead(payload)
      await this._persistIndex()
      return info
    }
    if (payload.type === 'collab') {
      const info = await this._joinCollab(payload)
      await this._persistIndex()
      return info
    }
    throw new Error('Unknown share type')
  }

  async _joinRead(payload) {
    const driveKey = idEnc.decode(payload.driveKey)
    const encryptionKey = b4a.from(payload.encryptionKey, 'hex')
    const pathPrefix = normalizePath(payload.pathPrefix || '/')
    const id = idEnc.normalize(driveKey) + ':' + pathPrefix
    if (this.readShares.has(id)) return this._shareInfo(this.readShares.get(id))

    const drive = new Hyperdrive(
      this.store.namespace('read/' + idEnc.normalize(driveKey)),
      driveKey,
      {
        encryptionKey
      }
    )
    await drive.ready()
    this._trackDiscovery(this.swarm.join(drive.discoveryKey, { server: false, client: true }))
    const done = drive.findingPeers()
    this.swarm.flush().then(done, done)
    await drive.update({ wait: true }).catch(() => {})

    const record = {
      id,
      type: 'read',
      drive,
      encryptionKey,
      pathPrefix,
      writable: false,
      name: payload.name || 'Shared · ' + idEnc.normalize(driveKey).slice(0, 8),
      from: payload.from || null
    }
    this.readShares.set(id, record)
    return this._shareInfo(record)
  }

  async _joinCollab(payload) {
    let seed
    try {
      seed = b4a.from(payload.seed, 'hex')
    } catch {
      throw new Error('Invalid collab share seed')
    }
    // Always derive directory name from decoded bytes — never trust raw invite string paths.
    const seedHex = b4a.toString(seed, 'hex')
    if (seed.byteLength !== 32 || !/^[0-9a-f]{64}$/.test(seedHex)) {
      throw new Error('Invalid collab share seed')
    }

    const existingBySeed = [...this.collabShares.values()].find((s) => s.seed === seedHex)
    if (existingBySeed) return this._shareInfo(existingBySeed)

    const encryptionKey = deriveRoomEncryption(seed)
    // seedHex is validated hex above, so join cannot escape shares/
    const sharePath = path.join(this.storageDir, 'shares', seedHex)
    await fs.promises.mkdir(sharePath, { recursive: true })
    const roomStore = new Corestore(sharePath, { primaryKey: seed, unsafe: true })
    await roomStore.ready()
    for (const conn of this.swarm.connections) roomStore.replicate(conn)
    const drive = new Hyperdrive(roomStore, { encryptionKey })
    await drive.ready()
    const discovery = this._trackDiscovery(
      this.swarm.join(drive.discoveryKey, { server: true, client: true })
    )
    await pinCore(this.blinds, drive.core)
    if (drive.blobs?.core) await pinCore(this.blinds, drive.blobs.core)
    const done = drive.findingPeers()
    this.swarm.flush().then(done, done)
    await drive.update({ wait: true }).catch(() => {})

    let name = payload.name || 'Collaborative folder'
    try {
      const meta = await drive.get('/.share.json')
      if (meta) name = JSON.parse(b4a.toString(meta)).name || name
    } catch {}

    const id = idEnc.normalize(drive.key)
    if (this.collabShares.has(id)) {
      if (discovery) {
        this._discoveries.delete(discovery)
        await discovery.destroy?.().catch?.(() => {})
      }
      await drive.close().catch(() => {})
      await roomStore.close().catch(() => {})
      return this._shareInfo(this.collabShares.get(id))
    }

    const record = {
      id,
      name,
      type: 'collab',
      drive,
      roomStore,
      encryptionKey,
      seed: seedHex,
      writable: true,
      from: payload.from || null
    }
    this.collabShares.set(id, record)
    return this._shareInfo(record)
  }

  _shareInfo(record) {
    return {
      id: record.id,
      name: record.name,
      type: record.type,
      pathPrefix: record.pathPrefix || '/',
      writable: !!record.writable,
      from: record.from || null
    }
  }

  listShares() {
    return [
      ...[...this.readShares.values()].map((r) => this._shareInfo(r)),
      ...[...this.collabShares.values()].map((r) => this._shareInfo(r))
    ]
  }

  getShare(id) {
    return this.readShares.get(id) || this.collabShares.get(id) || null
  }

  async listShareFiles(id, dir = null) {
    const share = this.getShare(id)
    if (!share) throw new Error('Share not found')
    if (share.outbound) {
      // Outbound read share points at personal vault drive already listed elsewhere
      return []
    }
    const folder = normalizePath(dir || share.pathPrefix || '/')
    assertUnderPrefix(folder, share.pathPrefix || '/')

    const names = new Map()
    for await (const entry of share.drive.list(folder, { recursive: true })) {
      if (entry.key === '/.share.json') continue
      if (!underPrefix(entry.key, share.pathPrefix || '/')) continue
      const rest = folder === '/' ? entry.key.slice(1) : entry.key.slice(folder.length + 1)
      if (!rest) continue
      const name = rest.split('/')[0]
      if (!name || name.startsWith('.')) continue
      const full = joinPath(folder, name)
      if (names.has(full)) continue
      const exact = await share.drive.entry(full)
      names.set(full, {
        path: full,
        name,
        isDirectory: exact ? !exact.value.blob && !exact.value.linkname : rest.includes('/'),
        byteLength: exact?.value?.blob?.byteLength || 0,
        metadata: exact?.value?.metadata || null
      })
    }
    return [...names.values()].sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  }

  async uploadToShare(id, localPath, destPath, mime = null) {
    const share = this.getShare(id)
    if (!share || !share.writable) throw new Error('Share is not writable')
    const dest = normalizePath(destPath)
    assertUnderPrefix(dest, share.pathPrefix || '/')
    const data = await fs.promises.readFile(localPath)
    const tempMeta = {
      mime,
      uploadedAt: Date.now(),
      sourceName: path.basename(localPath),
      by: this.identityHex
    }
    await share.drive.put(dest, data, { metadata: tempMeta })
    const manifest = await buildChunkManifest(share.drive, dest)
    await share.drive.put(dest, data, {
      metadata: { ...tempMeta, chunks: manifest.chunks, chunkCount: manifest.chunks.length }
    })
    clearLocalChunksAfterReplication(share.drive, dest).catch((err) => {
      console.error('[Pruner] Background share pruning error:', err)
    })
    return buildChunkManifest(share.drive, dest)
  }

  async downloadFromShare(id, entryPath, destLocalPath) {
    const share = this.getShare(id)
    if (!share) throw new Error('Share not found')
    const p = normalizePath(entryPath)
    assertUnderPrefix(p, share.pathPrefix || '/')
    const data = await share.drive.get(p)
    if (!data) throw new Error('File not found')
    await fs.promises.mkdir(path.dirname(destLocalPath), { recursive: true })
    await fs.promises.writeFile(destLocalPath, data)
    const entry = await share.drive.entry(p)
    const expected = entry?.value?.metadata?.chunks
    const manifest = await buildChunkManifest(share.drive, p)
    let verified = true
    if (expected) {
      verified = expected.every((c, i) => c.hash === manifest.chunks[i]?.hash)
    }
    return { path: p, destLocalPath, manifest, verified }
  }

  async getManifest(id, entryPath) {
    const share = this.getShare(id)
    if (!share) throw new Error('Share not found')
    const p = normalizePath(entryPath)
    assertUnderPrefix(p, share.pathPrefix || '/')
    return buildChunkManifest(share.drive, p)
  }

  async pinAll() {
    for (const share of [...this.readShares.values(), ...this.collabShares.values()]) {
      if (share.outbound || !share.drive) continue
      await pinCore(this.blinds, share.drive.core)
      if (share.drive.blobs?.core) await pinCore(this.blinds, share.drive.blobs.core)
    }
  }

  async close() {
    for (const disc of this._discoveries) {
      await disc.destroy?.().catch?.(() => {})
    }
    this._discoveries.clear()
    for (const s of this.readShares.values()) {
      if (!s.outbound && s.drive) await s.drive.close().catch(() => {})
    }
    for (const s of this.collabShares.values()) {
      await s.drive.close().catch(() => {})
      if (s.roomStore) await s.roomStore.close().catch(() => {})
    }
    this.readShares.clear()
    this.collabShares.clear()
  }
}

export { ShareManager }
