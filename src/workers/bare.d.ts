export {}

declare global {
  const Bare: {
    argv: string[]
    IPC: unknown
  }

  const __dirname: string

  function require(name: string): unknown

  const process: {
    getBuiltinModule?: (name: string) => unknown
    mainModule?: { require: (name: string) => unknown }
  }

  const console: {
    log(...args: unknown[]): void
    error(...args: unknown[]): void
    warn(...args: unknown[]): void
  }
}
