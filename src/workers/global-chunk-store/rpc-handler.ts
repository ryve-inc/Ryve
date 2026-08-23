import path from 'bare-path'
import fs from 'bare-fs'
import b4a from 'b4a'
import ProtomuxRPC from 'protomux-rpc'
import c from 'compact-encoding'

export function setupConnectionRpc(conn: any, swarm: any, cacheDir: string) {
  if (conn._chunkRpc) return

  console.log(`[ChunkStore:Network] Swarm socket connected. Active peers: ${swarm.connections.size}`)

  const rpc = new ProtomuxRPC(conn, {
    protocol: 'p2cloud-chunk-store-v1',
    valueEncoding: c.json
  })

  conn._chunkRpc = rpc

  rpc.respond('get-chunk', async (req: any) => {
    if (!req || !req.hash) throw new Error('Invalid request')
    const chunkPath = path.join(cacheDir, req.hash + '.bin')
    try {
      const buf: any = await fs.promises.readFile(chunkPath)
      console.log(`[ChunkStore:Server] Serving chunk ${req.hash.slice(0, 12)} (${buf?.byteLength || 0} bytes)`)
      return { hash: req.hash, data: b4a.toString(buf, 'hex') }
    } catch (err) {
      throw new Error(`Chunk ${req.hash.slice(0, 12)} not found in local cache`)
    }
  })

  rpc.respond('store-chunk', async (req: any) => {
    if (!req || !req.hash || !req.data) throw new Error('Invalid store chunk payload')
    const chunkPath = path.join(cacheDir, req.hash + '.bin')
    const buf = b4a.from(req.data, 'hex')
    await fs.promises.writeFile(chunkPath, buf)
    console.log(`[ChunkStore:Cache] Stored chunk ${req.hash.slice(0, 12)} (${buf.byteLength} bytes) from remote peer`)
    return { ok: true, hash: req.hash }
  })

  conn.on('close', () => {
    console.log(`[ChunkStore:Network] Swarm socket disconnected. Remaining peers: ${swarm.connections.size}`)
  })
}
