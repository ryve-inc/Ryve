import BlindPeering from 'blind-peering'
import path from 'bare-path'
import fs from 'bare-fs'
import b4a from 'b4a'
import idEnc from 'hypercore-id-encoding'

const SETTINGS_FILE = 'drive-settings.json'
const SESSION_FILE = 'drive-session.json'
const SHARES_INDEX_FILE = 'drive-shares.json'
const NETWORKS_FILE = 'drive-networks.json'

export const DEFAULT_NETWORK_QUOTA_BYTES = 1 * 1024 * 1024 * 1024 // 1 GB default per network

export type NetworkStorageItem = {
  id: string
  name: string
  networkLink: string
  networkKeyHex: string
  topicHex: string
  createdAt: number
  allocatedBytes?: number
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.promises.readFile(file)
    return JSON.parse(b4a.toString(raw)) as T
  } catch {
    return fallback
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.promises.mkdir(path.dirname(file), { recursive: true })
  const tmp = file + '.tmp-' + Math.random().toString(16).slice(2)
  const payload = b4a.from(JSON.stringify(value, null, 2))
  await fs.promises.writeFile(tmp, payload)
  await fs.promises.rename(tmp, file)
}

async function loadNetworks(storageDir: string): Promise<NetworkStorageItem[]> {
  const file = path.join(storageDir, NETWORKS_FILE)
  const list = await readJson<NetworkStorageItem[]>(file, [])
  if (!Array.isArray(list)) return []
  return list.map((item) => ({
    ...item,
    allocatedBytes:
      typeof item.allocatedBytes === 'number' && item.allocatedBytes > 0
        ? item.allocatedBytes
        : DEFAULT_NETWORK_QUOTA_BYTES
  }))
}

async function saveNetworks(storageDir: string, networks: NetworkStorageItem[]): Promise<void> {
  const file = path.join(storageDir, NETWORKS_FILE)
  await writeJson(file, networks)
}

async function loadSettings(storageDir: string): Promise<{
  file: string
  blindPeerKeys: string[]
  displayName?: string
  storageQuotaMode?: 'limited' | 'all'
  storageQuotaBytes?: number
}> {
  const file = path.join(storageDir, SETTINGS_FILE)
  const data = await readJson<{
    blindPeerKeys?: string[]
    displayName?: string
    storageQuotaMode?: 'limited' | 'all'
    storageQuotaBytes?: number
  }>(file, { blindPeerKeys: [] })
  return {
    file,
    blindPeerKeys: Array.isArray(data.blindPeerKeys) ? data.blindPeerKeys : [],
    displayName: data.displayName,
    storageQuotaMode: data.storageQuotaMode,
    storageQuotaBytes: data.storageQuotaBytes
  }
}

async function saveSettings(
  storageDir: string,
  settings: {
    blindPeerKeys?: string[]
    displayName?: string
    storageQuotaMode?: 'limited' | 'all'
    storageQuotaBytes?: number
  }
): Promise<void> {
  const file = path.join(storageDir, SETTINGS_FILE)
  await writeJson(file, {
    blindPeerKeys: settings.blindPeerKeys || [],
    displayName: settings.displayName,
    storageQuotaMode: settings.storageQuotaMode,
    storageQuotaBytes: settings.storageQuotaBytes
  })
}

async function loadSession(storageDir: string): Promise<any> {
  return readJson(path.join(storageDir, SESSION_FILE), null)
}

async function saveSession(storageDir: string, session: any): Promise<void> {
  await writeJson(path.join(storageDir, SESSION_FILE), session)
}

async function clearSession(storageDir: string): Promise<void> {
  try {
    await fs.promises.unlink(path.join(storageDir, SESSION_FILE))
  } catch {}
}

async function loadSharesIndex(storageDir: string): Promise<any[]> {
  const data = await readJson<{ shares?: any[] }>(path.join(storageDir, SHARES_INDEX_FILE), { shares: [] })
  return Array.isArray(data?.shares) ? data.shares : []
}

async function saveSharesIndex(storageDir: string, shares: any[]): Promise<void> {
  await writeJson(path.join(storageDir, SHARES_INDEX_FILE), { shares })
}

function normalizeBlindKeys(keys?: string[] | null): string[] {
  const out: string[] = []
  for (const raw of keys || []) {
    const k = String(raw || '').trim()
    if (!k) continue
    try {
      out.push(idEnc.normalize(k))
    } catch (err: any) {
      console.error('Ignoring invalid blind peer key:', k, err?.message || err)
    }
  }
  return [...new Set(out)]
}

function createBlindClient(swarm: any, store: any, keys?: string[]): any {
  const normalized = normalizeBlindKeys(keys)
  if (normalized.length === 0) return null
  if (!swarm || !swarm.dht || typeof swarm.dht.on !== 'function') {
    console.error('Blind peering skipped: Hyperswarm DHT unavailable')
    return null
  }
  try {
    return new BlindPeering(swarm, store.namespace('blind-peering'), {
      keys: normalized
    })
  } catch (err) {
    console.error('Blind peering init failed:', err)
    return null
  }
}

async function pinCore(blinds: any, core: any, opts = { announce: true }): Promise<void> {
  if (!blinds || !core) return
  try {
    await blinds.addCore(core, core.key, opts)
  } catch (err: any) {
    console.error('blind addCore failed:', err?.message || err)
  }
}

export {
  loadSettings,
  saveSettings,
  loadSession,
  saveSession,
  clearSession,
  loadSharesIndex,
  saveSharesIndex,
  loadNetworks,
  saveNetworks,
  createBlindClient,
  normalizeBlindKeys,
  pinCore
}

