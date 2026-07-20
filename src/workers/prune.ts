// @ts-nocheck

const PRUNE_TIMEOUT_MS = 60_000 // 60 seconds max wait for replication

/**
 * Checks if all blocks of a file in the drive's blobs core have been replicated
 * to at least one peer. Once replicated, it clears the local copy of those blocks.
 * Only the lightweight metadata index remains locally.
 */
async function clearLocalChunksAfterReplication(drive, entryPath) {
  await drive.ready()

  // Ensure blobs core is initialized (lazy init after first put)
  if (!drive.blobs) {
    await drive.getBlobs()
  }
  if (!drive.blobs || !drive.blobs.core) {
    console.log(`[Pruner] No blobs core available for ${entryPath}, skipping.`)
    return
  }

  const entry = await drive.entry(entryPath)
  if (!entry || !entry.value || !entry.value.blob) {
    console.log(`[Pruner] File ${entryPath} has no blob data to prune.`)
    return
  }

  const blob = entry.value.blob
  const start = blob.blockOffset
  const end = blob.blockOffset + blob.blockLength
  const blobsCore = drive.blobs.core

  console.log(`[Pruner] Tracking replication for ${entryPath}: ${blob.blockLength} blocks [${start} - ${end})`)

  // Set to track blocks confirmed replicated to at least one peer
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

  const doClear = async () => {
    try {
      await blobsCore.clear(start, end)
      console.log(`[Pruner] ✓ Cleared local chunks for ${entryPath} [${start} - ${end}). Data now lives only on peers.`)
    } catch (err) {
      console.error(`[Pruner] ✗ Failed to clear local chunks for ${entryPath}:`, err)
    }
  }

  // Check if peers already have the blocks
  checkPeers()

  if (uploaded.size >= blob.blockLength) {
    await doClear()
    return
  }

  console.log(`[Pruner] Waiting for peer replication of ${entryPath}. Progress: ${uploaded.size}/${blob.blockLength}`)

  return new Promise((resolve) => {
    let resolved = false

    const finish = async () => {
      if (resolved) return
      resolved = true
      cleanup()
      await doClear()
      resolve()
    }

    const onUpload = (index) => {
      if (index >= start && index < end) {
        uploaded.add(index)
        console.log(`[Pruner] Block ${index} uploaded. Progress: ${uploaded.size}/${blob.blockLength}`)
        if (uploaded.size >= blob.blockLength) {
          finish()
        }
      }
    }

    // Poll peers periodically (catches blocks replicated via bitfield sync)
    const interval = setInterval(() => {
      checkPeers()
      if (uploaded.size >= blob.blockLength) {
        finish()
      }
    }, 2000)

    // Timeout: give up waiting after PRUNE_TIMEOUT_MS
    const timeout = setTimeout(() => {
      if (!resolved) {
        console.log(`[Pruner] Timeout waiting for replication of ${entryPath}. ${uploaded.size}/${blob.blockLength} blocks replicated. Will retry on next connection.`)
        resolved = true
        cleanup()
        resolve()
      }
    }, PRUNE_TIMEOUT_MS)

    function cleanup() {
      clearInterval(interval)
      clearTimeout(timeout)
      blobsCore.off('upload', onUpload)
    }

    blobsCore.on('upload', onUpload)
  })
}

export { clearLocalChunksAfterReplication }
