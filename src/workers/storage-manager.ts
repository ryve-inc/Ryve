import path from 'bare-path'
import fs from 'bare-fs'
import b4a from 'b4a'
import type { StorageInfo, NetworkStorageAllocation } from '../shared/types'
import type { NetworkStorageItem } from './blind'

export const DEFAULT_NETWORK_ALLOCATION_BYTES = 1 * 1024 * 1024 * 1024 // 1 GB default per network
export const MIN_SYSTEM_RESERVE_BYTES = 2 * 1024 * 1024 * 1024 // 2 GB minimum OS safety margin
const REGISTRY_FILE = 'drive-storage-registry.json'

export interface StorageManagerOptions {
  storageDir: string
  reservedSystemBytes?: number
}

interface ChunkMeta {
  size: number
  networkKeyHex: string
}

interface StorageRegistryData {
  chunks: Record<string, ChunkMeta>
  allocations: Record<string, number>
}

export class StorageManager {
  storageDir: string
  cacheDir: string
  reservedSystemBytes: number

  private _cachedFreeDisk: number = 50 * 1024 * 1024 * 1024 // Fallback 50 GB
  private _lastStatFsTime: number = 0

  /** Map of chunk hash -> { size, networkKeyHex } */
  private _chunks: Map<string, ChunkMeta> = new Map()

  /** Map of networkKeyHex or networkId -> allocatedBytes */
  private _allocations: Map<string, number> = new Map()

  /** Map of networkKeyHex or 'unassigned' -> usedBytes */
  private _networkUsedBytes: Map<string, number> = new Map()

  private _saveTimer: any = null

  constructor({
    storageDir,
    reservedSystemBytes = MIN_SYSTEM_RESERVE_BYTES
  }: StorageManagerOptions) {
    this.storageDir = storageDir
    this.cacheDir = path.join(storageDir, '.peer-cache')
    this.reservedSystemBytes = reservedSystemBytes
  }

  async init(initialNetworks?: NetworkStorageItem[]): Promise<void> {
    await fs.promises.mkdir(this.cacheDir, { recursive: true }).catch(() => {})
    await this._loadRegistry()
    if (initialNetworks && Array.isArray(initialNetworks)) {
      this.syncNetworks(initialNetworks)
    }
    await this.recalculateUsedBytes()
    await this.getFreeDiskBytes()
  }

  private async _loadRegistry(): Promise<void> {
    try {
      const regPath = path.join(this.storageDir, REGISTRY_FILE)
      const raw = await fs.promises.readFile(regPath)
      const data: StorageRegistryData = JSON.parse(b4a.toString(raw))
      if (data && typeof data === 'object') {
        if (data.chunks && typeof data.chunks === 'object') {
          for (const [hash, meta] of Object.entries(data.chunks)) {
            if (meta && typeof meta.size === 'number' && typeof meta.networkKeyHex === 'string') {
              this._chunks.set(hash, meta)
            }
          }
        }
        if (data.allocations && typeof data.allocations === 'object') {
          for (const [netKey, bytes] of Object.entries(data.allocations)) {
            if (typeof bytes === 'number' && bytes > 0) {
              this._allocations.set(netKey, bytes)
            }
          }
        }
      }
    } catch {
      // Clean startup
    }
  }

  private async _saveRegistryImmediate(): Promise<void> {
    try {
      const regPath = path.join(this.storageDir, REGISTRY_FILE)
      const chunksObj: Record<string, ChunkMeta> = {}
      for (const [h, m] of this._chunks.entries()) {
        chunksObj[h] = m
      }
      const allocObj: Record<string, number> = {}
      for (const [k, b] of this._allocations.entries()) {
        allocObj[k] = b
      }

      const payload = b4a.from(
        JSON.stringify({ chunks: chunksObj, allocations: allocObj }, null, 2)
      )
      const tmp = regPath + '.tmp-' + Math.random().toString(16).slice(2)
      await fs.promises.writeFile(tmp, payload)
      await fs.promises.rename(tmp, regPath)
    } catch (err) {
      console.warn('[StorageManager] Failed to persist registry:', err)
    }
  }

