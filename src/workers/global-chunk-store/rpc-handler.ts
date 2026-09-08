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
  isNetworkJoined?: (networkKeyHex: string) => boolean
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

  // 1. Handshake to exchange joined network keys between peers
  rpc.respond('handshake', async (req: any) => {
    const peerKeys: string[] = Array.isArray(req?.networkKeyHexes) ? req.networkKeyHexes : []
    for (const k of peerKeys) {
      if (typeof k === 'string' && k.length > 0) conn._networkKeyHexes.add(k)
    }
    const myKeys = getJoinedNetworkKeys ? getJoinedNetworkKeys() : []
    return { ok: true, networkKeyHexes: myKeys }
  })

  // Send immediate handshake to the remote peer
  const initiateHandshake = async () => {
    try {
      const myKeys = getJoinedNetworkKeys ? getJoinedNetworkKeys() : []
      const res = await rpc.request('handshake', { networkKeyHexes: myKeys }, { timeout: 5000 })
      if (res && Array.isArray(res.networkKeyHexes)) {
        for (const k of res.networkKeyHexes) {
          if (typeof k === 'string' && k.length > 0) conn._networkKeyHexes.add(k)
        }
      }
    } catch {}
  }
  initiateHandshake().catch(() => {})

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
        await fs.promises.chmod(chunkPath, 0o666).catch(() => {})
        await fs.promises.unlink(chunkPath).catch(() => {})
        throw new Error(`Chunk ${req.hash.slice(0, 12)} corrupted in local storage`)
      }
      console.log(`[ChunkStore:Server] Serving chunk ${req.hash.slice(0, 12)} (${buf?.byteLength || 0} bytes)`)
      return { hash: req.hash, data: b4a.toString(buf, 'hex') }
    } catch (err: any) {
      if (err?.message?.includes('corrupted')) throw err
      throw new Error(`Chunk ${req.hash.slice(0, 12)} not found in local cache`)
    }
  })

  // 3. Store chunk with strict network membership & integrity validation + read-only locking
  rpc.respond('store-chunk', async (req: any) => {
    if (!req || !req.hash || !req.data) throw new Error('Invalid store chunk payload')
    if (req.networkKeyHex && isNetworkJoined && !isNetworkJoined(req.networkKeyHex)) {
      throw new Error(`Forbidden: Receiver is not a member of network ${req.networkKeyHex.slice(0, 12)}`)
    }
    const chunkPath = path.join(cacheDir, req.hash + '.bin')
    const buf = b4a.from(req.data, 'hex')
    const actualHash = b4a.toString(hypercoreCrypto.hash(buf), 'hex')
    if (actualHash !== req.hash) {
      throw new Error(`Integrity check failed: Incoming chunk data hash mismatch`)
    }
    await fs.promises.writeFile(chunkPath, buf)
    await fs.promises.chmod(chunkPath, 0o444).catch(() => {})
    console.log(`[ChunkStore:Cache] Stored chunk ${req.hash.slice(0, 12)} (${buf.byteLength} bytes, Read-Only) for network ${req.networkKeyHex ? req.networkKeyHex.slice(0, 12) : 'direct'}`)
    return { ok: true, hash: req.hash }
  })

  // 4. Remote peer chunk deletion request
  rpc.respond('delete-chunks', async (req: any) => {
    if (!req || !Array.isArray(req.hashes)) throw new Error('Invalid delete chunks request')
    if (req.networkKeyHex && isNetworkJoined && !isNetworkJoined(req.networkKeyHex)) {
      throw new Error(`Forbidden: Requester is not a member of network ${req.networkKeyHex.slice(0, 12)}`)
    }
    let count = 0
    for (const hash of req.hashes) {
      if (!hash || typeof hash !== 'string') continue
      const chunkPath = path.join(cacheDir, hash + '.bin')
      try {
        await fs.promises.chmod(chunkPath, 0o666).catch(() => {})
        await fs.promises.unlink(chunkPath)
        count++
      } catch {}
    }
    console.log(`[ChunkStore:RPC] Deleted ${count}/${req.hashes.length} chunks from local store via remote RPC request`)
    return { ok: true, count }
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
    await publicCatalog.removePublicFile(netKey, req.path)
    console.log(`[PublicCatalog:RPC] Received public file removal for ${req.path} on network ${netKey.slice(0, 12)}`)
    if (typeof onPublicCatalogUpdated === 'function') {
      onPublicCatalogUpdated(netKey)
    }
    return { ok: true }
  })

  conn.on('close', () => {
    console.log(`[ChunkStore:Network] Swarm socket disconnected. Remaining peers: ${swarm.connections.size}`)
  })
}


