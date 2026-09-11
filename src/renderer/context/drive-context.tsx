import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import type { AppStatus, ChunkManifest, DriveEntry } from '../../shared/types.ts'

import { assertEntryName, formatBytes, joinPath, normalizeMnemonic } from '@/lib/format'
import { decoder, getBridge, rpc, settlePending } from '@/lib/rpc'
import {
  ensureWorkerStarted,
  subscribeWorkerExit,
  subscribeWorkerIpc
} from '@/lib/worker-bridge'

export type AuthPanel = 'boot' | 'home' | 'name' | 'create' | 'confirm' | 'unlock'
export type NavName = 'home' | 'files' | 'shared' | 'settings'

export type SelectedEntry = {
  path: string
  source: 'vault' | 'share'
  shareId?: string | null
  manifest?: ChunkManifest
}

export type InviteModalState = {
  open: boolean
  title: string
  body: string
  invite: string
}

export type PromptMode = 'text' | 'confirm' | 'choice'

export type PromptChoice = { label: string; value: string }

export type PromptState = {
  open: boolean
  title: string
  body: string
  defaultValue: string
  okLabel: string
  cancelLabel: string
  mode: PromptMode
  choices: PromptChoice[]
}

type DriveContextValue = {
  status: AppStatus
  view: 'auth' | 'app'
  authPanel: AuthPanel
  authFlowActive: boolean
  pendingMnemonic: string
  displayName: string
  setDisplayName: (val: string) => void
  currentNav: NavName
  currentDir: string
  entries: DriveEntry[]
  selectedEntry: SelectedEntry | null
  detailOpen: boolean
  detailName: string
  detailMeta: string
  chunkList: string
  toast: string | null
  prompt: PromptState
  dragging: boolean
  createNetworkModal: { open: boolean; inviteLink: string }
  joinNetworkModal: { open: boolean }
  networkInfoModal: { open: boolean }
  setDragging: (value: boolean) => void
  showToast: (msg: string) => void
  setAuthPanel: (panel: AuthPanel) => void
  setPendingMnemonic: (value: string) => void
  setAuthFlowActive: (value: boolean) => void
  navigate: (name: NavName) => void
  refreshFiles: () => Promise<void>
  setCurrentDir: (dir: string) => void
  onEntryClick: (entry: DriveEntry) => Promise<void>
  showDetail: (path: string) => Promise<void>
  closeDetail: () => void
  uploadPaths: (opts?: { isPrivate?: boolean }) => Promise<void>
  uploadFiles: (fileList: FileList | File[], opts?: { isPrivate?: boolean }) => Promise<void>
  switchNetwork: (id: string) => Promise<void>
  removeNetwork: (id: string) => Promise<void>
  askDialog: (opts: {
    title: string
    body?: string
    defaultValue?: string
    okLabel?: string
    cancelLabel?: string
    mode?: PromptMode
    choices?: PromptChoice[]
  }) => Promise<string | boolean | null>
  askText: (title: string, defaultValue?: string, body?: string) => Promise<string | null>
  askConfirm: (title: string, body?: string) => Promise<boolean>
  closePrompt: (value: string | boolean | null) => void
  resolveAuth: (unlocked: boolean, nextStatus?: AppStatus | null) => void
  showAuthHome: () => void
  showApp: () => void
  createNetwork: (name?: string) => Promise<unknown>
  joinNetwork: (link: string) => Promise<void>
  openCreateNetworkModal: (inviteLink: string) => void
  closeCreateNetworkModal: () => void
  openJoinNetworkModal: () => void
  closeJoinNetworkModal: () => void
  openNetworkInfoModal: () => void
  closeNetworkInfoModal: () => void
  createAccount: (name?: string) => Promise<void>
  confirmCreateAccount: (typed: string) => Promise<void>
  unlock: (mnemonic: string) => Promise<void>
  logout: () => Promise<void>
  saveBlindPeers: (keysText: string) => Promise<void>
  mkdir: (name: string) => Promise<void>
  downloadSelected: () => Promise<void>
  previewSelected: () => Promise<void>
  previewModal: {
    open: boolean
    name: string
    url: string | null
    mime: string | null
    content: string | null
    error: string | null
  }
  closePreviewModal: () => void
  deleteSelected: () => Promise<void>
  copyClipboard: (text: string) => void
  setStorageQuota: (mode: 'limited' | 'all', quotaBytes?: number) => Promise<void>
}

