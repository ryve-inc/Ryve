export type RpcHandler = (params: Record<string, unknown>) => Promise<unknown> | unknown

export type RpcPipe = {
  on(event: 'data', listener: (data: Uint8Array) => void): unknown
  write(data: string): unknown
}

export function withLockFactory() {
  let chain: Promise<unknown> = Promise.resolve()
  return function withLock<T>(fn: () => Promise<T> | T): Promise<T> {
    const run = chain.then(fn, fn)
    chain = run.catch(() => {})
    return run
  }
}

export function createRpcServer({
  pipe,
  handlers,
  lockedMethods,
  withLock,
  onControl
}: {
  pipe: RpcPipe
  handlers: Record<string, RpcHandler>
  lockedMethods: Set<string>
  withLock: <T>(fn: () => Promise<T> | T) => Promise<T>
  onControl?: (message: string) => Promise<boolean>
}): void {
  function emit(msg: unknown) {
    pipe.write(JSON.stringify(msg))
  }

  function reply(id: unknown, ok: boolean, result: unknown, error?: unknown) {
    emit({
      id,
      ok,
      result,
      error: error ? String(error instanceof Error ? error.message : error) : undefined
    })
  }

  pipe.on('data', async (data) => {
    const message = data.toString()
    if (onControl && (await onControl(message))) return

    let msg: { type?: string; id?: unknown; method?: string; params?: Record<string, unknown> }
    try {
      msg = JSON.parse(message) as typeof msg
    } catch {
      console.log(message)
      return
    }

    if (!msg || msg.type !== 'rpc') return
    const { id, method, params } = msg
    const handler = method ? handlers[method] : undefined
    if (!handler || !method) {
      reply(id, false, null, new Error('Unknown method: ' + method))
      return
    }

    const run = async () => {
      try {
        reply(id, true, await handler(params || {}))
      } catch (err) {
        console.error('rpc error', method, err)
        reply(id, false, null, err)
      }
    }

    if (lockedMethods.has(method)) await withLock(run)
    else await run()
  })
}
