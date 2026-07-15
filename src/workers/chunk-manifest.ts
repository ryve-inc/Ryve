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

  for (let i = 0; i < blob.blockLength; i++) {
    const blockIndex = blob.blockOffset + i
    const block = await drive.blobs.core.get(blockIndex)
    const length = block.byteLength
    chunks.push({
      index: i,
      offset,
      length,
      hash: hexHash(block)
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
