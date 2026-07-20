// @ts-nocheck
import hypercoreCrypto from 'hypercore-crypto'

const GLOBAL_POOL_TOPIC_STRING = 'p2cloud:global-pool-v1'

class GlobalPeerPool {
  constructor({ swarm, store }) {
    this.swarm = swarm
    this.store = store
    this.topic = hypercoreCrypto.hash(Buffer.from(GLOBAL_POOL_TOPIC_STRING))
    this.discovery = null
    this.registeredStores = new Set()
    this._onConnection = this._onConnection.bind(this)
  }

  async init() {
    if (this.discovery) return

    // Replicate corestores on incoming connections
    this.swarm.on('connection', this._onConnection)

    // Replicate all already connected sockets
    for (const conn of this.swarm.connections) {
      this._replicateStoreToConn(conn)
    }

    // Join the global storage pool topic as both client and server
    this.discovery = this.swarm.join(this.topic, {
      server: true,
      client: true
    })

    await this.discovery.flushed()
    console.log('[GlobalPeerPool] Joined global storage network pool on topic:', GLOBAL_POOL_TOPIC_STRING)
  }

  registerStore(store) {
    if (!store) return
    this.registeredStores.add(store)

    // Replicate this store to all active connections
    for (const conn of this.swarm.connections) {
      store.replicate(conn)
    }
  }

  unregisterStore(store) {
    if (!store) return
    this.registeredStores.delete(store)
  }

  _onConnection(conn) {
    this._replicateStoreToConn(conn)
  }

  _replicateStoreToConn(conn) {
    // Replicate general store
    if (this.store) {
      try {
        this.store.replicate(conn)
      } catch (err) {
        console.error('[GlobalPeerPool] Store replication error:', err?.message || err)
      }
    }

    // Replicate all registered vault & share stores
    for (const store of this.registeredStores) {
      try {
        store.replicate(conn)
      } catch (err) {
        console.error('[GlobalPeerPool] Registered store replication error:', err?.message || err)
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
