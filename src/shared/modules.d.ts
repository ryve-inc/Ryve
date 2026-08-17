// Stubs only for packages that ship no types and have no accurate @types/*.
// pear-runtime advertises index.d.ts but the published tarball omits the file.
// holepunch-types is unofficial and types hyperswarm.join() incorrectly (missing
// server/client options and flushed()), so those modules stay local.

declare module 'pear-runtime' {
  export type PearWorkerProcess = {
    stdout: {
      on(event: 'data', listener: (data: Uint8Array) => void): unknown
      removeListener(event: 'data', listener: (data: Uint8Array) => void): unknown
    }
    stderr: {
      on(event: 'data', listener: (data: Uint8Array) => void): unknown
      removeListener(event: 'data', listener: (data: Uint8Array) => void): unknown
    }
    once(event: 'exit', listener: (code: number) => void): unknown
  }

  export default class PearRuntime {
    constructor(opts: Record<string, unknown>)
    static run(entry: string, args: unknown[]): PearWorkerProcess
    storage?: string
    updater: {
      on(event: string, listener: (...args: unknown[]) => void): unknown
      drive: { core: { discoveryKey: Uint8Array } }
      applyUpdate(): Promise<void>
    }
    ready(): Promise<void>
    close(): Promise<void>
  }
}

declare module 'framed-stream' {
  export default class FramedStream {
    constructor(stream: unknown)
    on(event: 'data', listener: (data: Uint8Array) => void): this
    write(data: string | Uint8Array): unknown
    destroy(): void
    removeListener(event: string, listener: (data: Uint8Array) => void): this
  }
}

declare module 'paparam' {
  export function command(
    name: string,
    ...flags: unknown[]
  ): {
    parse(argv: string[]): void
    flags: Record<string, unknown>
  }
  export function flag(spec: string, help?: string): { hide(): unknown }
}

declare module 'which-runtime' {
  export const isMac: boolean
  export const isLinux: boolean
  export const isWindows: boolean
  export const isBareKit: boolean
  const runtime: {
    isMac: boolean
    isLinux: boolean
    isWindows: boolean
    isBareKit: boolean
  }
  export default runtime
}

declare module 'bare-storage' {
  const dir: { persistent(): string }
  export default dir
}

declare module 'hypercore-crypto' {
  const hypercoreCrypto: {
    hash(data: Uint8Array): Uint8Array
    randomBytes(n: number): Uint8Array
  }
  export default hypercoreCrypto
}

declare module 'hypercore-id-encoding' {
  const idEnc: {
    normalize(key: string | Uint8Array): string
  }
  export default idEnc
}

declare module 'sodium-universal' {
  const sodium: {
    crypto_hash_sha256(out: Uint8Array, data: Uint8Array): void
    crypto_secretbox_NONCEBYTES: number
    crypto_secretbox_MACBYTES: number
    randombytes_buf(out: Uint8Array): void
    crypto_secretbox_easy(
      ciphertext: Uint8Array,
      message: Uint8Array,
      nonce: Uint8Array,
      key: Uint8Array
    ): void
    crypto_secretbox_open_easy(
      message: Uint8Array,
      ciphertext: Uint8Array,
      nonce: Uint8Array,
      key: Uint8Array
    ): boolean
  }
  export default sodium
}

declare module 'hyperswarm' {
  export type SwarmConnection = {
    on(event: 'close', listener: () => void): unknown
  }

  export default class Hyperswarm {
    connections: Set<SwarmConnection>
    dht?: { on: (event: string, listener: (...args: unknown[]) => void) => unknown }
    on(event: 'connection', listener: (conn: SwarmConnection) => void): this
    off(event: 'connection', listener: (conn: SwarmConnection) => void): this
    join(
      topic: Uint8Array,
      opts?: { server?: boolean; client?: boolean }
    ): { flushed(): Promise<void>; destroy(): Promise<void> }
    destroy(): Promise<void>
  }
}

declare module 'corestore' {
  export default class Corestore {
    constructor(path: string, opts?: { primaryKey?: Uint8Array; unsafe?: boolean })
    ready(): Promise<void>
    close(): Promise<void>
    namespace(name: string): Corestore
    replicate(stream: unknown): unknown
  }
}

declare module 'hyperdrive' {
  export default class Hyperdrive {
    constructor(store: unknown, opts?: { encryptionKey?: Uint8Array })
    ready(): Promise<void>
    close(): Promise<void>
    key: Uint8Array
    discoveryKey: Uint8Array
    core: unknown
    blobs?: { core: { clear(start: number, end: number): Promise<void> } }
    entry(path: string): Promise<{ value?: Record<string, unknown> } | null>
    put(path: string, data: Uint8Array, opts?: { metadata?: unknown }): Promise<void>
    del(path: string): Promise<void>
    list(
      folder: string,
      opts?: { recursive?: boolean }
    ): AsyncIterable<{ key: string; value?: Record<string, unknown> }>
  }
}

declare module 'blind-peering' {
  export default class BlindPeering {
    constructor(swarm: unknown, store: unknown, opts: { keys: string[] })
    addCore(core: unknown, target: unknown, opts?: unknown): Promise<void>
    close(): Promise<void>
  }
}

declare module 'graceful-goodbye' {
  export default function goodbye(fn: () => Promise<void> | void): void
}

declare module 'protomux-rpc' {
  export default class ProtomuxRPC {
    constructor(stream: unknown, opts: { protocol: string; valueEncoding: unknown })
    closed?: boolean
    respond(method: string, handler: (req: unknown) => Promise<unknown> | unknown): void
    request(method: string, value: unknown, opts?: { timeout?: number }): Promise<unknown>
    destroy(): void
  }
}

declare module 'compact-encoding' {
  type Codec<T> = {
    preencode(state: unknown, value: T): void
    encode(state: unknown, value: T): void
    decode(state: unknown): T
  }
  const c: {
    json: Codec<unknown>
    string: Codec<string>
    buffer: Codec<Uint8Array>
    bool: Codec<boolean>
    uint: Codec<number>
  }
  export default c
}
