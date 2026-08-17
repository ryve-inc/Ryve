import { decoder, getBridge, rejectAllPending, WORKER } from '@/lib/rpc'

type IpcListener = (data: Uint8Array) => void
type ExitListener = (code: number) => void

const ipcListeners = new Set<IpcListener>()
const exitListeners = new Set<ExitListener>()

let startPromise: Promise<void> | null = null
let detachBridge: (() => void) | null = null

function attachBridgeListeners() {
  detachBridge?.()
  const bridge = getBridge()
  const offStdout = bridge.onWorkerStdout(WORKER, (data) =>
    console.log('[worker]', decoder.decode(data))
  )
  const offStderr = bridge.onWorkerStderr(WORKER, (data) =>
    console.error('[worker]', decoder.decode(data))
  )
  const offIpc = bridge.onWorkerIPC(WORKER, (data) => {
    for (const listener of ipcListeners) listener(data)
  })
  const offExit = bridge.onWorkerExit(WORKER, (code) => {
    startPromise = null
    detachBridge?.()
    detachBridge = null
    rejectAllPending('Worker exited (' + code + ')')
    for (const listener of exitListeners) listener(code)
  })
  detachBridge = () => {
    offStdout()
    offStderr()
    offIpc()
    offExit()
  }
}

export function ensureWorkerStarted(): Promise<void> {
  if (startPromise) return startPromise
  attachBridgeListeners()
  startPromise = Promise.resolve(getBridge().startWorker(WORKER)).then(() => undefined)
  return startPromise
}

export function subscribeWorkerIpc(listener: IpcListener) {
  ipcListeners.add(listener)
  return () => {
    ipcListeners.delete(listener)
  }
}

export function subscribeWorkerExit(listener: ExitListener) {
  exitListeners.add(listener)
  return () => {
    exitListeners.delete(listener)
  }
}
