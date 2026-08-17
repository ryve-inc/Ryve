import path from 'bare-path'
import * as fs from 'bare-fs'
import * as b4a from 'b4a'
import hypercoreCrypto from 'hypercore-crypto'
import { asBytes } from './as-bytes'
import sodium from 'sodium-universal'

const SETTINGS_FILE = 'drive-settings.json'
const SESSION_FILE = 'drive-session.json'
const SESSION_WRAP_FILE = 'drive-session.wrap'

export type DriveSettings = {
  file?: string
  blindPeerKeys: string[]
}

export type DriveSession = {
  unlocked?: boolean
  primaryKey?: string
  encryptionKey?: string
  identityHex?: string
}

export class SessionAuthError extends Error {
  readonly code = 'SESSION_AUTH'
  constructor(message: string) {
    super(message)
    this.name = 'SessionAuthError'
  }
}

function tempSuffix(): string {
  return b4a.toString(hypercoreCrypto.randomBytes(8), 'hex')
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = asBytes(await fs.promises.readFile(file))
    return JSON.parse(b4a.toString(raw)) as T
  } catch {
    return fallback
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.promises.mkdir(path.dirname(file), { recursive: true })
  const tmp = file + '.tmp-' + tempSuffix()
  const payload = b4a.from(JSON.stringify(value, null, 2))
  try {
    await fs.promises.writeFile(tmp, payload)
    await fs.promises.rename(tmp, file)
  } catch (err) {
    await fs.promises.unlink(tmp).catch(() => {})
    throw err
  }
}

async function chmodPrivate(file: string): Promise<void> {
  try {
    await fs.promises.chmod(file, 0o600)
  } catch {
    // Best-effort on platforms that ignore mode
  }
}

async function loadWrapKey(storageDir: string): Promise<Uint8Array | null> {
  const file = path.join(storageDir, SESSION_WRAP_FILE)
  try {
    const existing = asBytes(await fs.promises.readFile(file))
    if (existing.byteLength === 32) return existing
  } catch {
    // Missing wrap file
  }
  return null
}

async function loadOrCreateWrapKey(storageDir: string): Promise<Uint8Array> {
  const existing = await loadWrapKey(storageDir)
  if (existing) return existing
  const file = path.join(storageDir, SESSION_WRAP_FILE)
  const key = hypercoreCrypto.randomBytes(32)
  await fs.promises.mkdir(path.dirname(file), { recursive: true })
  try {
    await fs.promises.writeFile(file, key, { mode: 0o600 })
  } catch {
    await fs.promises.writeFile(file, key)
  }
  await chmodPrivate(file)
  return key
}

function decryptSessionPayload(
  wrapKey: Uint8Array,
  nonceHex: string,
  ciphertextHex: string
): DriveSession | null {
  const nonce = b4a.from(nonceHex, 'hex')
  const ciphertext = b4a.from(ciphertextHex, 'hex')
  if (nonce.byteLength !== sodium.crypto_secretbox_NONCEBYTES) return null
  if (ciphertext.byteLength < sodium.crypto_secretbox_MACBYTES) return null
  const decrypted = b4a.alloc(ciphertext.byteLength - sodium.crypto_secretbox_MACBYTES)
  const ok = sodium.crypto_secretbox_open_easy(decrypted, ciphertext, nonce, wrapKey)
  if (!ok) return null
  try {
    return JSON.parse(b4a.toString(decrypted)) as DriveSession
  } catch {
    return null
  }
}

export async function loadSettings(storageDir: string): Promise<DriveSettings> {
  const file = path.join(storageDir, SETTINGS_FILE)
  const data = await readJson<DriveSettings>(file, { blindPeerKeys: [] })
  return { file, blindPeerKeys: Array.isArray(data.blindPeerKeys) ? data.blindPeerKeys : [] }
}

export async function saveSettings(storageDir: string, settings: DriveSettings): Promise<void> {
  const file = path.join(storageDir, SETTINGS_FILE)
  await writeJson(file, { blindPeerKeys: settings.blindPeerKeys || [] })
}

export async function saveSession(storageDir: string, session: DriveSession): Promise<void> {
  const wrapKey = await loadOrCreateWrapKey(storageDir)
  const nonce = b4a.alloc(sodium.crypto_secretbox_NONCEBYTES)
  sodium.randombytes_buf(nonce)
  const payload = b4a.from(JSON.stringify(session))
  const ciphertext = b4a.alloc(payload.byteLength + sodium.crypto_secretbox_MACBYTES)
  sodium.crypto_secretbox_easy(ciphertext, payload, nonce, wrapKey)
  const file = path.join(storageDir, SESSION_FILE)
  await writeJson(file, {
    v: 2,
    nonce: b4a.toString(nonce, 'hex'),
    ciphertext: b4a.toString(ciphertext, 'hex')
  })
  await chmodPrivate(file)
}

export async function loadSession(storageDir: string): Promise<DriveSession | null> {
  const file = path.join(storageDir, SESSION_FILE)
  const data = await readJson<Record<string, unknown> | null>(file, null)
  if (!data) return null
  if (data.v === 2 && typeof data.nonce === 'string' && typeof data.ciphertext === 'string') {
    const wrapKey = await loadWrapKey(storageDir)
    if (!wrapKey) throw new SessionAuthError('Session wrap key missing')
    const session = decryptSessionPayload(wrapKey, data.nonce, data.ciphertext)
    if (!session) throw new SessionAuthError('Session decrypt failed')
    return session
  }
  if (typeof data.primaryKey === 'string' && typeof data.encryptionKey === 'string') {
    const legacy: DriveSession = {
      unlocked: Boolean(data.unlocked),
      primaryKey: data.primaryKey,
      encryptionKey: data.encryptionKey,
      identityHex: typeof data.identityHex === 'string' ? data.identityHex : undefined
    }
    await saveSession(storageDir, legacy)
    return legacy
  }
  return null
}

export async function clearSession(storageDir: string): Promise<void> {
  try {
    await fs.promises.unlink(path.join(storageDir, SESSION_FILE))
  } catch {
    // Already gone
  }
}

export function parseSessionKey(hex: string, label: string): Uint8Array {
  if (typeof hex !== 'string' || !/^[0-9a-f]+$/i.test(hex) || hex.length !== 64) {
    throw new SessionAuthError(`Invalid ${label}`)
  }
  const key = b4a.from(hex, 'hex')
  if (key.byteLength !== 32) throw new SessionAuthError(`Invalid ${label} length`)
  return key
}
