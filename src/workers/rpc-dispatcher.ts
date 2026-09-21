import b4a from 'b4a'
import {
  createAccount,
  unlockFromMnemonic,
  publicIdentity,
  createNetworkKey,
  parseNetworkLink,
  deriveNetworkKeys
} from './identity'
import {
  saveSettings,
  clearSession,
  saveNetworks,
  createBlindClient,
  normalizeBlindKeys,
  pinCore
} from './blind'
import type { State } from './state'
import { statusPayload } from './state'
import { joinNetworkTopics, joinAllSavedNetworks } from './network-manager'
import { openVault, closeVault } from './vault-lifecycle'

export const mutateMethods = new Set([
  'createNetwork',
  'joinNetwork',
  'confirmCreateAccount',
  'unlock',
  'logout',
  'upload',
  'download',
  'delete',
  'mkdir',
  'setBlindPeers',
  'setStorageQuota',
  'setNetworkStorageAllocation'
])

export function inferMimeType(name: string, fallbackMime: string | null): string {
  if (fallbackMime && fallbackMime !== 'application/octet-stream') return fallbackMime
  const ext = name.split('.').pop()?.toLowerCase() || ''
  switch (ext) {
    // Images
    case 'png': return 'image/png'
    case 'jpg':
    case 'jpeg':
    case 'jpe':
    case 'jfif':
    case 'pjpeg':
    case 'pjp': return 'image/jpeg'
    case 'gif': return 'image/gif'
    case 'webp': return 'image/webp'
    case 'svg':
    case 'svgz': return 'image/svg+xml'
    case 'bmp':
    case 'dib': return 'image/bmp'
    case 'ico':
    case 'cur': return 'image/x-icon'
    case 'avif': return 'image/avif'
    case 'apng': return 'image/apng'
    case 'tif':
    case 'tiff': return 'image/tiff'

    // Videos
    case 'mp4':
    case 'm4v': return 'video/mp4'
    case 'webm': return 'video/webm'
    case 'mkv': return 'video/webm' // EBML container compatibility in Chromium
    case 'mov':
    case 'qt': return 'video/mp4'
    case 'ogv': return 'video/ogg'
    case 'avi': return 'video/x-msvideo'
    case 'wmv': return 'video/x-ms-wmv'
    case 'flv':
    case 'f4v': return 'video/x-flv'
    case 'm2ts': return 'video/mp2t'
    case '3gp': return 'video/3gpp'
    case '3g2': return 'video/3gpp2'
    case 'mpg':
    case 'mpeg':
    case 'mpe':
    case 'mpv':
    case 'm2v':
    case 'vob': return 'video/mpeg'

    // Audio
    case 'mp3': return 'audio/mpeg'
    case 'wav':
    case 'wave': return 'audio/wav'
    case 'ogg':
    case 'oga':
    case 'opus': return 'audio/ogg'
    case 'aac': return 'audio/aac'
    case 'm4a': return 'audio/mp4'
    case 'flac': return 'audio/flac'
    case 'weba': return 'audio/webm'
    case 'wma': return 'audio/x-ms-wma'
    case 'aiff':
    case 'aif':
    case 'aifc': return 'audio/aiff'
    case 'mid':
    case 'midi': return 'audio/midi'
    case 'amr': return 'audio/amr'
    case 'ac3': return 'audio/ac3'
    case 'eac3': return 'audio/eac3'

    // PDF
    case 'pdf': return 'application/pdf'

    // Text & Code
    case 'txt':
    case 'text':
    case 'log':
    case 'err':
    case 'out':
    case 'msg':
    case 'nfo':
    case 'rtf':
    case 'conf':
    case 'cfg':
    case 'ini':
    case 'env':
    case 'properties':
    case 'gitignore':
    case 'gitattributes':
    case 'dockerignore':
    case 'editorconfig': return 'text/plain'

    case 'md':
    case 'markdown':
    case 'mdown':
    case 'mkdn':
    case 'rst':
    case 'tex':
    case 'asciidoc':
    case 'adoc': return 'text/markdown'

    case 'json':
    case 'jsonc':
    case 'json5': return 'application/json'

    case 'js':
    case 'mjs':
    case 'cjs': return 'text/javascript'

    case 'ts':
    case 'mts':
    case 'cts':
    case 'tsx':
    case 'jsx': return 'text/typescript'

    case 'html':
    case 'htm':
    case 'xhtml':
    case 'shtml':
    case 'vue':
    case 'svelte': return 'text/html'

    case 'css':
    case 'scss':
    case 'sass':
    case 'less': return 'text/css'

    case 'csv':
    case 'tsv':
    case 'tab': return 'text/csv'

    case 'py':
    case 'pyw':
    case 'ipynb': return 'text/x-python'

    case 'sh':
    case 'bash':
    case 'zsh':
    case 'ksh':
    case 'csh':
    case 'tcsh':
    case 'fish':
    case 'bat':
    case 'cmd':
    case 'ps1':
    case 'psm1': return 'text/x-sh'

    case 'rs': return 'text/rust'
    case 'go': return 'text/x-go'
    case 'c':
    case 'h': return 'text/x-c'
    case 'cpp':
    case 'cc':
    case 'cxx':
    case 'hpp':
    case 'hxx': return 'text/x-c++'
    case 'cs':
    case 'csx': return 'text/x-csharp'
    case 'java':
    case 'kt':
    case 'kts': return 'text/x-java'
    case 'swift': return 'text/x-swift'
    case 'd': return 'text/x-d'
    case 'dart': return 'text/x-dart'
    case 'lua': return 'text/x-lua'
    case 'pl':
    case 'pm': return 'text/x-perl'
    case 'r':
    case 'rmd': return 'text/x-r'
    case 'sql': return 'text/x-sql'
    case 'rb': return 'text/x-ruby'
    case 'php':
    case 'phtml': return 'text/x-php'
    case 'xml': return 'text/xml'
    case 'yaml':
    case 'yml': return 'text/yaml'
    case 'toml': return 'text/x-toml'
    case 'diff':
    case 'patch': return 'text/x-diff'
    case 'proto': return 'text/x-protobuf'
    case 'graphql':
    case 'gql': return 'text/x-graphql'
    case 'zig': return 'text/x-zig'
    case 'nim': return 'text/x-nim'
    case 'clj':
    case 'cljs':
    case 'edn': return 'text/x-clojure'
    case 'ex':
    case 'exs': return 'text/x-elixir'
    case 'erl':
    case 'hrl': return 'text/x-erlang'
    case 'hs':
    case 'lhs': return 'text/x-haskell'
    case 'ml':
    case 'mli': return 'text/x-ocaml'
    case 'fs':
    case 'fsi':
    case 'fsx': return 'text/x-fsharp'
    case 'v':
    case 'sv':
    case 'vhd':
    case 'vhdl': return 'text/x-hdl'
    case 'asm':
    case 's': return 'text/x-asm'

    default: return fallbackMime || 'application/octet-stream'
  }
}

