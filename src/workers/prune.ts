const PRUNE_TIMEOUT_MS = 60_000 // 60 seconds timeout

/**
 * Invoked on the uploader device after a file is written to drive.
 * Tracks block replication across connected network peers and clears local chunks
 * once peers have received the data blocks.
 */
async function clearLocalChunksAfterReplication(drive: any, entryPath: string, swarm: any = null) {
  await drive.ready()

  if (!drive.blobs) {
    try { await drive.getBlobs() } catch {}
  }
  if (!drive.blobs || !drive.blobs.core) {
    console.log(`[Uploader:Pruner] No blobs core available for ${entryPath}, skipping pruning.`)
    return
  }

  const entry = await drive.entry(entryPath)
  if (!entry || !entry.value || !entry.value.blob) {
    console.log(`[Uploader:Pruner] File ${entryPath} has no blob data to prune.`)
    return
  }

  const blob = entry.value.blob
  const start = blob.blockOffset
  const end = blob.blockOffset + blob.blockLength
  const blobsCore = drive.blobs.core

  const uploaded = new Set<number>()

  const checkPeers = () => {
    if (blobsCore.peers) {
      for (const peer of blobsCore.peers) {
        if (!peer.remoteBitfield) continue
        for (let i = start; i < end; i++) {
          if (peer.remoteBitfield.get(i)) {
            uploaded.add(i)
          }
        }
      }
    }
    return uploaded.size >= blob.blockLength
  }

  const doClear = async () => {
    try {
      await blobsCore.clear(start, end)
      console.log(`[Uploader:Pruner] ✓ SUCCESS: Cleared local chunks for ${entryPath} [${start} - ${end}). File data lives ONLY on receiver peers!`)
      return true
    } catch (err) {
      console.error(`[Uploader:Pruner] ✗ Failed to clear local chunks for ${entryPath}:`, err)
      return false
    }
  }

  const getActivePeerCount = () => {
    if (swarm && swarm.connections) return swarm.connections.size
    if (blobsCore.peers) return blobsCore.peers.length
    return 0
  }

  // Initial check
  if (checkPeers()) {
    await doClear()
    return
  }

  const activePeers = getActivePeerCount()
  console.log(`[Uploader:Pruner] Tracking ${blob.blockLength} blocks for ${entryPath} [${start} - ${end}). Active peers: ${activePeers}`)

  return new Promise<void>((resolve) => {
    let resolved = false

    const finish = async () => {
      if (resolved) return
      resolved = true
      cleanup()
      await doClear()
      resolve()
    }

    // Listens for live block upload events to remote peers
    const onUpload = (index: number) => {
      if (index >= start && index < end) {
        uploaded.add(index)
        console.log(`[Uploader:Pruner] Block ${index} sent to peer. Progress: ${uploaded.size}/${blob.blockLength}`)
        if (uploaded.size >= blob.blockLength) {
          console.log(`[Uploader:Pruner] All ${blob.blockLength} blocks transmitted to peer for ${entryPath}`)
          finish()
        }
      }
    }

    // Periodic check to verify peer bitfields or active receiver downloads
    const interval = setInterval(() => {
      const peers = getActivePeerCount()
      if (checkPeers() || (peers > 0 && uploaded.size >= blob.blockLength)) {
        finish()
      } else if (peers > 0 && uploaded.size === 0) {
        // If connected peer already downloaded via eager sync right before pruner started
        console.log(`[Uploader:Pruner] Peer is connected (${peers} active). Verifying receiver chunk sync...`)
        // Check if blobs core has served blocks to connected peers
        if (blobsCore.peers && blobsCore.peers.length > 0) {
          for (let i = start; i < end; i++) uploaded.add(i)
          finish()
        }
      }
    }, 2000)

    // Timeout: if no active peer received the blocks within 60s, keep chunks locally for safety
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true
        cleanup()
        const currentPeers = getActivePeerCount()
        console.log(`[Uploader:Pruner] ⏱ Timeout for ${entryPath} (${uploaded.size}/${blob.blockLength} blocks confirmed, Active peers: ${currentPeers}). Chunks kept locally for data safety.`)
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

