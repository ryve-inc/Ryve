// @ts-nocheck
import b4a from 'b4a'
import hypercoreCrypto from 'hypercore-crypto'

const GLOBAL_POOL_TOPIC_STRING = 'p2cloud:global-pool-v1'

class GlobalPeerPool {
  constructor({ swarm }) {
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

  registerStore(store) {
    if (!store) return
    this.registeredStores.add(store)
    console.log('[GlobalPeerPool] Registered store. Active connections:', this.swarm.connections.size)

    // Replicate this store to all currently active connections
    for (const conn of this.swarm.connections) {
      try {
        store.replicate(conn)
      } catch (err) {
        console.error('[GlobalPeerPool] Store replication error:', err?.message || err)
      }
    }
  }

  unregisterStore(store) {
    if (!store) return
    this.registeredStores.delete(store)
  }

  _onConnection(conn) {
    // Only replicate explicitly registered vault/share stores
    for (const store of this.registeredStores) {
      try {
        store.replicate(conn)
      } catch (err) {
        console.error('[GlobalPeerPool] Replication error on new connection:', err?.message || err)
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
