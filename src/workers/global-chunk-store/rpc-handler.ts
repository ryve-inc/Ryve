import path from 'bare-path'
import fs from 'bare-fs'
import b4a from 'b4a'
import hypercoreCrypto from 'hypercore-crypto'
import ProtomuxRPC from 'protomux-rpc'
import c from 'compact-encoding'

export function setupConnectionRpc(
  conn: any,
  swarm: any,
  cacheDir: string,
  publicCatalog?: any,
  getNetworkKeyHex?: () => string | null,
  onPublicCatalogUpdated?: (networkKeyHex: string) => void,
  getJoinedNetworkKeys?: () => string[],
  isNetworkJoined?: (networkKeyHex: string) => boolean,
  storageManager?: any,
  onStorageChanged?: () => void,
  onPeerHandshake?: (conn: any, networkKeys: string[]) => void
) {
  if (conn._chunkRpc) return

  console.log(`[ChunkStore:Network] Swarm socket connected. Active peers: ${swarm.connections.size}`)

  const rpc = new ProtomuxRPC(conn, {
    protocol: 'p2cloud-chunk-store-v1',
    valueEncoding: c.json
  })

  conn._chunkRpc = rpc
  if (!conn._networkKeyHexes) {
    conn._networkKeyHexes = new Set<string>()
  }
  if (!conn._allocatedStorageByNetwork) {
    conn._allocatedStorageByNetwork = new Map<string, number>()
  }
  if (!conn._usedStorageByNetwork) {
    conn._usedStorageByNetwork = new Map<string, number>()
  }
  if (!conn._availableStorageByNetwork) {
    conn._availableStorageByNetwork = new Map<string, number>()
  }
  if (conn._availableStorageBytes === undefined) {
    conn._availableStorageBytes = 1 * 1024 * 1024 * 1024 // Default 1 GB
  }

  const getLocalPeerId = () => {
    if (swarm?.keyPair?.publicKey) return b4a.toString(swarm.keyPair.publicKey, 'hex')
    if (conn?.publicKey) return b4a.toString(conn.publicKey, 'hex')
    return null
  }

  if (conn.remotePublicKey) {
    conn._peerId = b4a.toString(conn.remotePublicKey, 'hex')
  }

  // 1. Handshake to exchange joined network keys and full storage capacity per-network between peers
  rpc.respond('handshake', async (req: any) => {
    if (req?.peerId && !conn._peerId) {
      conn._peerId = req.peerId
    }
    const peerKeys: string[] = Array.isArray(req?.networkKeyHexes) ? req.networkKeyHexes : []
    for (const k of peerKeys) {
      if (typeof k === 'string' && k.length > 0) conn._networkKeyHexes.add(k)
    }
    if (req?.allocatedByNetwork && typeof req.allocatedByNetwork === 'object') {
      for (const [k, v] of Object.entries(req.allocatedByNetwork)) {
        if (typeof v === 'number') conn._allocatedStorageByNetwork.set(k, v)
      }
    }
    if (req?.usedByNetwork && typeof req.usedByNetwork === 'object') {
      for (const [k, v] of Object.entries(req.usedByNetwork)) {
        if (typeof v === 'number') conn._usedStorageByNetwork.set(k, v)
      }
    }
    if (req?.availableByNetwork && typeof req.availableByNetwork === 'object') {
      for (const [k, v] of Object.entries(req.availableByNetwork)) {
        if (typeof v === 'number') conn._availableStorageByNetwork.set(k, v)
      }
    }
    if (typeof req?.availableStorageBytes === 'number') {
      conn._availableStorageBytes = req.availableStorageBytes
    }

    const myKeys = getJoinedNetworkKeys ? getJoinedNetworkKeys() : []
    const myAllocatedByNet: Record<string, number> = {}
    const myUsedByNet: Record<string, number> = {}
    const myAvailableByNet: Record<string, number> = {}
    if (storageManager && myKeys.length > 0) {
      for (const k of myKeys) {
        myAllocatedByNet[k] = storageManager.getAllocatedBytesForNetwork(k)
        myUsedByNet[k] = storageManager.getUsedBytesForNetwork(k)
        myAvailableByNet[k] = await storageManager.getAvailableBytesForNetwork(k)
      }
    }

    const defaultAvailable = storageManager
      ? await storageManager.getAvailableBytesForNetwork(null)
      : 1 * 1024 * 1024 * 1024

    conn._handshakeCompleted = true
    if (typeof onPeerHandshake === 'function' && peerKeys.length > 0) {
      try {
        onPeerHandshake(conn, Array.from(conn._networkKeyHexes))
      } catch {}
    }

    return {
      ok: true,
      peerId: getLocalPeerId(),
      networkKeyHexes: myKeys,
      availableStorageBytes: defaultAvailable,
      allocatedByNetwork: myAllocatedByNet,
      usedByNetwork: myUsedByNet,
      availableByNetwork: myAvailableByNet
    }
  })

  // Send immediate handshake to the remote peer
  const initiateHandshake = async () => {
    try {
      const myKeys = getJoinedNetworkKeys ? getJoinedNetworkKeys() : []
      const myAllocatedByNet: Record<string, number> = {}
      const myUsedByNet: Record<string, number> = {}
      const myAvailableByNet: Record<string, number> = {}
      if (storageManager && myKeys.length > 0) {
        for (const k of myKeys) {
          myAllocatedByNet[k] = storageManager.getAllocatedBytesForNetwork(k)
          myUsedByNet[k] = storageManager.getUsedBytesForNetwork(k)
          myAvailableByNet[k] = await storageManager.getAvailableBytesForNetwork(k)
        }
      }
      const defaultAvailable = storageManager
        ? await storageManager.getAvailableBytesForNetwork(null)
        : 1 * 1024 * 1024 * 1024

      const res = await rpc.request(
        'handshake',
        {
          peerId: getLocalPeerId(),
          networkKeyHexes: myKeys,
          availableStorageBytes: defaultAvailable,
          allocatedByNetwork: myAllocatedByNet,
          usedByNetwork: myUsedByNet,
          availableByNetwork: myAvailableByNet
        },
        { timeout: 5000 }
      )
      if (res && res.peerId && !conn._peerId) {
        conn._peerId = res.peerId
      }
      if (res && Array.isArray(res.networkKeyHexes)) {
        for (const k of res.networkKeyHexes) {
          if (typeof k === 'string' && k.length > 0) conn._networkKeyHexes.add(k)
        }
      }
      if (res && res.allocatedByNetwork && typeof res.allocatedByNetwork === 'object') {
        for (const [k, v] of Object.entries(res.allocatedByNetwork)) {
          if (typeof v === 'number') conn._allocatedStorageByNetwork.set(k, v)
        }
      }
      if (res && res.usedByNetwork && typeof res.usedByNetwork === 'object') {
        for (const [k, v] of Object.entries(res.usedByNetwork)) {
          if (typeof v === 'number') conn._usedStorageByNetwork.set(k, v)
        }
      }
      if (res && res.availableByNetwork && typeof res.availableByNetwork === 'object') {
        for (const [k, v] of Object.entries(res.availableByNetwork)) {
          if (typeof v === 'number') conn._availableStorageByNetwork.set(k, v)
        }
      }
      if (res && typeof res.availableStorageBytes === 'number') {
        conn._availableStorageBytes = res.availableStorageBytes
      }

      conn._handshakeCompleted = true

      if (typeof onPeerHandshake === 'function' && conn._networkKeyHexes.size > 0) {
        try {
          onPeerHandshake(conn, Array.from(conn._networkKeyHexes))
        } catch {}
      }
      if (typeof onStorageChanged === 'function') {
        try { onStorageChanged() } catch {}
      }
    } catch { }
  }
  initiateHandshake().catch(() => { })

  // Real-time dynamic peer storage update handler
  rpc.respond('storage-update', async (req: any) => {
    if (!req || !req.networkKeyHex) return { ok: false }
    const netKey = req.networkKeyHex
    if (typeof req.allocatedBytes === 'number') {
      conn._allocatedStorageByNetwork.set(netKey, req.allocatedBytes)
    }
    if (typeof req.usedBytes === 'number') {
      conn._usedStorageByNetwork.set(netKey, req.usedBytes)
    }
    if (typeof req.availableBytes === 'number') {
      conn._availableStorageByNetwork.set(netKey, req.availableBytes)
    }
    console.log(
      `[ChunkStore:StorageRPC] Received storage update from peer for network ${netKey.slice(0, 12)}: Allocated ${(
        (req.allocatedBytes || 0) /
        1024 /
        1024
      ).toFixed(1)} MB`
    )
    if (typeof onStorageChanged === 'function') {
      try {
        onStorageChanged()
      } catch {}
    }
    return { ok: true }
  })

  // 2. Fetch chunk with integrity check & network verification
  rpc.respond('get-chunk', async (req: any) => {
    if (!req || !req.hash) throw new Error('Invalid request')
    if (req.networkKeyHex && isNetworkJoined && !isNetworkJoined(req.networkKeyHex)) {
      throw new Error(`Forbidden: Peer is not a member of network ${req.networkKeyHex.slice(0, 12)}`)
    }
    const chunkPath = path.join(cacheDir, req.hash + '.bin')
    try {
      const buf: any = await fs.promises.readFile(chunkPath)
      const actualHash = b4a.toString(hypercoreCrypto.hash(buf), 'hex')
      if (actualHash !== req.hash) {
        console.warn(`[ChunkStore:Server] ⚠️ Local chunk ${req.hash.slice(0, 12)} corrupted/tampered on disk! Purging local file.`)
        await fs.promises.chmod(chunkPath, 0o666).catch(() => { })
        await fs.promises.unlink(chunkPath).catch(() => { })
        throw new Error(`Chunk ${req.hash.slice(0, 12)} corrupted in local storage`)
      }
      console.log(`[ChunkStore:Server] Serving chunk ${req.hash.slice(0, 12)} (${buf?.byteLength || 0} bytes)`)
      return { hash: req.hash, data: b4a.toString(buf, 'hex') }
    } catch (err: any) {
      if (err?.message?.includes('corrupted')) throw err
      throw new Error(`Chunk ${req.hash.slice(0, 12)} not found in local cache`)
    }
  })

  // 3. Store chunk with strict per-network quota & integrity validation + read-only locking
  rpc.respond('store-chunk', async (req: any) => {
    if (!req || !req.hash || !req.data) throw new Error('Invalid store chunk payload')
    if (!conn._handshakeCompleted) {
      throw new Error('Forbidden: Peer connection handshake is not yet completed')
    }
    if (req.networkKeyHex && isNetworkJoined && !isNetworkJoined(req.networkKeyHex)) {
      throw new Error(`Forbidden: Receiver is not a member of network ${req.networkKeyHex.slice(0, 12)}`)
    }
    const buf = b4a.from(req.data, 'hex')
    const actualHash = b4a.toString(hypercoreCrypto.hash(buf), 'hex')
    if (actualHash !== req.hash) {
      throw new Error(`Integrity check failed: Incoming chunk data hash mismatch`)
    }

    if (storageManager) {
      // STRICT PER-NETWORK VALIDATION
      const canAccept = await storageManager.canAccept(buf.byteLength, req.networkKeyHex)
      if (!canAccept) {
        console.warn(
          `[ChunkStore:Quota] Rejected chunk ${req.hash.slice(0, 12)} (${buf.byteLength} bytes) for network ${req.networkKeyHex ? req.networkKeyHex.slice(0, 12) : 'default'}: Storage quota full`
        )
        throw new Error('QUOTA_EXCEEDED')
      }
    }

    let storageChangeTimer: any = null
    const triggerStorageChangedThrottled = () => {
      if (typeof onStorageChanged !== 'function') return
      if (storageChangeTimer) return
      storageChangeTimer = setTimeout(() => {
        storageChangeTimer = null
        try {
          if (typeof onStorageChanged === 'function') onStorageChanged()
        } catch { }
      }, 400)
    }

    const chunkPath = path.join(cacheDir, req.hash + '.bin')
    await fs.promises.writeFile(chunkPath, buf)
    await fs.promises.chmod(chunkPath, 0o444).catch(() => { })

    if (storageManager) {
      storageManager.recordChunkAdded(req.hash, buf.byteLength, req.networkKeyHex)
    }

    triggerStorageChangedThrottled()

    console.log(
      `[ChunkStore:Cache] Stored chunk ${req.hash.slice(0, 12)} (${buf.byteLength} bytes, Read-Only) for network ${req.networkKeyHex ? req.networkKeyHex.slice(0, 12) : 'direct'}`
    )
    return { ok: true, hash: req.hash }
  })

  // 4. Remote peer chunk deletion request
  rpc.respond('delete-chunks', async (req: any) => {
    if (!req || !Array.isArray(req.hashes)) throw new Error('Invalid delete chunks request')
    if (req.networkKeyHex && isNetworkJoined && !isNetworkJoined(req.networkKeyHex)) {
      throw new Error(`Forbidden: Requester is not a member of network ${req.networkKeyHex.slice(0, 12)}`)
    }
    let count = 0
    let freedBytes = 0
    for (const hash of req.hashes) {
      if (!hash || typeof hash !== 'string') continue
      const chunkPath = path.join(cacheDir, hash + '.bin')
      try {
        const st = await fs.promises.stat(chunkPath).catch(() => null)
        await fs.promises.chmod(chunkPath, 0o666).catch(() => { })
        await fs.promises.unlink(chunkPath)
        count++
        if (st && typeof st.size === 'number') {
          freedBytes += st.size
          if (storageManager) storageManager.recordChunkRemoved(hash, st.size, req.networkKeyHex)
        }
      } catch (err) {
        try {
          const st = await fs.promises.stat(chunkPath).catch(() => null)
          await fs.promises.chmod(chunkPath, 0o777).catch(() => { })
          await fs.promises.unlink(chunkPath)
          count++
          if (st && typeof st.size === 'number') {
            freedBytes += st.size
            if (storageManager) storageManager.recordChunkRemoved(hash, st.size, req.networkKeyHex)
          }
        } catch { }
      }
    }

    if (storageManager && count > 0) {
      await storageManager.recalculateUsedBytes().catch(() => { })
    }

    if (count > 0 && typeof onStorageChanged === 'function') {
      try { onStorageChanged() } catch { }
    }

    if (count > 0) {
      console.log(`[ChunkStore:RPC] Deleted ${count}/${req.hashes.length} chunks (${(freedBytes / 1024 / 1024).toFixed(2)} MB) from local store via remote RPC request`)
    } else {
      console.log(`[ChunkStore:RPC] Verified ${req.hashes.length} chunk hashes (already purged or not stored on this node)`)
    }

    return { ok: true, count, freedBytes }
  })

  // 5. Retrieve public catalog strictly scoped to the requested network key
  rpc.respond('get-public-catalog', async (req: any) => {
    if (!publicCatalog) return { manifests: [] }
    const netKey = req?.networkKeyHex || (getNetworkKeyHex ? getNetworkKeyHex() : null)
    if (!netKey) return { manifests: [] }
    if (isNetworkJoined && !isNetworkJoined(netKey)) return { manifests: [] }
    const manifests = await publicCatalog.getPublicFiles(netKey)
    const matching = manifests.filter((m: any) => m && m.networkKeyHex === netKey)
    return { manifests: matching }
  })

  // 6. Announce public file strictly scoped and verified
  rpc.respond('announce-public-file', async (req: any) => {
    if (!req || !req.manifest || !req.manifest.networkKeyHex || !publicCatalog) return { ok: false }
    const netKey = req.manifest.networkKeyHex
    if (isNetworkJoined && !isNetworkJoined(netKey)) {
      console.warn(`[PublicCatalog:RPC] Ignored announcement for non-joined network ${netKey.slice(0, 12)}`)
      return { ok: false }
    }
    await publicCatalog.addPublicFile(netKey, req.manifest)
    console.log(`[PublicCatalog:RPC] Received public file announcement for ${req.manifest.path} on network ${netKey.slice(0, 12)}`)
    if (typeof onPublicCatalogUpdated === 'function') {
      onPublicCatalogUpdated(netKey)
    }
    return { ok: true }
  })

  // 7. Remove public file strictly scoped and verified
  rpc.respond('remove-public-file', async (req: any) => {
    if (!req || !req.path || !req.networkKeyHex || !publicCatalog) return { ok: false }
    const netKey = req.networkKeyHex
    if (isNetworkJoined && !isNetworkJoined(netKey)) {
      return { ok: false }
    }
    const manifest = await publicCatalog.getPublicManifest(netKey, req.path).catch(() => null)
    await publicCatalog.removePublicFile(netKey, req.path)

    let purgedChunks = 0
    let freedBytes = 0
    if (manifest?.chunks && Array.isArray(manifest.chunks)) {
      for (const c of manifest.chunks) {
        if (!c?.hash) continue
        const chunkPath = path.join(cacheDir, c.hash + '.bin')
        try {
          const st = await fs.promises.stat(chunkPath).catch(() => null)
          await fs.promises.chmod(chunkPath, 0o666).catch(() => { })
          await fs.promises.unlink(chunkPath)
          purgedChunks++
          if (st && typeof st.size === 'number') {
            freedBytes += st.size
            if (storageManager) storageManager.recordChunkRemoved(c.hash, st.size, netKey)
          }
        } catch { }
      }
      if (storageManager && purgedChunks > 0) {
        await storageManager.recalculateUsedBytes().catch(() => { })
      }
      if (purgedChunks > 0 && typeof onStorageChanged === 'function') {
        try { onStorageChanged() } catch { }
      }
    }

    console.log(
      `[PublicCatalog:RPC] Received public file removal for ${req.path} on network ${netKey.slice(0, 12)} (Purged ${purgedChunks} local chunk(s), ${(freedBytes / 1024 / 1024).toFixed(2)} MB)`
    )
    if (typeof onPublicCatalogUpdated === 'function') {
      onPublicCatalogUpdated(netKey)
    }
    return { ok: true, purgedChunks, freedBytes }
  })

  conn.on('close', () => {
    console.log(`[ChunkStore:Network] Swarm socket disconnected. Remaining peers: ${swarm.connections.size}`)
  })
}
