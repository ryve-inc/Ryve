import b4a from 'b4a'
import hypercoreCrypto from 'hypercore-crypto'
import sodium from 'sodium-universal'
import wordlist from './bip39-english.json' with { type: 'json' }

function sha256(data: Uint8Array): Uint8Array {
  const out = b4a.alloc(32)
  sodium.crypto_hash_sha256(out, data)
  return out
}

function entropyToMnemonic(entropy: Uint8Array): string {
  if (entropy.byteLength !== 32) throw new Error('Expected 32 bytes of entropy')
  const hash = sha256(entropy)
  // 256 bits entropy + 8 bit checksum = 264 bits → 24 words
  const bits: number[] = []
  for (let i = 0; i < entropy.byteLength; i++) {
    for (let b = 7; b >= 0; b--) bits.push((entropy[i] >> b) & 1)
  }
  for (let b = 7; b >= 0; b--) bits.push((hash[0] >> b) & 1)

  const words: string[] = []
  for (let i = 0; i < 24; i++) {
    let idx = 0
    for (let j = 0; j < 11; j++) idx = (idx << 1) | bits[i * 11 + j]
    words.push((wordlist as string[])[idx])
  }
  return words.join(' ')
}

function mnemonicToEntropy(mnemonic: string): Uint8Array {
  const words = mnemonic.trim().toLowerCase().replace(/\s+/g, ' ').split(' ')
  if (words.length !== 24) throw new Error('Recovery key must be 24 words')
  const bits: number[] = []
  for (const word of words) {
    const idx = (wordlist as string[]).indexOf(word)
    if (idx === -1) throw new Error('Invalid word in recovery key: ' + word)
    for (let j = 10; j >= 0; j--) bits.push((idx >> j) & 1)
  }
  const entropy = b4a.alloc(32)
  for (let i = 0; i < 32; i++) {
    let v = 0
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i * 8 + j]
    entropy[i] = v
  }
  const checksumBits = bits.slice(256, 264)
  const hash = sha256(entropy)
  for (let i = 0; i < 8; i++) {
    const expected = (hash[0] >> (7 - i)) & 1
    if (checksumBits[i] !== expected) throw new Error('Invalid recovery key checksum')
  }
  return entropy
}

function mnemonicToSeed(mnemonic: string): Uint8Array {
  const entropy = mnemonicToEntropy(mnemonic)
  return hypercoreCrypto.hash(b4a.concat([b4a.from('pear-drive/bip39-seed/v1'), entropy]))
}

function deriveKeys(seed: Uint8Array): { primaryKey: Uint8Array; encryptionKey: Uint8Array } {
  const seedBuf = b4a.from(seed)
  const primaryKey = hypercoreCrypto.hash(b4a.concat([b4a.from('pear-drive/primary/v1'), seedBuf]))
  const encryptionKey = hypercoreCrypto.hash(
    b4a.concat([b4a.from('pear-drive/encryption/v1'), seedBuf])
  )
  return { primaryKey, encryptionKey }
}

function createAccount(): { mnemonic: string; primaryKey: Uint8Array; encryptionKey: Uint8Array } {
  const entropy = hypercoreCrypto.randomBytes(32)
  const mnemonic = entropyToMnemonic(entropy)
  const seed = mnemonicToSeed(mnemonic)
  const keys = deriveKeys(seed)
  return { mnemonic, ...keys }
}

function unlockFromMnemonic(mnemonic: string): { mnemonic: string; primaryKey: Uint8Array; encryptionKey: Uint8Array } {
  const normalized = mnemonic.trim().toLowerCase().replace(/\s+/g, ' ')
  const seed = mnemonicToSeed(normalized)
  return { mnemonic: normalized, ...deriveKeys(seed) }
}

function publicIdentity(primaryKey: Uint8Array): Uint8Array {
  return hypercoreCrypto.hash(b4a.concat([b4a.from('pear-drive/id/v1'), primaryKey]))
}

/**
 * P2P Network Key & Invite Link Utilities
 */
export function createNetworkKey(): { networkKeyHex: string; networkLink: string } {
  const randomBytes = hypercoreCrypto.randomBytes(32)
  const networkKeyHex = b4a.toString(randomBytes, 'hex')
  const networkLink = `p2p-drive://network/${networkKeyHex}`
  return { networkKeyHex, networkLink }
}

export function parseNetworkLink(inputLink: string): string {
  let cleaned = inputLink.trim()
  if (cleaned.startsWith('p2p-drive://network/')) {
    cleaned = cleaned.replace('p2p-drive://network/', '')
  } else if (cleaned.startsWith('p2p://network/')) {
    cleaned = cleaned.replace('p2p://network/', '')
  } else if (cleaned.includes('#')) {
    cleaned = cleaned.split('#').pop() || cleaned
  }
  cleaned = cleaned.replace(/[^a-fA-F0-9]/g, '')
  if (cleaned.length !== 64) {
    throw new Error('Invalid Network Invite Link. Expected a 64-character hex network key.')
  }
  return cleaned.toLowerCase()
}

export function deriveNetworkKeys(networkKeyHex: string): {
  primaryKey: Uint8Array
  encryptionKey: Uint8Array
  swarmTopic: Uint8Array
  swarmChunkTopic: Uint8Array
  topicHex: string
  networkLink: string
} {
  const networkKey = b4a.from(networkKeyHex, 'hex')
  const primaryKey = hypercoreCrypto.hash(b4a.concat([b4a.from('p2p-drive/net-primary/v1'), networkKey]))
  const encryptionKey = hypercoreCrypto.hash(b4a.concat([b4a.from('p2p-drive/net-encryption/v1'), networkKey]))
  const swarmTopic = hypercoreCrypto.hash(b4a.concat([b4a.from('p2p-drive/net-swarm/v1'), networkKey]))
  const swarmChunkTopic = hypercoreCrypto.hash(b4a.concat([b4a.from('p2p-drive/net-chunk/v1'), networkKey]))
  const topicHex = b4a.toString(swarmTopic, 'hex')
  const networkLink = `p2p-drive://network/${networkKeyHex}`

  return { primaryKey, encryptionKey, swarmTopic, swarmChunkTopic, topicHex, networkLink }
}

export { createAccount, unlockFromMnemonic, publicIdentity }

