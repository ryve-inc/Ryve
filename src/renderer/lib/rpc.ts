import type { BridgeApi } from '../../shared/types.ts'

export const WORKER = '/workers/main.cjs'
export const decoder = new TextDecoder('utf-8')
export const DEFAULT_RPC_TIMEOUT_MS = 120_000
export const LONG_RPC_TIMEOUT_MS = 30 * 60 * 1000

const pending = new Map<
  number,
  {
    resolve: (value: unknown) => void
    reject: (reason?: unknown) => void
    timer: ReturnType<typeof setTimeout>
  }
>()
let rpcSeq = 0

export function getBridge(): BridgeApi {
  if (!window.bridge) throw new Error('Native bridge unavailable')
  return window.bridge
}

export function rpc<T = unknown>(
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs = DEFAULT_RPC_TIMEOUT_MS
): Promise<T> {
  const bridge = getBridge()
  const id = ++rpcSeq
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!pending.has(id)) return
      pending.delete(id)
      reject(new Error(`RPC timed out: ${method}`))
    }, timeoutMs)
    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timer)
        resolve(value as T)
      },
      reject: (reason) => {
        clearTimeout(timer)
        reject(reason)
      },
      timer
    })
    Promise.resolve(
      bridge.writeWorkerIPC(WORKER, JSON.stringify({ type: 'rpc', id, method, params }))
    ).catch((err) => {
      const entry = pending.get(id)
      if (!entry) return
      pending.delete(id)
      clearTimeout(entry.timer)
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
  for (const [id, entry] of pending) {
    clearTimeout(entry.timer)
    entry.reject(new Error(reason))
    pending.delete(id)
  }
}