function isBufferText(buf: Uint8Array): boolean {
  const len = Math.min(buf.byteLength, 4096)
  if (len === 0) return true
  for (let i = 0; i < len; i++) {
    if (buf[i] === 0) return false
  }
  try {
    const dec = new TextDecoder('utf-8', { fatal: true })
    dec.decode(buf.subarray(0, len))
    return true
  } catch {
    return false
  }
}

export function createRpcHandlers(
  state: State,
  swarm: any,
  storageDir: string,
  publicCatalog: any,
  emit: (msg: unknown) => void
): Record<string, (params: any) => Promise<any>> {
  return {
    async getStatus() {
      return statusPayload(state)
    },

    async createNetwork({ name }: { name?: string } = {}) {
      let primaryKey = state.primaryKey
      let encryptionKey = state.encryptionKey
      if (!primaryKey || !encryptionKey) {
        const acct = createAccount()
        primaryKey = acct.primaryKey
        encryptionKey = acct.encryptionKey
      }

      const { networkKeyHex, networkLink } = createNetworkKey(name)
      const derived = deriveNetworkKeys(networkKeyHex, name)
      await openVault(state, swarm, storageDir, publicCatalog, {
        primaryKey,
        encryptionKey,
        networkKeyHex,
        networkLink,
        swarmTopic: derived.swarmTopic,
        swarmChunkTopic: derived.swarmChunkTopic,
        topicHex: derived.topicHex,
        netName: name
      })
      return { status: statusPayload(state), networkLink, networkKeyHex }
    },

    async joinNetwork({ link, name }: { link: string; name?: string }) {
      if (!link) throw new Error('Enter a valid network invite link.')
      let primaryKey = state.primaryKey
      let encryptionKey = state.encryptionKey
      if (!primaryKey || !encryptionKey) {
        const acct = createAccount()
        primaryKey = acct.primaryKey
        encryptionKey = acct.encryptionKey
      }

      const { networkKeyHex, name: parsedName } = parseNetworkLink(link)
      const finalName = name || parsedName || undefined
      const derived = deriveNetworkKeys(networkKeyHex, finalName)
      await openVault(state, swarm, storageDir, publicCatalog, {
        primaryKey,
        encryptionKey,
        networkKeyHex,
        networkLink: derived.networkLink,
        swarmTopic: derived.swarmTopic,
        swarmChunkTopic: derived.swarmChunkTopic,
        topicHex: derived.topicHex,
        netName: finalName
      })
      return { status: statusPayload(state), networkLink: derived.networkLink, networkKeyHex }
    },

    async switchNetwork({ id }: { id: string }) {
      const target = state.networks.find((n) => n.id === id)
      if (!target) throw new Error('Network not found.')
      if (!state.primaryKey || !state.encryptionKey) throw new Error('Not unlocked.')

      state.activeNetworkId = id
      state.networkKeyHex = target.networkKeyHex
      state.networkLink = target.networkLink
      state.topicHex = target.topicHex

      if (state.vault) {
        state.vault.networkKeyHex = target.networkKeyHex
      }

      if (!state.joinedTopics.has(id)) {
        const derived = deriveNetworkKeys(target.networkKeyHex, target.name)
        await joinNetworkTopics(state, swarm, id, derived.swarmTopic, derived.swarmChunkTopic)
      }

      return statusPayload(state)
    },

    async removeNetwork({ id }: { id: string }) {
      const targetNet = state.networks.find((n) => n.id === id)
      const handles = state.joinedTopics.get(id)
      if (handles) {
        await handles.networkDiscovery.destroy().catch(() => { })
        await handles.chunkDiscovery.destroy().catch(() => { })
        state.joinedTopics.delete(id)
        if (state.chunkStore) {
          await state.chunkStore.leaveNetwork(id)
        }
      }

      state.networks = state.networks.filter((n) => n.id !== id)
      await saveNetworks(storageDir, state.networks)
      if (state.storageManager) {
        state.storageManager.removeNetwork(id, targetNet?.networkKeyHex)
      }

      if (state.activeNetworkId === id) {
        if (state.networks.length > 0) {
          const nextNet = state.networks[0]
          state.activeNetworkId = nextNet.id
          state.networkKeyHex = nextNet.networkKeyHex
          state.networkLink = nextNet.networkLink
          state.topicHex = nextNet.topicHex
          if (state.vault) state.vault.networkKeyHex = nextNet.networkKeyHex
        } else {
          state.activeNetworkId = null
          state.networkKeyHex = null
          state.networkLink = null
          state.topicHex = null
        }
      }
      return statusPayload(state)
    },

    async createAccount() {
      const account = createAccount()
      return {
        mnemonic: account.mnemonic,
        previewIdentity: b4a.toString(publicIdentity(account.primaryKey), 'hex')
      }
    },

    async confirmCreateAccount({ mnemonic, displayName }: { mnemonic: string; displayName?: string }) {
      const keys = unlockFromMnemonic(mnemonic)
      if (displayName) {
        state.displayName = displayName
        state.settings.displayName = displayName
        await saveSettings(storageDir, state.settings)
      }
      const status = await openVault(state, swarm, storageDir, publicCatalog, keys)
      await joinAllSavedNetworks(state, swarm)
      return { status, mnemonic }
    },

    async unlock({ mnemonic, displayName }: { mnemonic: string; displayName?: string }) {
      const keys = unlockFromMnemonic(mnemonic)
      if (displayName) {
        state.displayName = displayName
        state.settings.displayName = displayName
        await saveSettings(storageDir, state.settings)
      }
      const status = await openVault(state, swarm, storageDir, publicCatalog, keys)
      await joinAllSavedNetworks(state, swarm)
      return { status }
    },

    async logout() {
      await closeVault(state)
      state.unlocked = false
      state.primaryKey = null
      state.encryptionKey = null
      state.identityHex = null
      state.networkKeyHex = null
      state.networkLink = null
      state.topicHex = null
      state.activeNetworkId = null
      await clearSession(storageDir)
      emit({ type: 'event', name: 'auth', data: { needsAuth: true, status: statusPayload(state) } })
      return { needsAuth: true }
    },

    async list({ dir: listDir = '/' } = {}) {
      if (!state.vault) throw new Error('Not unlocked')
      return state.vault.list(listDir)
    },

    async mkdir({ path: dirPath }: { path: string }) {
      if (!state.vault) throw new Error('Not unlocked')
      return state.vault.mkdir(dirPath)
    },

    async upload({ localPath, destPath, mime, isPrivate }: { localPath: string; destPath: string; mime?: string; isPrivate?: boolean }) {
      if (!state.vault) throw new Error('Not unlocked')
      const res = await state.vault.upload(localPath, destPath, mime, isPrivate !== false, state.identityHex)
      emit({ type: 'event', name: 'status', data: statusPayload(state) })
      return res
    },

    async download({ path: entryPath, destLocalPath }: { path: string; destLocalPath: string }) {
      if (!state.vault) throw new Error('Not unlocked')
      return state.vault.download(entryPath, destLocalPath)
    },

    async preview({ path: entryPath }: { path: string }) {
      if (!state.vault) throw new Error('Not unlocked')
      const { buffer, mime: rawMime, name } = await state.vault.readBuffer(entryPath)
      const mime = inferMimeType(name, rawMime)
      const ext = name.split('.').pop()?.toLowerCase() || ''

      const isImage = mime.startsWith('image/') || /\.(png|jpe?g|jpe|jfif|pjpeg|pjp|gif|webp|svg|svgz|bmp|dib|ico|cur|avif|apng|tif|tiff)$/i.test(name)
      const isVideo = mime.startsWith('video/') || /\.(mp4|m4v|mkv|webm|mov|qt|avi|wmv|flv|f4v|ts|m2ts|mts|3gp|3g2|ogv|ogg|mpg|mpeg|mpe|mpv|m2v|vob)$/i.test(name)
      const isAudio = mime.startsWith('audio/') || /\.(mp3|wav|wave|ogg|oga|opus|aac|flac|m4a|weba|wma|aiff|aif|aifc|mid|midi|amr|ac3|eac3)$/i.test(name)
      const isPdf = mime === 'application/pdf' || ext === 'pdf'

      const isTextByExt = mime.startsWith('text/') || mime === 'application/json' || /\.(txt|text|log|err|out|msg|nfo|rtf|conf|cfg|ini|env|properties|gitignore|gitattributes|dockerignore|editorconfig|md|markdown|mdown|mkdn|rst|tex|asciidoc|adoc|json|jsonc|json5|js|mjs|cjs|ts|mts|cts|tsx|jsx|html|htm|xhtml|shtml|vue|svelte|css|scss|sass|less|csv|tsv|tab|py|pyw|ipynb|sh|bash|zsh|ksh|csh|tcsh|fish|bat|cmd|ps1|psm1|rs|go|c|h|cpp|cc|cxx|hpp|hxx|cs|csx|java|kt|kts|swift|d|dart|lua|pl|pm|r|rmd|sql|rb|php|phtml|xml|yaml|yml|toml|diff|patch|proto|graphql|gql|zig|nim|clj|cljs|edn|ex|exs|erl|hrl|hs|lhs|ml|mli|fs|fsi|fsx|v|sv|vhd|vhdl|asm|s)$/i.test(name)

      const isText = isTextByExt || isBufferText(buffer)

      const supported = isImage || isVideo || isAudio || isPdf || isText

      if (!supported) {
        return {
          supported: false,
          mime,
          name,
          byteLength: buffer.byteLength
        }
      }

      if (isText) {
        let textContent: string
        try {
          textContent = b4a.toString(buffer, 'utf-8')
        } catch {
          textContent = ''
        }
        return {
          supported: true,
          isText: true,
          content: textContent,
          mime: mime.startsWith('text/') ? mime : 'text/plain',
          name,
          byteLength: buffer.byteLength
        }
      }

      const base64Data = b4a.toString(buffer, 'base64')
      return {
        supported: true,
        isText: false,
        data: base64Data,
        mime,
        name,
        byteLength: buffer.byteLength
      }
    },

    async delete({ path: entryPath }: { path: string }) {
      if (!state.vault) throw new Error('Not unlocked')
      const res = await state.vault.delete(entryPath, state.identityHex)
      emit({ type: 'event', name: 'status', data: statusPayload(state) })
      return res
    },

    async getChunkManifest({ path: entryPath }: { path: string }) {
      if (!state.vault) throw new Error('Not unlocked')
      return state.vault.getManifest(entryPath)
    },

    async setBlindPeers({ keys }: { keys: string[] }) {
      state.settings.blindPeerKeys = normalizeBlindKeys(keys)
      await saveSettings(storageDir, state.settings)
      if (state.blinds) await state.blinds.close().catch(() => { })
      if (state.vaultStore) {
        state.blinds = createBlindClient(swarm, state.vaultStore, state.settings.blindPeerKeys)
        if (state.vault?.drive) {
          await pinCore(state.blinds, state.vault.drive.core)
          if (state.vault.drive.blobs?.core) {
            await pinCore(state.blinds, state.vault.drive.blobs.core)
          }
        }
      }
      return statusPayload(state)
    },

    async setNetworkStorageAllocation({ id, allocatedBytes }: { id: string; allocatedBytes: number }) {
      if (!id || typeof allocatedBytes !== 'number' || allocatedBytes <= 0) {
        throw new Error('Invalid storage allocation parameters.')
      }
      if (!state.storageManager) throw new Error('Storage manager not initialized')
      const res = await state.storageManager.setNetworkAllocation(id, allocatedBytes, state.networks)
      const idx = state.networks.findIndex((n) => n.id === id)
      if (idx >= 0) {
        state.networks[idx].allocatedBytes = res.allocatedBytes
        await saveNetworks(storageDir, state.networks)

        const netKey = state.networks[idx].networkKeyHex
        if (netKey && state.chunkStore) {
          const used = state.storageManager.getUsedBytesForNetwork(netKey)
          const avail = await state.storageManager.getAvailableBytesForNetwork(netKey)
          state.chunkStore.broadcastStorageUpdate(netKey, res.allocatedBytes, used, avail).catch(() => {})
        }
      }
      emit({ type: 'event', name: 'status', data: statusPayload(state) })
      return statusPayload(state)
    },

    async setStorageQuota({ mode, quotaBytes }: { mode: 'limited' | 'all'; quotaBytes?: number }) {
      state.settings.storageQuotaMode = mode
      state.settings.storageQuotaBytes = quotaBytes
      await saveSettings(storageDir, state.settings)
      emit({ type: 'event', name: 'status', data: statusPayload(state) })
      return statusPayload(state)
    },

    async getStorageInfo() {
      if (!state.storageManager) throw new Error('Storage manager not initialized')
      return state.storageManager.getStorageInfo(state.networks)
    }
  }
}

export function setupRpcDispatcher({
  pipe,
  handlers,
  pear,
  withLock,
  reply
}: {
  pipe: any
  handlers: Record<string, (params: any) => Promise<any>>
  pear: any
  withLock: <T>(fn: () => Promise<T>) => Promise<T>
  reply: (id: number, ok: boolean, result: unknown, error?: unknown) => void
}) {
  pipe.on('data', async (data: any) => {
    const message = data.toString()
    if (message === 'pear:applyUpdate') {
      await pear.ready()
      await pear.updater.applyUpdate()
      pipe.write('pear:updateApplied')
      return
    }

    let msg: any
    try {
      msg = JSON.parse(message)
    } catch {
      console.log(message)
      return
    }

    if (!msg || msg.type !== 'rpc') return
    const { id, method, params } = msg
    const handler = handlers[method]
    if (!handler) {
      reply(id, false, null, new Error('Unknown method: ' + method))
      return
    }

    const run = async () => {
      try {
        const result = await handler(params || {})
        reply(id, true, result)
      } catch (err) {
        console.error('rpc error', method, err)
        reply(id, false, null, err)
      }
    }

    if (mutateMethods.has(method)) await withLock(run)
    else await run()
  })
}
