import b4a from 'b4a'
import hypercoreCrypto from 'hypercore-crypto'
import sodium from 'sodium-universal'

export function hashChunk(buf: Uint8Array): string {
  return b4a.toString(hypercoreCrypto.hash(buf), 'hex')
}

export function generateMasterNonce(): string {
  const nonce = b4a.alloc(sodium.crypto_secretbox_NONCEBYTES)
  sodium.randombytes_buf(nonce)
  return b4a.toString(nonce, 'hex')
}

export function deriveBlockNonce(masterNonce: string | Uint8Array, blockIndex: number): string {
  const masterBuf = typeof masterNonce === 'string' ? b4a.from(masterNonce, 'hex') : masterNonce
  const idxBuf = b4a.alloc(4)
  idxBuf[0] = (blockIndex >>> 24) & 0xff
  idxBuf[1] = (blockIndex >>> 16) & 0xff
  idxBuf[2] = (blockIndex >>> 8) & 0xff
  idxBuf[3] = blockIndex & 0xff
  const fullHash = hypercoreCrypto.hash(b4a.concat([b4a.from('p2cloud/block-nonce/v1'), masterBuf, idxBuf]))
  return b4a.toString(fullHash.subarray(0, sodium.crypto_secretbox_NONCEBYTES), 'hex')
}

export function encryptBlock(buf: Uint8Array, key: Uint8Array | string, blockNonceHex: string): Uint8Array {
  const nonce = b4a.from(blockNonceHex, 'hex')
  const key32 = hypercoreCrypto.hash(typeof key === 'string' ? b4a.from(key) : key)
  const encrypted = b4a.alloc(buf.byteLength + sodium.crypto_secretbox_MACBYTES)
  sodium.crypto_secretbox_easy(encrypted, buf, nonce, key32)
  return encrypted
}

export function encryptBuffer(buf: Uint8Array, key: Uint8Array | string): { encrypted: Uint8Array; nonce: string } {
  const nonce = generateMasterNonce()
  const encrypted = encryptBlock(buf, key, nonce)
  return { encrypted, nonce }
}

export function decryptBlock(encrypted: Uint8Array, key: Uint8Array | string, blockNonceHex: string): Uint8Array {
  const nonce = b4a.from(blockNonceHex, 'hex')
  const key32 = hypercoreCrypto.hash(typeof key === 'string' ? b4a.from(key) : key)
  const decrypted = b4a.alloc(encrypted.byteLength - sodium.crypto_secretbox_MACBYTES)
  const ok = sodium.crypto_secretbox_open_easy(decrypted, encrypted, nonce, key32)
  if (!ok) {
    throw new Error('Cryptographic authentication failed on block. Key mismatch or corrupted shard data.')
  }
  return decrypted
}

export function decryptBuffer(encrypted: Uint8Array, key: Uint8Array | string, nonceHex: string): Uint8Array {
  return decryptBlock(encrypted, key, nonceHex)
}

