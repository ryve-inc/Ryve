import BlindPeering from 'blind-peering'
import idEnc from 'hypercore-id-encoding'
import type Hyperswarm from 'hyperswarm'
import type Corestore from 'corestore'

export type BlindClient = BlindPeering

export function normalizeBlindKeys(keys: unknown): string[] {
  const out: string[] = []
  if (!Array.isArray(keys)) return out
  for (const raw of keys) {
    const k = String(raw || '').trim()
    if (!k) continue
    try {
      out.push(idEnc.normalize(k))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('Ignoring invalid blind peer key:', k, message)
    }
  }
  return [...new Set(out)]
}

export function createBlindClient(
  swarm: Hyperswarm,
  store: Corestore,
  keys: unknown
): BlindClient | null {
  const normalized = normalizeBlindKeys(keys)
  if (normalized.length === 0) return null
  if (!swarm.dht || typeof swarm.dht.on !== 'function') {
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

export async function pinCore(
  blinds: BlindClient | null,
  core: { key: Uint8Array } | null | undefined,
  opts: { announce?: boolean } = { announce: true }
): Promise<void> {
  if (!blinds || !core) return
  try {
    await blinds.addCore(core, core.key, opts)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('blind addCore failed:', message)
  }
}
