export type ChunkInfo = {
  index: number
  offset: number
  length: number
  hash: string
}

export type ChunkManifest = {
  path: string
  byteLength: number
  mime: string | null
  blob: {
    blockOffset: number
    blockLength: number
    byteOffset: number
    byteLength: number
  }
  chunks: ChunkInfo[]
  metadata: Record<string, unknown> | null
}

export type DriveEntry = {
  path: string
  name: string
  isDirectory: boolean
  byteLength: number
  metadata: Record<string, unknown> | null
  chunkCount?: number
}

export type AppStatus = {
  unlocked: boolean
  identity: string | null
  driveKey: string | null
  peers: number
  blindPeerKeys: string[]
  shares: ShareInfo[]
}

export type ShareInfo = {
  id: string
  name: string
  type: 'read' | 'collab'
  pathPrefix: string
  writable: boolean
  from: string | null
}

export type BridgeApi = {
  applyUpdate: () => Promise<void>
  appAfterUpdate: () => Promise<void>
  startWorker: (specifier: string) => Promise<boolean>
  onWorkerStdout: (specifier: string, listener: (data: Buffer) => void) => () => void
  onWorkerStderr: (specifier: string, listener: (data: Buffer) => void) => () => void
  onWorkerIPC: (specifier: string, listener: (data: Buffer) => void) => () => void
  onWorkerExit: (specifier: string, listener: (code: number) => void) => () => void
  writeWorkerIPC: (specifier: string, data: string | Uint8Array) => Promise<unknown>
  getPathForFile: (file: File) => string
  writeClipboard: (text: string) => void
  chooseDownloadPath: (defaultName?: string) => Promise<string | null>
}

declare global {
  interface Window {
    bridge: BridgeApi
  }

  // Bare globals available inside the pear-runtime worker
  // eslint-disable-next-line no-var
  var Bare: {
    argv: string[]
    IPC: unknown
  }
}

export {}
