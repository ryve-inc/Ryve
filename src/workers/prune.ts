// @ts-nocheck
import path from 'bare-path'

/**
 * Checks if all blocks of a file in the drive's blobs core have been replicated
 * to at least one peer. Once replicated, it clears the local copy of those blocks.
 */
async function clearLocalChunksAfterReplication(drive, entryPath) {
  await drive.ready()
  const entry = await drive.entry(entryPath)
  if (!entry || !entry.value || !entry.value.blob) {
    console.log(`[Pruner] File ${entryPath} has no blobs/chunks to prune.`)
    return
  }

  const blob = entry.value.blob
  const start = blob.blockOffset
  const end = blob.blockOffset + blob.blockLength
  const blobsCore = drive.blobs.core

  // Set to track blocks in [start, end) that are confirmed uploaded/replicated to at least one peer
  const uploaded = new Set()

  const checkPeers = () => {
    if (!blobsCore.peers) return
    for (const peer of blobsCore.peers) {
      if (!peer.remoteBitfield) continue
      for (let i = start; i < end; i++) {
        if (peer.remoteBitfield.get(i)) {
          uploaded.add(i)
        }
      }
    }
  }

  // Initial check of peers currently connected
  checkPeers()

  if (uploaded.size >= blob.blockLength) {
    await blobsCore.clear(start, end)
    console.log(`[Pruner] All chunks for ${entryPath} were already replicated. Cleared locally [${start} - ${end})`)
    return
  }

  console.log(`[Pruner] Waiting for replication of ${entryPath} [${start} - ${end}). Current progress: ${uploaded.size}/${blob.blockLength} chunks.`)

  return new Promise((resolve) => {
    const onUpload = (index) => {
      if (index >= start && index < end) {
        uploaded.add(index)
        if (uploaded.size >= blob.blockLength) {
          cleanup()
          blobsCore.clear(start, end).then(() => {
            console.log(`[Pruner] Replicated and cleared local chunks for ${entryPath} [${start} - ${end})`)
            resolve()
          }).catch(err => {
            console.error(`[Pruner] Failed to clear local chunks for ${entryPath}:`, err)
            resolve()
          })
        }
      }
    }

    const interval = setInterval(() => {
      checkPeers()
      if (uploaded.size >= blob.blockLength) {
        cleanup()
        blobsCore.clear(start, end).then(() => {
          console.log(`[Pruner] Replicated and cleared local chunks for ${entryPath} [${start} - ${end})`)
          resolve()
        }).catch(err => {
          console.error(`[Pruner] Failed to clear local chunks for ${entryPath}:`, err)
          resolve()
        })
      }
    }, 2000)

    function cleanup() {
      clearInterval(interval)
      blobsCore.off('upload', onUpload)
    }

    blobsCore.on('upload', onUpload)
  })
}

export { clearLocalChunksAfterReplication }
