import path from 'bare-path'
import fs from 'bare-fs'
import b4a from 'b4a'
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

  // 2. Fetch chunk with optional network verification
  rpc.respond('get-chunk', async (req: any) => {
    if (!req || !req.hash) throw new Error('Invalid request')
    if (req.networkKeyHex && isNetworkJoined && !isNetworkJoined(req.networkKeyHex)) {
      throw new Error(`Forbidden: Peer is not a member of network ${req.networkKeyHex.slice(0, 12)}`)
    }
    const chunkPath = path.join(cacheDir, req.hash + '.bin')
    try {
      const buf: any = await fs.promises.readFile(chunkPath)
      console.log(`[ChunkStore:Server] Serving chunk ${req.hash.slice(0, 12)} (${buf?.byteLength || 0} bytes)`)
      return { hash: req.hash, data: b4a.toString(buf, 'hex') }
    } catch (err) {
      throw new Error(`Chunk ${req.hash.slice(0, 12)} not found in local cache`)
    }
  })

  // 3. Store chunk with strict network membership validation
  rpc.respond('store-chunk', async (req: any) => {
    if (!req || !req.hash || !req.data) throw new Error('Invalid store chunk payload')
    if (req.networkKeyHex && isNetworkJoined && !isNetworkJoined(req.networkKeyHex)) {
      throw new Error(`Forbidden: Receiver is not a member of network ${req.networkKeyHex.slice(0, 12)}`)
    }
    const chunkPath = path.join(cacheDir, req.hash + '.bin')
    const buf = b4a.from(req.data, 'hex')
    await fs.promises.writeFile(chunkPath, buf)
    console.log(`[ChunkStore:Cache] Stored chunk ${req.hash.slice(0, 12)} (${buf.byteLength} bytes) for network ${req.networkKeyHex ? req.networkKeyHex.slice(0, 12) : 'direct'}`)
    return { ok: true, hash: req.hash }
  })

  // 4. Retrieve public catalog strictly scoped to the requested network key
  rpc.respond('get-public-catalog', async (req: any) => {
    if (!publicCatalog) return { manifests: [] }
    const netKey = req?.networkKeyHex || (getNetworkKeyHex ? getNetworkKeyHex() : null)
    if (!netKey) return { manifests: [] }
    if (isNetworkJoined && !isNetworkJoined(netKey)) return { manifests: [] }
    const manifests = await publicCatalog.getPublicFiles(netKey)
    const matching = manifests.filter((m: any) => m && m.networkKeyHex === netKey)
    return { manifests: matching }
  })

  // 5. Announce public file strictly scoped and verified
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

  conn.on('close', () => {
    console.log(`[ChunkStore:Network] Swarm socket disconnected. Remaining peers: ${swarm.connections.size}`)
  })
}
