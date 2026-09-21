import path from 'bare-path'
import type { VaultDrive } from './vault-drive'
import type { GlobalChunkStore } from './global-chunk-store'
import type { StorageManager } from './storage-manager'
import type { NetworkStorageItem } from './blind'

export interface State {
  unlocked: boolean
  primaryKey: Uint8Array | null
  encryptionKey: Uint8Array | null
  identityHex: string | null
  displayName: string | null
  /** The currently ACTIVE network (UI view). Other networks stay connected. */
  networkKeyHex: string | null
  networkLink: string | null
  topicHex: string | null
  /** Map of networkId → { networkDiscovery, chunkDiscovery, swarmTopic } for ALL joined networks */
  joinedTopics: Map<string, { networkDiscovery: any; chunkDiscovery: any; swarmTopic: Uint8Array; topicHex: string }>
  /** Per-network peer counts tracked via peerInfo.topics */
  networkPeerCounts: Map<string, number>
  vaultStore: any
  vault: VaultDrive | null
  chunkStore: GlobalChunkStore | null
  storageManager: StorageManager | null
  blinds: any
  settings: {
    blindPeerKeys: string[]
    displayName?: string
    storageQuotaMode?: 'limited' | 'all'
    storageQuotaBytes?: number
  }
  peerCount: number
  networks: NetworkStorageItem[]
  activeNetworkId: string | null
}

export const activeNetworkPeers = new Set<any>()

export function createState(): State {
  return {
    unlocked: false,
    primaryKey: null,
    encryptionKey: null,
    identityHex: null,
    displayName: null,
    networkKeyHex: null,
    networkLink: null,
    topicHex: null,
    joinedTopics: new Map(),
    networkPeerCounts: new Map(),
    vaultStore: null,
    vault: null,
    chunkStore: null,
    storageManager: null,
    blinds: null,
    settings: { blindPeerKeys: [] },
    peerCount: 0,
    networks: [],
    activeNetworkId: null
  }
}

export function vaultPathFor(storageDir: string, identityHex: string) {
  return path.join(storageDir, 'vaults', identityHex)
}

export function statusPayload(state: State) {
  const currentNetwork = state.networks.find((n) => n.id === state.activeNetworkId) || state.networks[0] || null
  const storageInfo = state.storageManager
    ? state.storageManager.getStorageInfoSync(state.networks)
    : {
        totalAllocatedBytes: 0,
        totalUsedBytes: 0,
        totalFreeDiskBytes: 0,
        remainingDriveBytes: 0,
        reservedSystemBytes: 0,
        networks: {}
      }

  const networkItems = state.networks.map((n) => {
    const alloc = storageInfo.networks[n.id]
    const myAllocatedBytes = alloc?.allocatedBytes || n.allocatedBytes || 1073741824
    const myUsedBytes = alloc?.usedBytes || 0

    // Sum storage contributions from all active online peers connected on this network
    const networkPeers = state.chunkStore ? state.chunkStore.getPeersForNetwork(n.networkKeyHex) : []
    let peersAllocatedBytes = 0
    let peersUsedBytes = 0

    for (const conn of networkPeers) {
      const pAlloc = (conn as any)._allocatedStorageByNetwork?.get(n.networkKeyHex) ?? 1073741824
      const pUsed = (conn as any)._usedStorageByNetwork?.get(n.networkKeyHex) ?? 0
      peersAllocatedBytes += pAlloc
      peersUsedBytes += pUsed
    }

    const networkTotalAllocatedBytes = myAllocatedBytes + peersAllocatedBytes
    const networkTotalUsedBytes = myUsedBytes + peersUsedBytes

    return {
      id: n.id,
      name: n.name,
      networkLink: n.networkLink,
      networkKeyHex: n.networkKeyHex,
      topicHex: n.topicHex,
      peers: state.networkPeerCounts.get(n.id) || 0,
      createdAt: n.createdAt,
      allocatedBytes: myAllocatedBytes,
      usedBytes: myUsedBytes,
      networkTotalAllocatedBytes,
      networkTotalUsedBytes
    }
  })

  const activePeers = currentNetwork ? (state.networkPeerCounts.get(currentNetwork.id) || 0) : 0

  return {
    unlocked: state.unlocked,
    identity: state.identityHex,
    displayName: state.displayName || state.settings.displayName || null,
    driveKey: state.vault?.keyHex || null,
    peers: activePeers,
    blindPeerKeys: state.settings.blindPeerKeys || [],
    network: {
      networkLink: currentNetwork?.networkLink || state.networkLink,
      networkKeyHex: currentNetwork?.networkKeyHex || state.networkKeyHex,
      topicHex: currentNetwork?.topicHex || state.topicHex,
      joined: state.networks.length > 0 || !!state.networkKeyHex,
      activeId: state.activeNetworkId || currentNetwork?.id || null,
      networks: networkItems
    },
    storage: storageInfo
  }
}