const emptyStatus: AppStatus = {
  unlocked: false,
  identity: null,
  displayName: null,
  driveKey: null,
  peers: 0,
  blindPeerKeys: [],
  network: {
    networkLink: null,
    networkKeyHex: null,
    topicHex: null,
    joined: false,
    activeId: null,
    networks: []
  },
  storage: {
    quotaMode: 'limited',
    quotaBytes: 10 * 1024 * 1024 * 1024,
    usedBytes: 0,
    availableBytes: 10 * 1024 * 1024 * 1024,
    freeDiskBytes: 50 * 1024 * 1024 * 1024
  }
}


const closedInvite: InviteModalState = {
  open: false,
  title: '',
  body: '',
  invite: ''
}

const closedPrompt: PromptState = {
  open: false,
  title: '',
  body: '',
  defaultValue: '',
  okLabel: 'OK',
  cancelLabel: 'Cancel',
  mode: 'text',
  choices: []
}

const DriveContext = createContext<DriveContextValue | null>(null)

export function DriveProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AppStatus>(emptyStatus)
  const [view, setView] = useState<'auth' | 'app'>('auth')
  const [authPanel, setAuthPanel] = useState<AuthPanel>('boot')
  const [authFlowActive, setAuthFlowActive] = useState(false)
  const [authResolved, setAuthResolved] = useState(false)
  const [pendingMnemonic, setPendingMnemonic] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [currentNav, setCurrentNav] = useState<NavName>('home')
  const [currentDir, setCurrentDirState] = useState('/')
  const [entries, setEntries] = useState<DriveEntry[]>([])
  const [createNetworkModal, setCreateNetworkModal] = useState<{ open: boolean; inviteLink: string }>({
    open: false,
    inviteLink: ''
  })
  const [joinNetworkModal, setJoinNetworkModal] = useState<{ open: boolean }>({ open: false })
  const [networkInfoModal, setNetworkInfoModal] = useState<{ open: boolean }>({ open: false })


  const [selectedEntry, setSelectedEntry] = useState<SelectedEntry | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailName, setDetailName] = useState('File')
  const [detailMeta, setDetailMeta] = useState('')
  const [chunkList, setChunkList] = useState('')
  const [toast, setToast] = useState<string | null>(null)
  const [inviteModal, setInviteModal] = useState<InviteModalState>(closedInvite)
  const [prompt, setPrompt] = useState<PromptState>(closedPrompt)
  const [dragging, setDragging] = useState(false)

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const promptResolve = useRef<((value: string | boolean | null) => void) | null>(null)
  const detailRequestId = useRef(0)
  const authFlowActiveRef = useRef(authFlowActive)
  const authResolvedRef = useRef(authResolved)
  const statusRef = useRef(status)
  const currentDirRef = useRef(currentDir)
  const askConfirmRef = useRef<(title: string, body?: string) => Promise<boolean>>(async () => false)
  const resolveAuthRef = useRef<(unlocked: boolean, nextStatus?: AppStatus | null) => void>(() => {})
  const showToastRef = useRef<(msg: string) => void>(() => {})

  useEffect(() => {
    authFlowActiveRef.current = authFlowActive
  }, [authFlowActive])
  useEffect(() => {
    authResolvedRef.current = authResolved
  }, [authResolved])
  useEffect(() => {
    statusRef.current = status
  }, [status])
  useEffect(() => {
    currentDirRef.current = currentDir
  }, [currentDir])


  const showToast = useCallback((msg: string) => {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 2600)
  }, [])

  const closePrompt = useCallback((value: string | boolean | null) => {
    setPrompt(closedPrompt)
    const resolve = promptResolve.current
    promptResolve.current = null
    resolve?.(value)
  }, [])

  const askDialog = useCallback(
    (opts: {
      title: string
      body?: string
      defaultValue?: string
      okLabel?: string
      cancelLabel?: string
      mode?: PromptMode
      choices?: PromptChoice[]
    }) => {
      return new Promise<string | boolean | null>((resolve) => {
        if (promptResolve.current) closePrompt(null)
        promptResolve.current = resolve
        setPrompt({
          open: true,
          title: opts.title,
          body: opts.body || '',
          defaultValue: opts.defaultValue || '',
          okLabel: opts.okLabel || 'OK',
          cancelLabel: opts.cancelLabel || 'Cancel',
          mode: opts.mode || 'text',
          choices: opts.choices || []
        })
      })
    },
    [closePrompt]
  )

  const askText = useCallback(
    async (title: string, defaultValue = '', body = '') => {
      const v = await askDialog({ title, body, defaultValue, mode: 'text' })
      return v === null ? null : String(v).trim()
    },
    [askDialog]
  )

  const askConfirm = useCallback(
    async (title: string, body = '') => {
      const v = await askDialog({ title, body, mode: 'confirm', okLabel: 'Confirm' })
      return !!v
    },
    [askDialog]
  )

  const openInviteModal = useCallback((state: Omit<InviteModalState, 'open'>) => {
    setInviteModal({ ...state, open: true })
  }, [])

  const closeInviteModal = useCallback(() => setInviteModal(closedInvite), [])

  const copyClipboard = useCallback(
    async (text: string) => {
      try {
        const bridge = window.bridge
        if (bridge && typeof bridge.writeClipboard === 'function') {
          await bridge.writeClipboard(text)
          showToast('Copied')
          return
        }
      } catch {
        // bridge failed, fall through to execCommand
      }
      try {
        const textarea = document.createElement('textarea')
        textarea.value = text
        textarea.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none'
        document.body.appendChild(textarea)
        textarea.focus()
        textarea.select()
        document.execCommand('copy')
        document.body.removeChild(textarea)
        showToast('Copied')
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Copy failed')
      }
    },
    [showToast]
  )

  const refreshFiles = useCallback(async () => {
    const dir = currentDirRef.current
    const list = await rpc<DriveEntry[]>('list', { dir })
    setEntries(list)
  }, [])

  const showDetail = useCallback(
    async (path: string) => {
      const requestId = ++detailRequestId.current
      setDetailOpen(true)
      setDetailName(path.split('/').filter(Boolean).pop() || path)
      setChunkList('Loading…')
      try {
        const manifest = await rpc<ChunkManifest>('getChunkManifest', { path })
        if (requestId !== detailRequestId.current) return
        setDetailMeta(`${formatBytes(manifest.byteLength)} · ${manifest.chunks.length} chunks`)
        setChunkList(
          manifest.chunks
            .map((c) => `#${c.index}  ${c.hash}\n  offset=${c.offset}  len=${c.length}`)
            .join('\n\n')
        )
        setSelectedEntry({
          path,
          source: 'vault',
          manifest
        })
      } catch (err) {
        if (requestId !== detailRequestId.current) return
        setDetailMeta(err instanceof Error ? err.message : String(err))
        setChunkList('')
      }
    },
    []
  )


  const closeDetail = useCallback(() => {
    detailRequestId.current += 1
    setDetailOpen(false)
    setSelectedEntry(null)
  }, [])

  const onEntryClick = useCallback(
    async (entry: DriveEntry) => {
      if (entry.isDirectory) {
        setCurrentDirState(entry.path)
        currentDirRef.current = entry.path
        await refreshFiles()
        return
      }
      setSelectedEntry({ ...entry, source: 'vault' })
      await showDetail(entry.path)
    },
    [refreshFiles, showDetail]
  )

  const uploadPaths = useCallback(async (opts: { isPrivate?: boolean } = {}) => {
    const isPrivate = opts.isPrivate !== false
    const bridge = getBridge()
    const paths = await bridge.chooseUploadFiles()
    if (!paths || !paths.length) return
    for (const localPath of paths) {
      const fileName = localPath.split(/[/\\]/).filter(Boolean).pop() || 'file'
      const destPath = joinPath(currentDirRef.current, fileName)
      showToast(`Uploading ${fileName} (${isPrivate ? 'Private' : 'Public'})…`)
      await rpc('upload', { localPath, destPath, mime: null, isPrivate })
    }
    showToast('Upload complete')
    await refreshFiles()
    rpc<AppStatus>('getStatus').then((s) => setStatus((prev) => ({ ...prev, ...s }))).catch(() => {})
  }, [refreshFiles, showToast])

  const uploadFiles = useCallback(
    async (fileList: FileList | File[], opts: { isPrivate?: boolean } = {}) => {
      const isPrivate = opts.isPrivate !== false
      const bridge = getBridge()
      const files = [...fileList]
      if (!files.length) return
      for (const file of files) {
        let localPath = bridge.getPathForFile(file)
        if (!localPath) {
          const nativePaths = await bridge.chooseUploadFiles()
          if (!nativePaths || !nativePaths.length) return
          localPath = nativePaths[0]
        }
        const destPath = joinPath(currentDirRef.current, file.name)
        showToast(`Uploading ${file.name} (${isPrivate ? 'Private' : 'Public'})…`)
        await rpc('upload', { localPath, destPath, mime: file.type || null, isPrivate })
      }
      showToast('Upload complete')
      await refreshFiles()
      rpc<AppStatus>('getStatus').then((s) => setStatus((prev) => ({ ...prev, ...s }))).catch(() => {})
    },
    [refreshFiles, showToast]
  )

  const navigate = useCallback(
    (name: NavName) => {
      setCurrentNav(name)
      setDetailOpen(false)
      if (name === 'files') {
        refreshFiles().catch((err) => showToast(err.message))
      }
    },
    [refreshFiles, showToast]
  )


  const showApp = useCallback(
    (nextStatus?: AppStatus | null) => {
      setAuthResolved(true)
      setAuthFlowActive(false)
      if (nextStatus) {
        setStatus(nextStatus)
        if (nextStatus.displayName) setDisplayName(nextStatus.displayName)
      }
      setView('app')
      setCurrentNav('home')
      refreshFiles().catch((err) => showToast(err.message))
    },
    [refreshFiles, showToast]
  )

  const resolveAuth = useCallback(
    (unlocked: boolean, nextStatus: AppStatus | null = null) => {
      setAuthResolved(true)
      if (nextStatus) {
        setStatus(nextStatus)
      }
      if (unlocked) {
        showApp(nextStatus)
        return
      }
      setView('auth')
      if (!authFlowActiveRef.current) setAuthPanel('home')
    },
    [showApp]
  )


  const showAuthHome = useCallback(() => {
    setView('auth')
    setAuthFlowActive(false)
    setAuthPanel(authResolvedRef.current ? 'home' : 'boot')
  }, [])

  const createAccount = useCallback(async (name?: string) => {
    setAuthFlowActive(true)
    try {
      if (name) setDisplayName(name)
      const res = await rpc<{ mnemonic: string }>('createAccount')
      setPendingMnemonic(res.mnemonic)
      setAuthPanel('create')
    } catch (err) {
      setAuthFlowActive(false)
      throw err
    }
  }, [])

  const confirmCreateAccount = useCallback(
    async (typed: string) => {
      const normalized = normalizeMnemonic(typed)
      const expected = normalizeMnemonic(pendingMnemonic)
      if (!normalized) throw new Error('Enter your recovery key to continue.')
      if (normalized !== expected) throw new Error('Recovery key does not match. Try again.')
      const res = await rpc<{ status: AppStatus }>('confirmCreateAccount', { mnemonic: normalized, displayName })
      setPendingMnemonic('')
      resolveAuth(true, res.status)
      showToast('RYVE ready')
    },
    [pendingMnemonic, displayName, resolveAuth, showToast]
  )

  const unlock = useCallback(
    async (mnemonic: string) => {
      const normalized = normalizeMnemonic(mnemonic)
      if (!normalized) throw new Error('Enter your 24-word recovery key.')
      const res = await rpc<{ status: AppStatus }>('unlock', { mnemonic: normalized })
      resolveAuth(true, res.status)
      showToast('Unlocked')
    },
    [resolveAuth, showToast]
  )

  const logout = useCallback(async () => {
    await rpc('logout')
    setStatus(emptyStatus)
    setPendingMnemonic('')
    setAuthFlowActive(false)
    setAuthResolved(true)
    setView('auth')
    setAuthPanel('home')
    setEntries([])
    closeDetail()
  }, [closeDetail])


  const saveBlindPeers = useCallback(
    async (keysText: string) => {
      const keys = keysText
        .split(/\n+/)
        .map((s) => s.trim())
        .filter(Boolean)
      const next = await rpc<AppStatus>('setBlindPeers', { keys })
      setStatus(next)
      showToast('Blind peers saved')
    },
    [showToast]
  )

  const setStorageQuota = useCallback(
    async (mode: 'limited' | 'all', quotaBytes?: number) => {
      try {
        const next = await rpc<AppStatus>('setStorageQuota', { mode, quotaBytes })
        setStatus((prev) => ({ ...prev, ...next }))
        showToast(mode === 'all' ? 'Storage set to allocate all available space' : 'Storage quota updated')
      } catch (err: any) {
        showToast(`Failed to update storage: ${err?.message || err}`)
      }
    },
    [showToast]
  )

  const mkdir = useCallback(
    async (name: string) => {
      await rpc('mkdir', { path: joinPath(currentDirRef.current, assertEntryName(name)) })
      await refreshFiles()
    },
    [refreshFiles]
  )

  const openCreateNetworkModal = useCallback((inviteLink: string) => {
    setCreateNetworkModal({ open: true, inviteLink })
  }, [])

  const closeCreateNetworkModal = useCallback(() => {
    setCreateNetworkModal({ open: false, inviteLink: '' })
  }, [])

  const openJoinNetworkModal = useCallback(() => {
    setJoinNetworkModal({ open: true })
  }, [])

  const closeJoinNetworkModal = useCallback(() => {
    setJoinNetworkModal({ open: false })
  }, [])

  const openNetworkInfoModal = useCallback(() => {
    setNetworkInfoModal({ open: true })
  }, [])

  const closeNetworkInfoModal = useCallback(() => {
    setNetworkInfoModal({ open: false })
  }, [])

  const createNetwork = useCallback(
    async (name?: string) => {
      try {
        const netName = name || 'RYVE Workspace'
        const res = await rpc<{ status: AppStatus; networkLink: string; networkKeyHex: string }>('createNetwork', { name: netName })
        if (res?.status) setStatus(res.status)
        await refreshFiles()
        return res
      } catch (err: any) {
        showToast(err?.message || 'Network creation failed')
        throw err
      }
    },
    [refreshFiles, showToast]
  )

  const joinNetwork = useCallback(
    async (link: string) => {
      setAuthFlowActive(true)
      try {
        const res = await rpc<{ status: AppStatus }>('joinNetwork', { link })
        resolveAuth(true, res.status)
        showToast('Joined P2P Network!')
      } catch (err: any) {
        setAuthFlowActive(false)
        showToast(err.message || 'Failed to join network')
        throw err
      }
    },
    [resolveAuth, showToast]
  )

  const switchNetwork = useCallback(
    async (id: string) => {
      try {
        const next = await rpc<AppStatus>('switchNetwork', { id })
        setStatus(next)
        showToast('Switched Network')
        await refreshFiles()
      } catch (err: any) {
        showToast(err.message || 'Failed to switch network')
      }
    },
    [refreshFiles, showToast]
  )

  const removeNetwork = useCallback(
    async (id: string) => {
      try {
        const next = await rpc<AppStatus>('removeNetwork', { id })
        setStatus(next)
        showToast('Network removed')
        await refreshFiles()
      } catch (err: any) {
        showToast(err.message || 'Failed to remove network')
      }
    },
    [refreshFiles, showToast]
  )


  const [previewModal, setPreviewModal] = useState<{
    open: boolean
    name: string
    url: string | null
    mime: string | null
    content: string | null
    error: string | null
  }>({ open: false, name: '', url: null, mime: null, content: null, error: null })

  const closePreviewModal = useCallback(() => {
    setPreviewModal((p) => {
      if (p.url) URL.revokeObjectURL(p.url)
      return { open: false, name: '', url: null, mime: null, content: null, error: null }
    })
  }, [])

  const previewSelected = useCallback(async () => {
    if (!selectedEntry) return
    const name = selectedEntry.path.split('/').filter(Boolean).pop() || 'file'
    showToast('Fetching chunks from network peers…')
    setPreviewModal({ open: true, name, url: null, mime: null, content: null, error: null })
    try {
      const mime = selectedEntry.manifest?.mime || null
      // Request file download/reassembly from network peers
      const dest = await getBridge().chooseDownloadPath(name)
      if (!dest) {
        closePreviewModal()
        return
      }
      await rpc<{ verified?: boolean }>('download', {
        path: selectedEntry.path,
        destLocalPath: dest
      })
      showToast('File downloaded & verified!')
      closePreviewModal()
    } catch (err) {
      setPreviewModal({
        open: true,
        name,
        url: null,
        mime: null,
        content: null,
        error: err instanceof Error ? err.message : String(err)
      })
    }
  }, [closePreviewModal, selectedEntry, showToast])

  const downloadSelected = useCallback(async () => {
    if (!selectedEntry) return
    const name = selectedEntry.path.split('/').filter(Boolean).pop() || 'download'
    const dest = await getBridge().chooseDownloadPath(name)
    if (!dest) return
    const result = await rpc<{ verified?: boolean }>('download', {
      path: selectedEntry.path,
      destLocalPath: dest
    })
    if (result?.verified === false) {
      showToast('Downloaded, but chunk hashes did not match')
    } else {
      showToast('Downloaded')
    }
  }, [selectedEntry, showToast])

  const deleteSelected = useCallback(async () => {
    if (!selectedEntry || selectedEntry.source !== 'vault') {
      showToast('Delete is only available in My Drive')
      return
    }
    const ok = await askConfirm('Delete file?', selectedEntry.path)
    if (!ok) return
    await rpc('delete', { path: selectedEntry.path })
    closeDetail()
    await refreshFiles()
    rpc<AppStatus>('getStatus').then((s) => setStatus((prev) => ({ ...prev, ...s }))).catch(() => {})
  }, [askConfirm, closeDetail, refreshFiles, selectedEntry, showToast])

  useEffect(() => {
    askConfirmRef.current = askConfirm
  }, [askConfirm])
  useEffect(() => {
    resolveAuthRef.current = resolveAuth
  }, [resolveAuth])
  useEffect(() => {
    showToastRef.current = showToast
  }, [showToast])

  // Subscribe on every mount; worker process starts once (Safe under React StrictMode).
  useEffect(() => {
    const bridge = getBridge()

    async function onUpdateReady() {
      const ok = await askConfirmRef.current(
        'Update ready',
        'An update is ready. Restart now to apply it?'
      )
      if (!ok) return
      try {
        await bridge.applyUpdate()
        await bridge.appAfterUpdate()
      } catch (err) {
        showToastRef.current(
          'Update failed: ' + (err instanceof Error ? err.message : String(err))
        )
      }
    }

    function onWorkerMessage(data: Buffer) {
      const text = decoder.decode(data)
      if (text === 'updating') {
        showToastRef.current('Downloading update…')
        return
      }
      if (text === 'updated') {
        onUpdateReady()
        return
      }
      if (text === 'pear:updateApplied') return
      let msg: {
        id?: number
        ok?: boolean
        result?: unknown
        error?: string
        type?: string
        name?: string
        data?: unknown
      }
      try {
        msg = JSON.parse(text)
      } catch {
        return
      }

      if (msg.id && settlePending(msg.id, !!msg.ok, msg.result, msg.error)) return

      if (msg.type === 'event') {
        if (msg.name === 'auth') {
          const data = msg.data as { needsAuth: boolean; status?: AppStatus }
          resolveAuthRef.current(!data.needsAuth, data.status || null)
        }
        if (msg.name === 'status') {
          const data = msg.data as Partial<AppStatus>
          setStatus((s) => ({ ...s, ...data }))
          // Keep shell/auth view aligned if status announces unlock after boot.
          if (data.unlocked === true && authResolvedRef.current) {
            setView('app')
          }
        }
        if (msg.name === 'public-catalog-updated') {
          refreshFiles()
          rpc<AppStatus>('getStatus').then((s) => setStatus((prev) => ({ ...prev, ...s }))).catch(() => {})
        }
        if (msg.name === 'ready') {
          console.log('worker ready', msg.data)
        }
      }
    }

    let restartAttempts = 0
    const unsubIpc = subscribeWorkerIpc(onWorkerMessage)
    const unsubExit = subscribeWorkerExit((code) => {
      console.error('worker exited', code)
      setAuthFlowActive(false)
      setAuthResolved(false)
      setView('auth')
      setAuthPanel('boot')
      if (restartAttempts >= 2) {
        showToastRef.current('Backend stopped — restart the app')
        setAuthResolved(true)
        setAuthPanel('home')
        return
      }
      restartAttempts += 1
      showToastRef.current('Backend stopped — restarting…')
      const delay = restartAttempts * 500
      setTimeout(() => {
        ensureWorkerStarted()
          .then(() => rpc<AppStatus>('getStatus'))
          .then((s) => {
            restartAttempts = 0
            resolveAuthRef.current(!!s.unlocked, s)
          })
          .catch((err) => {
            console.error('worker restart failed', err)
            setAuthResolved(true)
            setAuthPanel('home')
            showToastRef.current('Backend stopped — restart the app')
          })
      }, delay)
    })

    let cancelled = false
    ;(async () => {
      try {
        await ensureWorkerStarted()
        if (cancelled) return
        // getStatus waits for auto-unlock in the worker — no fragile timeout fallback.
        const s = await rpc<AppStatus>('getStatus')
        if (cancelled) return
        setStatus((prev) => ({ ...prev, ...s }))
        resolveAuthRef.current(!!s.unlocked, s)
      } catch (err) {
        console.error('getStatus failed', err)
        if (!cancelled && !authResolvedRef.current) {
          setAuthResolved(true)
          if (!authFlowActiveRef.current) setAuthPanel('home')
        }
      }
    })()

    return () => {
      cancelled = true
      unsubIpc()
      unsubExit()
      if (toastTimer.current) clearTimeout(toastTimer.current)
    }
  }, [])

  const value = useMemo<DriveContextValue>(
    () => ({
      status,
      view,
      authPanel,
      authFlowActive,
      pendingMnemonic,
      displayName,
      setDisplayName,
      currentNav,
      currentDir,
      entries,
      selectedEntry,
      detailOpen,
      detailName,
      detailMeta,
      chunkList,
      toast,
      prompt,
      dragging,
      createNetworkModal,
      joinNetworkModal,
      networkInfoModal,
      setDragging,
      showToast,
      setAuthPanel,
      setPendingMnemonic,
      setAuthFlowActive,
      navigate,
      refreshFiles,
      setCurrentDir: (dir: string) => {
        setCurrentDirState(dir)
        currentDirRef.current = dir
      },
      onEntryClick,
      showDetail,
      closeDetail,
      uploadPaths,
      uploadFiles,
      askDialog,
      askText,
      askConfirm,
      closePrompt,
      resolveAuth,
      showAuthHome,
      showApp,
      createNetwork,
      joinNetwork,
      switchNetwork,
      removeNetwork,
      openCreateNetworkModal,
      closeCreateNetworkModal,
      openJoinNetworkModal,
      closeJoinNetworkModal,
      openNetworkInfoModal,
      closeNetworkInfoModal,
      createAccount,
      confirmCreateAccount,
      unlock,
      logout,
      saveBlindPeers,
      mkdir,
      downloadSelected,
      previewSelected,
      previewModal,
      closePreviewModal,
      deleteSelected,
      copyClipboard,
      setStorageQuota
    }),
    [
      status,
      view,
      authPanel,
      authFlowActive,
      pendingMnemonic,
      displayName,
      setDisplayName,
      currentNav,
      currentDir,
      entries,
      selectedEntry,
      detailOpen,
      detailName,
      detailMeta,
      chunkList,
      toast,
      prompt,
      dragging,
      createNetworkModal,
      joinNetworkModal,
      networkInfoModal,
      setDragging,
      showToast,
      setAuthPanel,
      setPendingMnemonic,
      setAuthFlowActive,
      navigate,
      refreshFiles,
      onEntryClick,
      showDetail,
      closeDetail,
      uploadPaths,
      uploadFiles,
      askDialog,
      askText,
      askConfirm,
      closePrompt,
      resolveAuth,
      showAuthHome,
      showApp,
      createNetwork,
      joinNetwork,
      switchNetwork,
      removeNetwork,
      openCreateNetworkModal,
      closeCreateNetworkModal,
      openJoinNetworkModal,
      closeJoinNetworkModal,
      openNetworkInfoModal,
      closeNetworkInfoModal,
      createAccount,
      confirmCreateAccount,
      unlock,
      logout,
      saveBlindPeers,
      mkdir,
      downloadSelected,
      previewSelected,
      previewModal,
      closePreviewModal,
      deleteSelected,
      copyClipboard,
      setStorageQuota
    ]
  )

  return <DriveContext.Provider value={value}>{children}</DriveContext.Provider>
}

export function useDrive() {
  const ctx = useContext(DriveContext)
  if (!ctx) throw new Error('useDrive must be used within DriveProvider')
  return ctx
}
