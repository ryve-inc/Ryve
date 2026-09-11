import path from 'bare-path'
import fs from 'bare-fs'
import type { StorageInfo, StorageQuotaMode } from '../shared/types'

export const DEFAULT_QUOTA_BYTES = 10 * 1024 * 1024 * 1024 // 10 GB
export const MIN_SYSTEM_RESERVE_BYTES = 2 * 1024 * 1024 * 1024 // 2 GB minimum OS safety margin

export interface StorageManagerOptions {
  storageDir: string
  initialQuotaMode?: StorageQuotaMode
  initialQuotaBytes?: number
  reservedSystemBytes?: number
}

export class StorageManager {
  storageDir: string
  cacheDir: string
  quotaMode: StorageQuotaMode
  quotaBytes: number
  usedBytes: number
  reservedSystemBytes: number
  private _cachedFreeDisk: number = 50 * 1024 * 1024 * 1024 // Fallback 50 GB
  private _lastStatFsTime: number = 0

  constructor({
    storageDir,
    initialQuotaMode = 'limited',
    initialQuotaBytes = DEFAULT_QUOTA_BYTES,
    reservedSystemBytes = MIN_SYSTEM_RESERVE_BYTES
  }: StorageManagerOptions) {
    this.storageDir = storageDir
    this.cacheDir = path.join(storageDir, '.peer-cache')
    this.quotaMode = initialQuotaMode
    this.quotaBytes = initialQuotaBytes
    this.usedBytes = 0
    this.reservedSystemBytes = reservedSystemBytes
  }

  async init(): Promise<void> {
    await fs.promises.mkdir(this.cacheDir, { recursive: true }).catch(() => {})
    await this._calculateInitialUsedBytes()
    await this.getFreeDiskBytes()
  }

  private async _calculateInitialUsedBytes(): Promise<void> {
    try {
      const entries = await fs.promises.readdir(this.cacheDir)
      let total = 0
      for (const entry of entries) {
        if (typeof entry === 'string' && entry.endsWith('.bin')) {
          try {
            const st = await fs.promises.stat(path.join(this.cacheDir, entry))
            if (st && typeof st.size === 'number') {
              total += st.size
            }
          } catch {}
        }
      }
      this.usedBytes = total
    } catch {
      this.usedBytes = 0
    }
  }

  async recalculateUsedBytes(): Promise<number> {
    await this._calculateInitialUsedBytes()
    return this.usedBytes
  }

  async getFreeDiskBytes(): Promise<number> {
    const now = Date.now()
    // Cache statfs for 3 seconds to avoid spamming system syscalls under heavy chunk RPC
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

  async getAvailableBytes(): Promise<number> {
    const freeDisk = await this.getFreeDiskBytes()
    const diskHeadroom = Math.max(0, freeDisk - this.reservedSystemBytes)

    if (this.quotaMode === 'all') {
      return diskHeadroom
    }

    const quotaHeadroom = Math.max(0, this.quotaBytes - this.usedBytes)
    return Math.min(quotaHeadroom, diskHeadroom)
  }

  async canAccept(incomingBytes: number): Promise<boolean> {
    if (incomingBytes <= 0) return true
    const available = await this.getAvailableBytes()
    return incomingBytes <= available
  }

  recordChunkAdded(bytes: number): void {
    if (bytes > 0) {
      this.usedBytes += bytes
    }
  }

  recordChunkRemoved(bytes: number): void {
    if (bytes > 0) {
      this.usedBytes = Math.max(0, this.usedBytes - bytes)
    }
  }

  async setQuota(mode: StorageQuotaMode, quotaBytes?: number): Promise<void> {
    this.quotaMode = mode
    if (typeof quotaBytes === 'number' && quotaBytes > 0) {
      this.quotaBytes = quotaBytes
    }
  }

  getStorageInfoSync(): StorageInfo {
    const freeDisk = this._cachedFreeDisk
    const diskHeadroom = Math.max(0, freeDisk - this.reservedSystemBytes)
    let available: number
    if (this.quotaMode === 'all') {
      available = diskHeadroom
    } else {
      const quotaHeadroom = Math.max(0, this.quotaBytes - this.usedBytes)
      available = Math.min(quotaHeadroom, diskHeadroom)
    }

    return {
      quotaMode: this.quotaMode,
      quotaBytes: this.quotaBytes,
      usedBytes: this.usedBytes,
      availableBytes: available,
      freeDiskBytes: freeDisk
    }
  }

  async getStorageInfo(): Promise<StorageInfo> {
    const freeDisk = await this.getFreeDiskBytes()
    const available = await this.getAvailableBytes()

    return {
      quotaMode: this.quotaMode,
      quotaBytes: this.quotaBytes,
      usedBytes: this.usedBytes,
      availableBytes: available,
      freeDiskBytes: freeDisk
    }
  }
}
