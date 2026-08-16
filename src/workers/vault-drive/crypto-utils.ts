import b4a from 'b4a'
import hypercoreCrypto from 'hypercore-crypto'
import sodium from 'sodium-universal'

export function hashChunk(buf: Uint8Array): string {
  return b4a.toString(hypercoreCrypto.hash(buf), 'hex')
}

export function encryptBuffer(buf: Uint8Array, key: Uint8Array | string): { encrypted: Uint8Array; nonce: string } {
  const nonce = b4a.alloc(sodium.crypto_secretbox_NONCEBYTES)
  sodium.randombytes_buf(nonce)
  const key32 = hypercoreCrypto.hash(typeof key === 'string' ? b4a.from(key) : key)
  const encrypted = b4a.alloc(buf.byteLength + sodium.crypto_secretbox_MACBYTES)
  sodium.crypto_secretbox_easy(encrypted, buf, nonce, key32)
  return {
    encrypted,
    nonce: b4a.toString(nonce, 'hex')
  }
}

export function decryptBuffer(encrypted: Uint8Array, key: Uint8Array | string, nonceHex: string): Uint8Array {
  const nonce = b4a.from(nonceHex, 'hex')
  const key32 = hypercoreCrypto.hash(typeof key === 'string' ? b4a.from(key) : key)
  const decrypted = b4a.alloc(encrypted.byteLength - sodium.crypto_secretbox_MACBYTES)
  const ok = sodium.crypto_secretbox_open_easy(decrypted, encrypted, nonce, key32)
  if (!ok) {
    throw new Error('Cryptographic authentication failed. Key mismatch or corrupted file.')
  }
  return decrypted
}

