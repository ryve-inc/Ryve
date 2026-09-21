import b4a from 'b4a'
import type { State } from './state'
import { activeNetworkPeers, statusPayload } from './state'
import { deriveNetworkKeys } from './identity'

/**
 * Resolve which networkIds a connection belongs to by matching
 * peerInfo.topics against our stored swarmTopic buffers.
 */
export function resolveNetworkIds(state: State, peerInfo: any): string[] {
  if (!peerInfo?.topics || !Array.isArray(peerInfo.topics) || peerInfo.topics.length === 0) {
    return state.activeNetworkId ? [state.activeNetworkId] : []
  }
  const matched: string[] = []
  const peerTopicHexes = peerInfo.topics.map((t: any) =>
    typeof t === 'string' ? t : b4a.toString(t, 'hex')
  )

  for (const [netId, handles] of state.joinedTopics) {
    if (handles.topicHex && peerTopicHexes.includes(handles.topicHex)) {
      matched.push(netId)
    } else {
      for (const topic of peerInfo.topics) {
        if (b4a.equals(topic, handles.swarmTopic)) {
          matched.push(netId)
          break
        }
      }
    }
  }
  return matched.length > 0 ? matched : (state.activeNetworkId ? [state.activeNetworkId] : [])
}

/**
 * Join a single network's Hyperswarm topics WITHOUT destroying existing ones
 */
export async function joinNetworkTopics(
  state: State,
  swarm: any,
  networkId: string,
  swarmTopic: Uint8Array,
  swarmChunkTopic: Uint8Array
) {
  if (state.joinedTopics.has(networkId)) return

  const networkDiscovery = swarm.join(swarmTopic, { server: true, client: true })
  await networkDiscovery.flushed().catch(() => { })

  const chunkDiscovery = swarm.join(swarmChunkTopic, { server: true, client: true })
  await chunkDiscovery.flushed().catch(() => { })

  if (state.chunkStore) {
    await state.chunkStore.joinNetwork(networkId, swarmChunkTopic)
  }

  const topicHex = b4a.toString(swarmTopic, 'hex')
  state.joinedTopics.set(networkId, { networkDiscovery, chunkDiscovery, swarmTopic, topicHex })
  console.log(`[P2PNetwork] Joined network ${networkId} swarm topics (total joined: ${state.joinedTopics.size})`)
}

/**
 * Leave ALL network topics (logout / app exit)
 */
export async function leaveAllNetworkTopics(state: State) {
  for (const [netId, handles] of state.joinedTopics) {
    await handles.networkDiscovery.destroy().catch(() => { })
    await handles.chunkDiscovery.destroy().catch(() => { })
    console.log(`[P2PNetwork] Left network ${netId} swarm topics`)
  }
  state.joinedTopics.clear()
  if (state.chunkStore) {
    await state.chunkStore.leaveAllNetworks()
  }
}

/**
 * Join ALL previously saved networks' swarm topics (called after unlock)
 */
export async function joinAllSavedNetworks(state: State, swarm: any) {
  for (const net of state.networks) {
    if (state.joinedTopics.has(net.id)) continue
    try {
      const derived = deriveNetworkKeys(net.networkKeyHex, net.name)
      await joinNetworkTopics(state, swarm, net.id, derived.swarmTopic, derived.swarmChunkTopic)
    } catch (err) {
      console.error(`[P2PNetwork] Failed to join saved network ${net.name} (${net.id}):`, err)
    }
  }
}

/**
 * Setup main Hyperswarm connection listener and peer tracking.
 */
export function setupSwarmListeners(
  swarm: any,
  state: State,
  emit: (msg: unknown) => void
) {
  swarm.on('connection', (conn: any, peerInfo: any) => {
    activeNetworkPeers.add(conn)
    state.peerCount = activeNetworkPeers.size

    // Track which networks this connection belongs to
    const netIds = resolveNetworkIds(state, peerInfo)
    ;(conn as any)._networkIds = netIds
    if (!(conn as any)._networkKeyHexes) {
      (conn as any)._networkKeyHexes = new Set<string>()
    }
    for (const netId of netIds) {
      const net = state.networks.find((n) => n.id === netId)
      if (net) {
        (conn as any)._networkKeyHexes.add(net.networkKeyHex)
      }
      state.networkPeerCounts.set(netId, (state.networkPeerCounts.get(netId) || 0) + 1)
    }

    console.log(`[Network:Swarm] Peer connected on networks [${netIds.join(', ')}]. Total peers: ${state.peerCount}`)
    emit({ type: 'event', name: 'status', data: statusPayload(state) })

    conn.on('close', () => {
      activeNetworkPeers.delete(conn)
      state.peerCount = activeNetworkPeers.size
      const connNetIds: string[] = (conn as any)._networkIds || []
      for (const netId of connNetIds) {
        const cur = state.networkPeerCounts.get(netId) || 0
        if (cur > 1) state.networkPeerCounts.set(netId, cur - 1)
        else state.networkPeerCounts.delete(netId)
      }
      console.log(`[Network:Swarm] Peer disconnected. Remaining peers: ${state.peerCount}`)
      emit({ type: 'event', name: 'status', data: statusPayload(state) })
    })

    if (state.vaultStore) state.vaultStore.replicate(conn)
  })
}
