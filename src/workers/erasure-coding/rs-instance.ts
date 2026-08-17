import { ReedSolomonErasure } from '@digitaldefiance/reed-solomon-erasure.wasm'

export const DEFAULT_EC_K = 4
export const DEFAULT_EC_M = 2

type FsLike = { readFileSync(filePath: string): Uint8Array }
type PathLike = { join(...parts: string[]): string; resolve(...parts: string[]): string }

let rsInstance: ReedSolomonErasure | null = null

function loadFsModules(): { fs: FsLike; path: PathLike } {
  if (typeof Bare !== 'undefined') {
    return {
      fs: require('bare-fs') as FsLike,
      path: require('bare-path') as PathLike
    }
  }

  const getBuiltin = process.getBuiltinModule?.bind(process)
  if (getBuiltin) {
    return { fs: getBuiltin('fs') as FsLike, path: getBuiltin('path') as PathLike }
  }

  const mainReq = process.mainModule?.require?.bind(process.mainModule)
  if (mainReq) {
    return { fs: mainReq('fs') as FsLike, path: mainReq('path') as PathLike }
  }

  throw new Error('[ErasureCoding] Could not initialize filesystem module.')
}

export function getRSInstance(): ReedSolomonErasure {
  if (rsInstance) return rsInstance

  const { fs, path } = loadFsModules()
  const dirname = typeof __dirname !== 'undefined' ? __dirname : path.resolve('.')
  const candidatePaths = [
    path.join(dirname, 'reed_solomon_erasure_bg.wasm'),
    path.resolve('dist/workers/reed_solomon_erasure_bg.wasm'),
    path.resolve(
      'node_modules/@digitaldefiance/reed-solomon-erasure.wasm/dist/reed_solomon_erasure_bg.wasm'
    ),
    './dist/workers/reed_solomon_erasure_bg.wasm',
    './node_modules/@digitaldefiance/reed-solomon-erasure.wasm/dist/reed_solomon_erasure_bg.wasm'
  ]

  let wasmBytes: Uint8Array | null = null
  let lastError: unknown = null
  for (const candidate of candidatePaths) {
    try {
      const bytes = fs.readFileSync(candidate)
      if (bytes && bytes.byteLength > 0) {
        wasmBytes = bytes
        break
      }
    } catch (err) {
      lastError = err
    }
  }

  if (!wasmBytes) {
    const detail = lastError instanceof Error ? lastError.message : String(lastError || '')
    throw new Error(
      '[ErasureCoding] Failed to locate reed_solomon_erasure_bg.wasm binary.' +
        (detail ? ` Last error: ${detail}` : '')
    )
  }

  rsInstance = ReedSolomonErasure.fromBytes(wasmBytes)
  return rsInstance
}
