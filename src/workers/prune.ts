// @ts-nocheck

const PRUNE_TIMEOUT_MS = 300_000 // 5 minutes max wait for replication

/**
 * Checks if all blocks of a file in the drive's blobs core have been replicated
 * to at least one peer. Once replicated, it clears the local copy of those blocks.
 * Only the lightweight metadata index remains locally.
 *
 * This function:
 * 1. Checks if any currently connected peer already has the blocks
 * 2. Listens for 'upload' events (fired when WE send a block to a peer)
 * 3. Polls peer bitfields every 3 seconds to catch blocks synced via other means
 * 4. Times out after 5 minutes if no peer receives the blocks
 */
async function clearLocalChunksAfterReplication(drive, entryPath) {
  await drive.ready()

  // Ensure blobs core is initialized (lazy init after first put)
  if (!drive.blobs) {
    try { await drive.getBlobs() } catch {}
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

  console.log(`[Pruner] Tracking ${blob.blockLength} blocks for ${entryPath} [${start} - ${end})`)

  // Set to track blocks confirmed replicated to at least one peer
  const uploaded = new Set()

  const checkPeers = () => {
    if (!blobsCore.peers) return false
    for (const peer of blobsCore.peers) {
      if (!peer.remoteBitfield) continue
      for (let i = start; i < end; i++) {
        if (peer.remoteBitfield.get(i)) {
          uploaded.add(i)
        }
      }
    }
    return uploaded.size >= blob.blockLength
  }

  const doClear = async () => {
    try {
      await blobsCore.clear(start, end)
      console.log(`[Pruner] ✓ Cleared local chunks for ${entryPath} [${start} - ${end}). Data now lives only on peers.`)
      return true
    } catch (err) {
      console.error(`[Pruner] ✗ Failed to clear local chunks for ${entryPath}:`, err)
      return false
    }
  }

  // Initial check
  if (checkPeers()) {
    await doClear()
    return
  }

  const peerCount = blobsCore.peers ? blobsCore.peers.length : 0
  console.log(`[Pruner] Waiting for peer replication of ${entryPath}. Connected peers: ${peerCount}, Progress: ${uploaded.size}/${blob.blockLength}`)

  return new Promise((resolve) => {
    let resolved = false

    const finish = async () => {
      if (resolved) return
      resolved = true
      cleanup()
      await doClear()
      resolve()
    }

    // Fires when WE send a block TO a remote peer
    const onUpload = (index) => {
      if (index >= start && index < end) {
        uploaded.add(index)
        if (uploaded.size >= blob.blockLength) {
          console.log(`[Pruner] All ${blob.blockLength} blocks served to peers for ${entryPath}`)
          finish()
        }
      }
    }

    // Poll peer bitfields periodically
    const interval = setInterval(() => {
      if (checkPeers()) {
        console.log(`[Pruner] All ${blob.blockLength} blocks confirmed on peers for ${entryPath}`)
        finish()
      }
    }, 3000)

    // Timeout after PRUNE_TIMEOUT_MS
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true
        cleanup()
        console.log(`[Pruner] ⏱ Timeout for ${entryPath}. ${uploaded.size}/${blob.blockLength} blocks replicated. Chunks kept locally.`)
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
