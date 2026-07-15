// Holepunch packages ship without type declarations.
declare module 'pear-runtime'
declare module 'framed-stream'
declare module 'paparam'

declare module 'which-runtime' {
  const runtime: {
    isMac: boolean
    isLinux: boolean
    isWindows: boolean
    isBareKit: boolean
  }
  export = runtime
}
