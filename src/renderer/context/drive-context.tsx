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
import type { AppStatus, ChunkManifest, DriveEntry, ShareInfo } from '../../shared/types.ts'
import { assertEntryName, formatBytes, joinPath, normalizeMnemonic } from '@/lib/format'
import { decoder, getBridge, rpc, settlePending } from '@/lib/rpc'
import {
  ensureWorkerStarted,
  subscribeWorkerExit,
  subscribeWorkerIpc
} from '@/lib/worker-bridge'

export type AuthPanel = 'boot' | 'home' | 'create' | 'confirm' | 'unlock'
export type NavName = 'files' | 'shared' | 'settings'

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
  currentNav: NavName
  currentDir: string
  entries: DriveEntry[]
  shares: ShareInfo[]
  activeShareId: string | null
  shareDir: string
  shareEntries: DriveEntry[]
  activeShare: ShareInfo | null
  selectedEntry: SelectedEntry | null
  detailOpen: boolean
  detailName: string
  detailMeta: string
  chunkList: string
  toast: string | null
  inviteModal: InviteModalState
  prompt: PromptState
  dragging: boolean
  setDragging: (value: boolean) => void
  showToast: (msg: string) => void
  setAuthPanel: (panel: AuthPanel) => void
  setPendingMnemonic: (value: string) => void
  setAuthFlowActive: (value: boolean) => void
  navigate: (name: NavName) => void
  refreshFiles: () => Promise<void>
  refreshShares: () => Promise<void>
  refreshShareFiles: () => Promise<void>
  openShare: (share: ShareInfo) => Promise<void>
  closeShare: () => void
  setCurrentDir: (dir: string) => void
  setShareDir: (dir: string) => void
  onEntryClick: (entry: DriveEntry) => Promise<void>
  showDetail: (path: string, shareId?: string | null) => Promise<void>
  closeDetail: () => void
  uploadPaths: () => Promise<void>
  uploadFiles: (fileList: FileList | File[], opts?: { share?: boolean }) => Promise<void>
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
  openInviteModal: (state: Omit<InviteModalState, 'open'>) => void
  closeInviteModal: () => void
  resolveAuth: (unlocked: boolean, nextStatus?: AppStatus | null) => void
  showAuthHome: () => void
  createAccount: () => Promise<void>
  confirmCreateAccount: (typed: string) => Promise<void>
  unlock: (mnemonic: string) => Promise<void>
  logout: () => Promise<void>
  saveBlindPeers: (keysText: string) => Promise<void>
  mkdir: (name: string) => Promise<void>
  createReadShare: () => Promise<void>
  createCollabShare: (name: string) => Promise<void>
  joinShare: (invite: string) => Promise<void>
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
}

