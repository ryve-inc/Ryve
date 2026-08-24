export type FaultToleranceStatus = 'full' | 'degraded' | 'critical' | 'none'

export type ChunkInfo = {
  index: number
  offset: number
  length: number
  hash: string
  isParity?: boolean
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
  erasureCoding?: {
    k: number
    m: number
    chunkSize: number
    paddedSize: number
    faultTolerance: FaultToleranceStatus
  }
}

export type DriveEntry = {
  path: string
  name: string
  isDirectory: boolean
  byteLength: number
  metadata: Record<string, unknown> | null
  chunkCount?: number
  isPrivate?: boolean
}

export type NetworkItem = {
  id: string
  name: string
  networkLink: string
  networkKeyHex: string
  topicHex: string
  peers: number
  createdAt: number
}

export type NetworkInfo = {
  networkLink: string | null
  networkKeyHex: string | null
  topicHex: string | null
  joined: boolean
  activeId: string | null
  networks: NetworkItem[]
}

export type AppStatus = {
  unlocked: boolean
  identity: string | null
  displayName: string | null
  driveKey: string | null
  peers: number
  blindPeerKeys: string[]
  network: NetworkInfo
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
  writeClipboard: (text: string) => Promise<void>
  chooseDownloadPath: (defaultName?: string) => Promise<string | null>
  chooseUploadFiles: () => Promise<string[]>
}

declare global {
  interface Window {
    bridge?: BridgeApi
  }

  // Bare globals available inside the pear-runtime worker
  // eslint-disable-next-line no-var
  var Bare: {
    argv: string[]
    IPC: unknown
  }
}

export {}

