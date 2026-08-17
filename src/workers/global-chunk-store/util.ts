import path from 'bare-path'
import * as fs from 'bare-fs'
import * as b4a from 'b4a'
import hypercoreCrypto from 'hypercore-crypto'

const HEX_HASH_RE = /^[0-9a-f]{64}$/i

export function normalizeChunkHash(hash: string): string {
  if (typeof hash !== 'string' || !HEX_HASH_RE.test(hash)) {
    throw new Error('Invalid chunk hash')
  }
  return hash.toLowerCase()
}

export function hashBuffer(buf: Uint8Array): string {
  return b4a.toString(hypercoreCrypto.hash(buf), 'hex')
}

export function chunkFilePath(cacheDir: string, hash: string): string {
  return path.join(cacheDir, normalizeChunkHash(hash) + '.bin')
}

export function randomTempSuffix(): string {
  return b4a.toString(hypercoreCrypto.randomBytes(8), 'hex')
}

export async function writeFileAtomic(
  filePath: string,
  buf: Uint8Array,
  opts?: { mode?: number }
): Promise<void> {
  const tmp = filePath + '.tmp-' + randomTempSuffix()
  try {
    if (opts) await fs.promises.writeFile(tmp, buf, opts)
    else await fs.promises.writeFile(tmp, buf)
    await fs.promises.rename(tmp, filePath)
  } catch (err) {
    await fs.promises.unlink(tmp).catch(() => {})
    throw err
  }
}
