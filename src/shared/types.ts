export type FaultToleranceStatus = 'full' | 'degraded' | 'none'

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
  blob?: {
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
}

export type AppStatus = {
  unlocked: boolean
  identity: string | null
  driveKey: string | null
  peers: number
  blindPeerKeys: string[]
}

export type FilePreviewResult =
  | {
      tooLarge: false
      path: string
      name: string
      mime: string | null
      bytes: string
      verified: boolean
      byteLength: number
    }
  | {
      tooLarge: true
      path: string
      name: string
      mime: string | null
      byteLength: number
    }

export type BridgeFile = {
  name: string
}

export type BridgeApi = {
  applyUpdate: () => Promise<void>
  appAfterUpdate: () => Promise<void>
  startWorker: (specifier: string) => Promise<boolean>
  onWorkerStdout: (specifier: string, listener: (data: Uint8Array) => void) => () => void
  onWorkerStderr: (specifier: string, listener: (data: Uint8Array) => void) => () => void
  onWorkerIPC: (specifier: string, listener: (data: Uint8Array) => void) => () => void
  onWorkerExit: (specifier: string, listener: (code: number) => void) => () => void
  writeWorkerIPC: (specifier: string, data: string | Uint8Array) => Promise<unknown>
  getPathForFile: (file: BridgeFile) => string
  writeClipboard: (text: string) => Promise<void>
  chooseDownloadPath: (defaultName?: string) => Promise<string | null>
  chooseUploadFiles: () => Promise<string[]>
}
