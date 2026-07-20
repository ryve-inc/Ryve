// @ts-nocheck
import b4a from 'b4a'
import hypercoreCrypto from 'hypercore-crypto'

function hexHash(buf) {
  return b4a.toString(hypercoreCrypto.hash(buf), 'hex')
}

async function buildChunkManifest(drive, entryPath) {
  const entry = await drive.entry(entryPath)
  if (!entry || !entry.value || !entry.value.blob) {
    throw new Error('File not found or has no content: ' + entryPath)
  }

  const blob = entry.value.blob
  const chunks = []
  let offset = 0

  await drive.ready()
  if (!drive.blobs) throw new Error('Drive blobs not ready')

  // If chunk hashes are already stored in metadata, return them instantly without reading pruned blocks
  if (entry.value.metadata && entry.value.metadata.chunks && Array.isArray(entry.value.metadata.chunks)) {
    return {
      path: entryPath,
      byteLength: blob.byteLength,
      mime: entry.value.metadata.mime || null,
      blob: {
        blockOffset: blob.blockOffset,
        blockLength: blob.blockLength,
        byteOffset: blob.byteOffset,
        byteLength: blob.byteLength
      },
      chunks: entry.value.metadata.chunks,
      metadata: entry.value.metadata
    }
  }

  // Fallback: fetch block range with timeout if metadata chunks missing
  if (!drive.blobs) {
    try { await drive.getBlobs() } catch {}
  }
  if (!drive.blobs?.core) throw new Error('Drive blobs not ready')

  const start = blob.blockOffset
  const end = blob.blockOffset + blob.blockLength
  try {
    const range = drive.blobs.core.download({ start, end })
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Peer offline')), 5000))
    await Promise.race([range.done(), timeoutPromise])
  } catch {}

  for (let i = 0; i < blob.blockLength; i++) {
    const blockIndex = blob.blockOffset + i
    const block = await drive.blobs.core.get(blockIndex, { wait: false })
    const length = block ? block.byteLength : 0
    chunks.push({
      index: i,
      offset,
      length,
      hash: block ? hexHash(block) : '0000000000000000000000000000000000000000000000000000000000000000'
    })
    offset += length
  }

  return {
    path: entryPath,
    byteLength: blob.byteLength,
    mime: (entry.value.metadata && entry.value.metadata.mime) || null,
    blob: {
      blockOffset: blob.blockOffset,
      blockLength: blob.blockLength,
      byteOffset: blob.byteOffset,
      byteLength: blob.byteLength
    },
    chunks,
    metadata: entry.value.metadata || null
  }
}

export { buildChunkManifest }
