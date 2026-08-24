import type { BridgeApi } from '../../shared/types.ts'

export const WORKER = '/workers/main.cjs'
export const decoder = new TextDecoder('utf-8')

const pending = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (reason?: unknown) => void }
>()
let rpcSeq = 0

export function getBridge(): BridgeApi {
  if (!window.bridge) throw new Error('Electron bridge API unavailable')
  return window.bridge
}


export function rpc<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  const bridge = getBridge()
  const id = ++rpcSeq
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
    Promise.resolve(
      bridge.writeWorkerIPC(WORKER, JSON.stringify({ type: 'rpc', id, method, params }))
    ).catch((err) => {
      pending.delete(id)
      reject(err instanceof Error ? err : new Error(String(err)))
    })
  })
}

export function settlePending(id: number, ok: boolean, result: unknown, error?: string) {
  const entry = pending.get(id)
  if (!entry) return false
  pending.delete(id)
  if (ok) entry.resolve(result)
  else entry.reject(new Error(error || 'Request failed'))
  return true
}

export function rejectAllPending(reason: string) {
  for (const [id, { reject }] of pending) {
    reject(new Error(reason))
    pending.delete(id)
  }
}
