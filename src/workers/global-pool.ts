import b4a from 'b4a'
import hypercoreCrypto from 'hypercore-crypto'

const GLOBAL_POOL_TOPIC_STRING = 'p2cloud:global-pool-v1'

class GlobalPeerPool {
  swarm: any
  topic: Uint8Array
  discovery: any
  registeredStores: Set<any>

  constructor({ swarm }: { swarm: any }) {
    this.swarm = swarm
    this.topic = hypercoreCrypto.hash(b4a.from(GLOBAL_POOL_TOPIC_STRING))
    this.discovery = null
    this.registeredStores = new Set()
    this._onConnection = this._onConnection.bind(this)
  }

  async init() {
    if (this.discovery) return

    // Listen for new connections to replicate registered stores
    this.swarm.on('connection', this._onConnection)

    // Join the global storage pool topic as both client and server
    this.discovery = this.swarm.join(this.topic, {
      server: true,
      client: true
    })

    await this.discovery.flushed()
    console.log('[GlobalPeerPool] Joined global storage network pool')
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

