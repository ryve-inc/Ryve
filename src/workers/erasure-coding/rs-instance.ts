// @ts-nocheck
import { ReedSolomonErasure } from '@digitaldefiance/reed-solomon-erasure.wasm'

export const DEFAULT_EC_K = 4
export const DEFAULT_EC_M = 2

let rsInstance: ReedSolomonErasure | null = null

export function getRSInstance(): ReedSolomonErasure {
  if (!rsInstance) {
    let fs: any
    let path: any

    if (typeof Bare !== 'undefined') {
      fs = require('bare-fs')
      path = require('bare-path')
    } else {
      const getBuiltin = (process as any).getBuiltinModule?.bind(process)
      if (getBuiltin) {
        fs = getBuiltin('fs')
        path = getBuiltin('path')
      } else {
        const mainReq = (process as any).mainModule?.require?.bind((process as any).mainModule)
        fs = mainReq ? mainReq('fs') : null
        path = mainReq ? mainReq('path') : null
      }
    }

    if (!fs || !path) {
      throw new Error('[ErasureCoding] Could not initialize filesystem module.')
    }

    const candidatePaths = [
      path.resolve('dist/workers/reed_solomon_erasure_bg.wasm'),
      path.resolve('node_modules/@digitaldefiance/reed-solomon-erasure.wasm/dist/reed_solomon_erasure_bg.wasm'),
      './dist/workers/reed_solomon_erasure_bg.wasm',
      './node_modules/@digitaldefiance/reed-solomon-erasure.wasm/dist/reed_solomon_erasure_bg.wasm'
    ]

    let wasmBytes: Uint8Array | null = null
    for (const p of candidatePaths) {
      try {
        wasmBytes = fs.readFileSync(p)
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
