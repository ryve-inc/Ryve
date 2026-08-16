import { ReedSolomonErasure } from '@digitaldefiance/reed-solomon-erasure.wasm'

function getModule(name: string): any {
  if (typeof require !== 'undefined') {
    try { return require(name) } catch {}
  }
  return null
}


export const DEFAULT_EC_K = 4
export const DEFAULT_EC_M = 2

let rsInstance: ReedSolomonErasure | null = null

export function getRSInstance(): ReedSolomonErasure {
  if (!rsInstance) {
    const fsModule = getModule('bare-fs') || getModule('fs')
    const pathModule = getModule('bare-path') || getModule('path')



    if (!fsModule || !pathModule) {
      throw new Error('[ErasureCoding] Could not initialize filesystem module.')
    }

    const candidatePaths = [
      pathModule.resolve('dist/workers/reed_solomon_erasure_bg.wasm'),
      pathModule.resolve('node_modules/@digitaldefiance/reed-solomon-erasure.wasm/dist/reed_solomon_erasure_bg.wasm'),
      './dist/workers/reed_solomon_erasure_bg.wasm',
      './node_modules/@digitaldefiance/reed-solomon-erasure.wasm/dist/reed_solomon_erasure_bg.wasm'
    ]

    let wasmBytes: Uint8Array | null = null
    for (const p of candidatePaths) {
      try {
        wasmBytes = fsModule.readFileSync(p)
        if (wasmBytes && wasmBytes.byteLength > 0) break
      } catch {}
    }

    if (!wasmBytes) {
      throw new Error('[ErasureCoding] Failed to locate reed_solomon_erasure_bg.wasm binary.')
    }

    rsInstance = ReedSolomonErasure.fromBytes(wasmBytes)
  }
  return rsInstance
}

