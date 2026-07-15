// @ts-nocheck
import BlindPeering from 'blind-peering'
import path from 'bare-path'
import fs from 'bare-fs'
import b4a from 'b4a'
import idEnc from 'hypercore-id-encoding'

const SETTINGS_FILE = 'drive-settings.json'
const SESSION_FILE = 'drive-session.json'
const SHARES_INDEX_FILE = 'drive-shares.json'

async function readJson(file, fallback = null) {
  try {
    const raw = await fs.promises.readFile(file)
    return JSON.parse(b4a.toString(raw))
  } catch {
    return fallback
  }
}

async function writeJson(file, value) {
  await fs.promises.mkdir(path.dirname(file), { recursive: true })
  const tmp = file + '.tmp-' + Math.random().toString(16).slice(2)
  const payload = b4a.from(JSON.stringify(value, null, 2))
  await fs.promises.writeFile(tmp, payload)
  await fs.promises.rename(tmp, file)
}

async function loadSettings(storageDir) {
  const file = path.join(storageDir, SETTINGS_FILE)
  const data = await readJson(file, { blindPeerKeys: [] })
  return { file, blindPeerKeys: Array.isArray(data.blindPeerKeys) ? data.blindPeerKeys : [] }
}

async function saveSettings(storageDir, settings) {
  const file = path.join(storageDir, SETTINGS_FILE)
  await writeJson(file, { blindPeerKeys: settings.blindPeerKeys || [] })
}

async function loadSession(storageDir) {
  return readJson(path.join(storageDir, SESSION_FILE), null)
}

async function saveSession(storageDir, session) {
  await writeJson(path.join(storageDir, SESSION_FILE), session)
}

async function clearSession(storageDir) {
  try {
    await fs.promises.unlink(path.join(storageDir, SESSION_FILE))
  } catch {}
}

async function loadSharesIndex(storageDir) {
  const data = await readJson(path.join(storageDir, SHARES_INDEX_FILE), { shares: [] })
  return Array.isArray(data?.shares) ? data.shares : []
}

async function saveSharesIndex(storageDir, shares) {
  await writeJson(path.join(storageDir, SHARES_INDEX_FILE), { shares })
}

function normalizeBlindKeys(keys) {
  const out = []
  for (const raw of keys || []) {
    const k = String(raw || '').trim()
    if (!k) continue
    try {
      out.push(idEnc.normalize(k))
    } catch (err) {
      console.error('Ignoring invalid blind peer key:', k, err?.message || err)
    }
  }
  return [...new Set(out)]
}

function createBlindClient(swarm, store, keys) {
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

/** BlindPeering.addCore(core, target = core.key, opts) — options must be 3rd arg */
async function pinCore(blinds, core, opts = { announce: true }) {
  if (!blinds || !core) return
  try {
    await blinds.addCore(core, core.key, opts)
  } catch (err) {
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
  createBlindClient,
  normalizeBlindKeys,
  pinCore
}
