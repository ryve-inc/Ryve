/**
 * mobile-bridge.ts
 *
 * Mirrors the role of src/electron/preload.ts on mobile.
 * Uses react-native-bare-kit Worklet to host the P2P worker and provides
 * an RPC interface identical to the desktop bridge so all logic in
 * drive-context can be reused verbatim.
 */
import { Worklet } from 'react-native-bare-kit'
import b4a from 'b4a'

// The pre-bundled Bare worker (output of `bare-pack`)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const workerBundle = require('../../android/app/src/main/assets/worker.bundle')

type Listener<T> = (data: T) => void

const ipcListeners = new Set<Listener<Uint8Array>>()
const exitListeners = new Set<Listener<number>>()

let worklet: InstanceType<typeof Worklet> | null = null
let started = false
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
let seq = 0

function toBuffer(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data
  if (typeof data === 'string') return b4a.from(data) as Uint8Array
  return b4a.from(data as ArrayBuffer) as Uint8Array
}

/** Start the Bare worker once. Safe to call multiple times. */
export function ensureWorkerStarted(): Promise<void> {
  if (started) return Promise.resolve()
  started = true
  worklet = new Worklet()

  // worklet.IPC is an EventEmitter-like interface identical to Electron FramedStream
  worklet.IPC.on('data', (data: Uint8Array) => {
    for (const l of ipcListeners) l(data)
  })

  // For the bundle approach: worklet.start(filename, bundleSource)
  // filename extension .bundle is required by react-native-bare-kit
  worklet.start('/worker.bundle', workerBundle)
  return Promise.resolve()
}

export function subscribeWorkerIpc(listener: Listener<Uint8Array>) {
  ipcListeners.add(listener)
  return () => ipcListeners.delete(listener)
}

export function subscribeWorkerExit(listener: Listener<number>) {
  exitListeners.add(listener)
  return () => exitListeners.delete(listener)
}

export function writeWorkerIPC(data: string | Uint8Array): void {
  if (!worklet) throw new Error('Worker not started')
  worklet.IPC.write(typeof data === 'string' ? b4a.from(data) : data)
}

/** Promise-based JSON-RPC over the Bare IPC channel. */
export function rpc<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  const id = ++seq
  return new Promise<T>((resolve, reject) => {
    pending.set(id, {
      resolve: resolve as (v: unknown) => void,
      reject
    })
    writeWorkerIPC(JSON.stringify({ type: 'rpc', id, method, params }))
  })
}

/** Called by the IPC subscription handler in DriveContext to settle RPC promises. */
export function settlePending(id: number, ok: boolean, result: unknown, error?: string): boolean {
  const entry = pending.get(id)
  if (!entry) return false
  pending.delete(id)
  if (ok) entry.resolve(result)
  else entry.reject(new Error(error || 'RPC failed'))
  return true
}

export function rejectAllPending(reason: string): void {
  for (const [id, { reject }] of pending) {
    reject(new Error(reason))
    pending.delete(id)
  }
}

export const decoder = new TextDecoder('utf-8')