  private _scheduleSave(): void {
    if (this._saveTimer) return
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null
      this._saveRegistryImmediate().catch(() => {})
    }, 1000)
  }

  /**
   * Sync known network items and their configured allocations.
   */
  syncNetworks(networks: NetworkStorageItem[]): void {
    for (const net of networks) {
      const netAlloc =
        typeof net.allocatedBytes === 'number' && net.allocatedBytes > 0
          ? net.allocatedBytes
          : DEFAULT_NETWORK_ALLOCATION_BYTES

      // Map by both networkKeyHex and networkId for robust resolution
      if (net.networkKeyHex) {
        this._allocations.set(net.networkKeyHex, netAlloc)
      }
      if (net.id) {
        this._allocations.set(net.id, netAlloc)
      }
    }
    this._scheduleSave()
  }

  /**
   * Recalculate per-network chunk usage by inspecting files in `.peer-cache`
   * and cross-referencing with chunk registry.
   */
  async recalculateUsedBytes(): Promise<void> {
    this._networkUsedBytes.clear()
    try {
      const entries = await fs.promises.readdir(this.cacheDir)
      for (const entry of entries) {
        if (typeof entry === 'string' && entry.endsWith('.bin')) {
          const hash = entry.slice(0, -4)
          const chunkPath = path.join(this.cacheDir, entry)
          try {
            const st = await fs.promises.stat(chunkPath)
            if (st && typeof st.size === 'number') {
              const meta = this._chunks.get(hash)
              const netKey = meta?.networkKeyHex || 'unassigned'
              const current = this._networkUsedBytes.get(netKey) || 0
              this._networkUsedBytes.set(netKey, current + st.size)

              if (!meta) {
                this._chunks.set(hash, { size: st.size, networkKeyHex: 'unassigned' })
              } else if (meta.size !== st.size) {
                meta.size = st.size
              }
            }
          } catch {}
        }
      }
    } catch {}
  }

  /**
   * Query free host drive disk space (statfs) with 3s caching.
   */
  async getFreeDiskBytes(): Promise<number> {
    const now = Date.now()
    if (now - this._lastStatFsTime < 3000 && this._cachedFreeDisk > 0) {
      return this._cachedFreeDisk
    }

    try {
      if (typeof fs.promises.statfs === 'function') {
        const stats = await fs.promises.statfs(this.storageDir)
        if (stats && typeof stats.bavail === 'number' && typeof stats.bsize === 'number') {
          this._cachedFreeDisk = Math.max(0, stats.bavail * stats.bsize)
          this._lastStatFsTime = now
          return this._cachedFreeDisk
        }
      }
    } catch {}

    return this._cachedFreeDisk
  }

  getAllocatedBytesForNetwork(networkKeyOrId?: string | null): number {
    if (!networkKeyOrId) return DEFAULT_NETWORK_ALLOCATION_BYTES
    const alloc = this._allocations.get(networkKeyOrId)
    if (typeof alloc === 'number' && alloc > 0) return alloc
    return DEFAULT_NETWORK_ALLOCATION_BYTES
  }

  getTotalAllocatedBytes(networks: NetworkStorageItem[] = []): number {
    if (networks.length > 0) {
      let sum = 0
      for (const net of networks) {
        sum += this.getAllocatedBytesForNetwork(net.networkKeyHex || net.id)
      }
      return sum
    }
    let sum = 0
    for (const b of this._allocations.values()) {
      sum += b
    }
    return Math.max(DEFAULT_NETWORK_ALLOCATION_BYTES, sum)
  }

  getUsedBytesForNetwork(networkKeyOrId?: string | null): number {
    if (!networkKeyOrId) {
      let sum = 0
      for (const bytes of this._networkUsedBytes.values()) {
        sum += bytes
      }
      return sum
    }
    return this._networkUsedBytes.get(networkKeyOrId) || 0
  }

  async getAvailableBytesForNetwork(networkKeyOrId?: string | null): Promise<number> {
    const freeDisk = await this.getFreeDiskBytes()
    const diskHeadroom = Math.max(0, freeDisk - this.reservedSystemBytes)

    if (!networkKeyOrId) {
      return diskHeadroom
    }

    const netAllocated = this.getAllocatedBytesForNetwork(networkKeyOrId)
    const netUsed = this.getUsedBytesForNetwork(networkKeyOrId)
    const netHeadroom = Math.max(0, netAllocated - netUsed)

    return Math.min(netHeadroom, diskHeadroom)
  }

  /**
   * STRICT Per-Network Quota & Physical Disk Validation.
   * If Network 1 is full, it returns FALSE specifically for Network 1 chunks,
   * while Network 2 will still return TRUE if it has remaining space.
   */
  async canAccept(incomingBytes: number, networkKeyHex?: string | null): Promise<boolean> {
    if (incomingBytes <= 0) return true

    // 1. Check physical host drive headroom
    const freeDisk = await this.getFreeDiskBytes()
    const diskHeadroom = Math.max(0, freeDisk - this.reservedSystemBytes)
    if (incomingBytes > diskHeadroom) {
      return false
    }

    // 2. Check strict network quota if networkKeyHex is provided
    if (networkKeyHex) {
      const netAllocated = this.getAllocatedBytesForNetwork(networkKeyHex)
      const netUsed = this.getUsedBytesForNetwork(networkKeyHex)
      if (netUsed + incomingBytes > netAllocated) {
        return false // Strictly reject chunk for this network!
      }
    }

    return true
  }

  /**
   * Record newly stored chunk and attribute its size to the corresponding network.
   */
  recordChunkAdded(hash: string, bytes: number, networkKeyHex?: string | null): void {
    if (bytes <= 0 || !hash) return
    const key = networkKeyHex || 'unassigned'

    this._chunks.set(hash, { size: bytes, networkKeyHex: key })
    const current = this._networkUsedBytes.get(key) || 0
    this._networkUsedBytes.set(key, current + bytes)

    this._scheduleSave()
  }

  /**
   * Record removed/deleted chunk and decrement from its network's used bytes.
   */
  recordChunkRemoved(hash: string, bytes?: number, networkKeyHex?: string | null): void {
    if (!hash) return
    const meta = this._chunks.get(hash)
    const size = typeof bytes === 'number' && bytes > 0 ? bytes : meta?.size || 0
    const key = networkKeyHex || meta?.networkKeyHex || 'unassigned'

    this._chunks.delete(hash)
    const current = this._networkUsedBytes.get(key) || 0
    this._networkUsedBytes.set(key, Math.max(0, current - size))

    this._scheduleSave()
  }

  /**
   * Set storage allocation for a specific network with drive capacity boundary validation.
   */
  async setNetworkAllocation(
    networkId: string,
    allocatedBytes: number,
    allNetworks: NetworkStorageItem[]
  ): Promise<{ ok: boolean; allocatedBytes: number }> {
    const freeDisk = await this.getFreeDiskBytes()
    const maxDriveHeadroom = Math.max(0, freeDisk - this.reservedSystemBytes)

    // Calculate sum of other networks' allocations
    let otherAllocationsSum = 0
    for (const net of allNetworks) {
      if (net.id !== networkId) {
        otherAllocationsSum += net.allocatedBytes || DEFAULT_NETWORK_ALLOCATION_BYTES
      }
    }

    // Max possible allocation for this network = available disk headroom + current allocation
    const targetNet = allNetworks.find((n) => n.id === networkId)
    const currentNetAlloc = targetNet?.allocatedBytes || DEFAULT_NETWORK_ALLOCATION_BYTES
    const maxAllowed = Math.max(500 * 1024 * 1024, currentNetAlloc + Math.max(0, maxDriveHeadroom - otherAllocationsSum))

    const finalAllocated = Math.min(allocatedBytes, maxAllowed)

    this._allocations.set(networkId, finalAllocated)
    if (targetNet?.networkKeyHex) {
      this._allocations.set(targetNet.networkKeyHex, finalAllocated)
    }

    this._scheduleSave()
    return { ok: true, allocatedBytes: finalAllocated }
  }

  /**
   * Remove a network from storage registry when user leaves the network.
   */
  removeNetwork(networkId: string, networkKeyHex?: string | null): void {
    this._allocations.delete(networkId)
    if (networkKeyHex) {
      this._allocations.delete(networkKeyHex)
      this._networkUsedBytes.delete(networkKeyHex)
    }
    this._scheduleSave()
  }

  /**
   * Build complete StorageInfo object with per-network breakdown and total sum of storages.
   */
  getStorageInfoSync(networks: NetworkStorageItem[] = []): StorageInfo {
    const freeDisk = this._cachedFreeDisk
    const diskHeadroom = Math.max(0, freeDisk - this.reservedSystemBytes)

    let totalAllocatedBytes = 0
    let totalUsedBytes = 0
    const networkMap: Record<string, NetworkStorageAllocation> = {}

    for (const net of networks) {
      const netAlloc =
        this._allocations.get(net.networkKeyHex) ||
        this._allocations.get(net.id) ||
        net.allocatedBytes ||
        DEFAULT_NETWORK_ALLOCATION_BYTES

      const netUsed =
        this._networkUsedBytes.get(net.networkKeyHex) ||
        this._networkUsedBytes.get(net.id) ||
        0

      const available = Math.min(Math.max(0, netAlloc - netUsed), diskHeadroom)

      totalAllocatedBytes += netAlloc
      totalUsedBytes += netUsed

      networkMap[net.id] = {
        networkId: net.id,
        networkName: net.name,
        networkKeyHex: net.networkKeyHex,
        allocatedBytes: netAlloc,
        usedBytes: netUsed,
        availableBytes: available
      }
    }

    // Also count any unassigned chunk usage in totalUsedBytes
    const unassigned = this._networkUsedBytes.get('unassigned') || 0
    totalUsedBytes += unassigned

    const remainingDriveBytes = Math.max(0, diskHeadroom - totalAllocatedBytes)

    return {
      totalAllocatedBytes,
      totalUsedBytes,
      totalFreeDiskBytes: freeDisk,
      remainingDriveBytes,
      reservedSystemBytes: this.reservedSystemBytes,
      networks: networkMap
    }
  }

  async getStorageInfo(networks: NetworkStorageItem[] = []): Promise<StorageInfo> {
    await this.getFreeDiskBytes()
    return this.getStorageInfoSync(networks)
  }
}
