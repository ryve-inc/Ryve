// Holepunch & Mobile packages without built-in types
declare module 'pear-runtime'
declare module 'framed-stream'
declare module 'paparam'
declare module 'b4a'
declare module 'hyperswarm'
declare module 'corestore'
declare module 'hyperdrive'
declare module 'hypercore-crypto'
declare module 'sodium-universal'
declare module 'compact-encoding'
declare module 'protomux-rpc'
declare module 'blind-peering'
declare module 'bare-storage'
declare module 'bare-fs'
declare module 'bare-path'
declare module 'hypercore-id-encoding'
declare module 'graceful-goodbye'

// React Native mobile modules
declare module 'react-native'
declare module 'react-native-safe-area-context'
declare module 'react-native-bare-kit'
declare module 'react-native-document-picker'
declare module 'react-native-fs'

declare module 'which-runtime' {
  const runtime: {
    isMac: boolean
    isLinux: boolean
    isWindows: boolean
    isBareKit: boolean
  }
  export = runtime
}


