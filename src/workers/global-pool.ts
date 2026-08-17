import b4a from 'b4a'
import hypercoreCrypto from 'hypercore-crypto'

class GlobalPeerPool {
  swarm: any
  topic: Uint8Array | null
  discovery: any
  registeredStores: Set<any>

  constructor({ swarm, topic = null }: { swarm: any; topic?: Uint8Array | null }) {
    this.swarm = swarm
    this.topic = topic
    this.discovery = null
    this.registeredStores = new Set()
    this._onConnection = this._onConnection.bind(this)
  }

  async init(topic?: Uint8Array) {
    if (topic) this.topic = topic
    if (!this.topic || this.discovery) return

    // Listen for new connections to replicate registered stores
    this.swarm.on('connection', this._onConnection)

    this.discovery = this.swarm.join(this.topic, {
      server: true,
      client: true
    })

    await this.discovery.flushed().catch(() => {})
    console.log('[GlobalPeerPool] Joined private storage network pool')
  }

  registerStore(store: any) {
    if (!store) return
    this.registeredStores.add(store)
    console.log('[GlobalPeerPool] Registered store. Active connections:', this.swarm.connections.size)

    // Replicate this store to all currently active connections
    for (const conn of this.swarm.connections) {
      try {
        store.replicate(conn)
      } catch (err: any) {
        console.error('[GlobalPeerPool] Store replication error:', err?.message || err)
      }
    }
  }

  unregisterStore(store: any) {
    if (!store) return
    this.registeredStores.delete(store)
  }

  _onConnection(conn: any) {
    console.log(`[GlobalPeerPool] New peer connected! Active connections: ${this.swarm.connections.size}`)

    conn.on('close', () => {
      console.log(`[GlobalPeerPool] Peer disconnected. Active connections: ${this.swarm.connections.size}`)
    })

    // Replicate explicitly registered vault/share stores on new connection
    this.replicateAllStores(conn)
  }

  replicateAllStores(conn: any) {
    for (const store of this.registeredStores) {
      try {
        store.replicate(conn)
      } catch (err: any) {
        console.error('[GlobalPeerPool] Replication error:', err?.message || err)
      }
    }
  }

  async close() {
    this.swarm.off('connection', this._onConnection)
    if (this.discovery) {
      await this.discovery.destroy().catch(() => {})
      this.discovery = null
    }
    this.registeredStores.clear()
  }
}

export { GlobalPeerPool }