const emptyStatus: AppStatus = {
  unlocked: false,
  identity: null,
  driveKey: null,
  peers: 0,
  blindPeerKeys: [],
  shares: []
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
  const [currentNav, setCurrentNav] = useState<NavName>('files')
  const [currentDir, setCurrentDirState] = useState('/')
  const [entries, setEntries] = useState<DriveEntry[]>([])
  const [shares, setShares] = useState<ShareInfo[]>([])
  const [activeShareId, setActiveShareId] = useState<string | null>(null)
  const [shareDir, setShareDirState] = useState('/')
  const [shareEntries, setShareEntries] = useState<DriveEntry[]>([])
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
  const activeShareIdRef = useRef(activeShareId)
  const shareDirRef = useRef(shareDir)
  const sharesRef = useRef(shares)
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
  useEffect(() => {
    activeShareIdRef.current = activeShareId
  }, [activeShareId])
  useEffect(() => {
    shareDirRef.current = shareDir
  }, [shareDir])
  useEffect(() => {
    sharesRef.current = shares
  }, [shares])

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

  const refreshShareFiles = useCallback(async () => {
    const id = activeShareIdRef.current
    if (!id) return
    const list = await rpc<DriveEntry[]>('listShareFiles', { id, dir: shareDirRef.current })
    setShareEntries(list)
  }, [])

  const refreshShares = useCallback(async () => {
    const list = await rpc<ShareInfo[]>('listShares')
    setShares(list)
    setStatus((s) => ({ ...s, shares: list }))
    setActiveShareId(null)
    setShareEntries([])
  }, [])

  const openShare = useCallback(
    async (share: ShareInfo) => {
      setActiveShareId(share.id)
      setShareDirState(share.pathPrefix || '/')
      shareDirRef.current = share.pathPrefix || '/'
      activeShareIdRef.current = share.id
      await refreshShareFiles()
    },
    [refreshShareFiles]
  )

  const closeShare = useCallback(() => {
    setActiveShareId(null)
    refreshShares().catch((err) => showToast(err.message))
  }, [refreshShares, showToast])

  const showDetail = useCallback(
    async (path: string, shareId: string | null = null) => {
      const requestId = ++detailRequestId.current
      setDetailOpen(true)
      setDetailName(path.split('/').filter(Boolean).pop() || path)
      setChunkList('Loading…')
      try {
        const manifest = shareId
          ? await rpc<ChunkManifest>('getShareManifest', { id: shareId, path })
          : await rpc<ChunkManifest>('getChunkManifest', { path })
        if (requestId !== detailRequestId.current) return
        setDetailMeta(`${formatBytes(manifest.byteLength)} · ${manifest.chunks.length} chunks`)
        setChunkList(
          manifest.chunks
            .map((c) => `#${c.index}  ${c.hash}\n  offset=${c.offset}  len=${c.length}`)
            .join('\n\n')
        )
        setSelectedEntry({
          path,
          source: shareId ? 'share' : 'vault',
          shareId,
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

  const uploadPaths = useCallback(async () => {
    const bridge = getBridge()
    const paths = await bridge.chooseUploadFiles()
    if (!paths || !paths.length) return
    for (const localPath of paths) {
      const fileName = localPath.split(/[/\\]/).filter(Boolean).pop() || 'file'
      const destPath = joinPath(currentDirRef.current, fileName)
      showToast('Uploading ' + fileName + '…')
      await rpc('upload', { localPath, destPath, mime: null })
    }
    showToast('Upload complete')
    await refreshFiles()
  }, [refreshFiles, showToast])

  const uploadFiles = useCallback(
    async (fileList: FileList | File[], { share = false } = {}) => {
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
        showToast('Uploading ' + file.name + '…')
        await rpc('upload', { localPath, destPath, mime: file.type || null })
      }
      showToast('Upload complete')
      await refreshFiles()
    },
    [refreshFiles, showToast]
  )

  const navigate = useCallback(
    (name: NavName) => {
      setCurrentNav(name)
      setDetailOpen(false)
      if (name === 'files') {
        refreshFiles().catch((err) => showToast(err.message))
      } else if (name === 'shared') {
        refreshShares().catch((err) => showToast(err.message))
      }
    },
    [refreshFiles, refreshShares, showToast]
  )

  const showApp = useCallback(
    (nextStatus?: AppStatus | null) => {
      setAuthResolved(true)
      setAuthFlowActive(false)
      if (nextStatus) setStatus(nextStatus)
      setView('app')
      setCurrentNav('files')
      refreshFiles().catch((err) => showToast(err.message))
    },
    [refreshFiles, showToast]
  )

  const resolveAuth = useCallback(
    (unlocked: boolean, nextStatus: AppStatus | null = null) => {
      setAuthResolved(true)
      if (nextStatus) {
        setStatus(nextStatus)
        if (nextStatus.shares) setShares(nextStatus.shares)
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

  const createAccount = useCallback(async () => {
    setAuthFlowActive(true)
    try {
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
      const res = await rpc<{ status: AppStatus }>('confirmCreateAccount', { mnemonic: normalized })
      setPendingMnemonic('')
      resolveAuth(true, res.status)
      showToast('Drive ready')
    },
    [pendingMnemonic, resolveAuth, showToast]
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
    setShares([])
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

  const mkdir = useCallback(
    async (name: string) => {
      await rpc('mkdir', { path: joinPath(currentDirRef.current, assertEntryName(name)) })
      await refreshFiles()
    },
    [refreshFiles]
  )

  const createReadShare = useCallback(async () => {
    const res = await rpc<{ invite: string }>('createReadShare', {
      pathPrefix: currentDirRef.current
    })
    openInviteModal({
      title: 'Read-only share',
      body:
        `Invite for ${currentDirRef.current}. The app highlights this folder, but the invite currently ` +
        `grants read access to the whole encrypted drive until subtree shares land. Treat it as sensitive.`,
      invite: res.invite
    })
  }, [openInviteModal])

  const createCollabShare = useCallback(
    async (name: string) => {
      const res = await rpc<{ invite: string }>('createCollabShare', {
        name: assertEntryName(name || 'Shared folder')
      })
      openInviteModal({
        title: 'Collaborative invite',
        body: 'Anyone with this invite can read and write the shared folder.',
        invite: res.invite
      })
      await refreshShares()
    },
    [openInviteModal, refreshShares]
  )

  const joinShare = useCallback(
    async (invite: string) => {
      await rpc('joinShare', { invite })
      showToast('Joined share')
      await refreshShares()
    },
    [refreshShares, showToast]
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

  const activeShare = useMemo(
    () => shares.find((s) => s.id === activeShareId) || null,
    [shares, activeShareId]
  )

  const value = useMemo<DriveContextValue>(
    () => ({
      status,
      view,
      authPanel,
      authFlowActive,
      pendingMnemonic,
      currentNav,
      currentDir,
      entries,
      shares,
      activeShareId,
      shareDir,
      shareEntries,
      activeShare,
      selectedEntry,
      detailOpen,
      detailName,
      detailMeta,
      chunkList,
      toast,
      inviteModal,
      prompt,
      dragging,
      setDragging,
      showToast,
      setAuthPanel,
      setPendingMnemonic,
      setAuthFlowActive,
      navigate,
      refreshFiles,
      refreshShares,
      refreshShareFiles,
      openShare,
      closeShare,
      setCurrentDir: (dir: string) => {
        setCurrentDirState(dir)
        currentDirRef.current = dir
      },
      setShareDir: (dir: string) => {
        setShareDirState(dir)
        shareDirRef.current = dir
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
      openInviteModal,
      closeInviteModal,
      resolveAuth,
      showAuthHome,
      createAccount,
      confirmCreateAccount,
      unlock,
      logout,
      saveBlindPeers,
      mkdir,
      createReadShare,
      createCollabShare,
      joinShare,
      downloadSelected,
      previewSelected,
      previewModal,
      closePreviewModal,
      deleteSelected,
      copyClipboard
    }),
    [
      status,
      view,
      authPanel,
      authFlowActive,
      pendingMnemonic,
      currentNav,
      currentDir,
      entries,
      shares,
      activeShareId,
      shareDir,
      shareEntries,
      activeShare,
      selectedEntry,
      detailOpen,
      detailName,
      detailMeta,
      chunkList,
      toast,
      inviteModal,
      prompt,
      dragging,
      showToast,
      navigate,
      refreshFiles,
      refreshShares,
      refreshShareFiles,
      openShare,
      closeShare,
      onEntryClick,
      showDetail,
      closeDetail,
      uploadFiles,
      askDialog,
      askText,
      askConfirm,
      closePrompt,
      openInviteModal,
      closeInviteModal,
      resolveAuth,
      showAuthHome,
      createAccount,
      confirmCreateAccount,
      unlock,
      logout,
      saveBlindPeers,
      mkdir,
      createReadShare,
      createCollabShare,
      joinShare,
      downloadSelected,
      deleteSelected,
      copyClipboard
    ]
  )

  return <DriveContext.Provider value={value}>{children}</DriveContext.Provider>
}

export function useDrive() {
  const ctx = useContext(DriveContext)
  if (!ctx) throw new Error('useDrive must be used within DriveProvider')
  return ctx
}
