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
import type { AppStatus, ChunkManifest, DriveEntry, FilePreviewResult } from '../../shared/types.ts'
import { assertEntryName, formatBytes, joinPath, normalizeMnemonic } from '@/lib/format'
import { decoder, getBridge, LONG_RPC_TIMEOUT_MS, rpc, settlePending } from '@/lib/rpc'
import { ensureWorkerStarted, subscribeWorkerExit, subscribeWorkerIpc } from '@/lib/worker-bridge'

export type AuthPanel = 'boot' | 'home' | 'create' | 'confirm' | 'unlock'
export type NavName = 'files' | 'settings'

export type SelectedEntry = {
  path: string
  source: 'vault'
  manifest?: ChunkManifest
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

export type PreviewModalState = {
  open: boolean
  name: string
  url: string | null
  mime: string | null
  content: string | null
  error: string | null
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
  selectedEntry: SelectedEntry | null
  detailOpen: boolean
  detailName: string
  detailMeta: string
  chunkList: string
  toast: string | null
  prompt: PromptState
  dragging: boolean
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
  uploadPaths: () => Promise<void>
  uploadFiles: (fileList: FileList | File[]) => Promise<void>
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
  createAccount: () => Promise<void>
  confirmCreateAccount: (typed: string) => Promise<void>
  unlock: (mnemonic: string) => Promise<void>
  logout: () => Promise<void>
  saveBlindPeers: (keysText: string) => Promise<void>
  mkdir: (name: string) => Promise<void>
  downloadSelected: () => Promise<void>
  previewSelected: () => Promise<void>
  previewModal: PreviewModalState
  closePreviewModal: () => void
  deleteSelected: () => Promise<void>
}

const emptyStatus: AppStatus = {
  unlocked: false,
  identity: null,
  driveKey: null,
  peers: 0,
  blindPeerKeys: []
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

const closedPreview: PreviewModalState = {
  open: false,
  name: '',
  url: null,
  mime: null,
  content: null,
  error: null
}

const DriveContext = createContext<DriveContextValue | null>(null)

function fileBaseName(name: string): string {
  return assertEntryName(name.split(/[/\\]/).filter(Boolean).pop() || 'file')
}

function bytesFromBase64(value: string): Uint8Array {
  const binary = atob(value)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

function isTextPreview(mime: string | null, name: string): boolean {
  return Boolean(mime?.startsWith('text/') || /\.(txt|md|js|json|ts|py|html|css)$/i.test(name))
}

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
  const [selectedEntry, setSelectedEntry] = useState<SelectedEntry | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailName, setDetailName] = useState('File')
  const [detailMeta, setDetailMeta] = useState('')
  const [chunkList, setChunkList] = useState('')
  const [toast, setToast] = useState<string | null>(null)
  const [prompt, setPrompt] = useState<PromptState>(closedPrompt)
  const [dragging, setDragging] = useState(false)
  const [previewModal, setPreviewModal] = useState<PreviewModalState>(closedPreview)

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const promptResolve = useRef<((value: string | boolean | null) => void) | null>(null)
  const detailRequestId = useRef(0)
  const listRequestId = useRef(0)
  const authFlowActiveRef = useRef(authFlowActive)
  const authResolvedRef = useRef(authResolved)
  const currentDirRef = useRef(currentDir)
  const askConfirmRef = useRef<(title: string, body?: string) => Promise<boolean>>(
    async () => false
  )
  const resolveAuthRef = useRef<(unlocked: boolean, nextStatus?: AppStatus | null) => void>(
    () => {}
  )
  const showToastRef = useRef<(msg: string) => void>(() => {})

  useEffect(() => {
    authFlowActiveRef.current = authFlowActive
  }, [authFlowActive])
  useEffect(() => {
    authResolvedRef.current = authResolved
  }, [authResolved])
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

  const refreshFiles = useCallback(async () => {
    const requestId = ++listRequestId.current
    const dir = currentDirRef.current
    const list = await rpc<DriveEntry[]>('list', { dir })
    if (requestId !== listRequestId.current) return
    setEntries(list)
  }, [])

  const showDetail = useCallback(async (path: string) => {
    const requestId = ++detailRequestId.current
    setDetailOpen(true)
    setDetailName(path.split('/').filter(Boolean).pop() || path)
    setChunkList('Loading…')
    setSelectedEntry({ path, source: 'vault' })
    try {
      const manifest = await rpc<ChunkManifest>('getChunkManifest', { path })
      if (requestId !== detailRequestId.current) return
      setDetailMeta(`${formatBytes(manifest.byteLength)} · ${manifest.chunks.length} chunks`)
      setChunkList(
        manifest.chunks
          .map((c) => `#${c.index}  ${c.hash}\n  offset=${c.offset}  len=${c.length}`)
          .join('\n\n')
      )
      setSelectedEntry({ path, source: 'vault', manifest })
    } catch (err) {
      if (requestId !== detailRequestId.current) return
      setSelectedEntry(null)
      setDetailMeta(err instanceof Error ? err.message : String(err))
      setChunkList('')
    }
  }, [])

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
      await showDetail(entry.path)
    },
    [refreshFiles, showDetail]
  )

  const uploadPaths = useCallback(async () => {
    const paths = await getBridge().chooseUploadFiles()
    if (!paths?.length) return
    for (const localPath of paths) {
      const fileName = fileBaseName(localPath)
      const destPath = joinPath(currentDirRef.current, fileName)
      showToast('Uploading ' + fileName + '…')
      await rpc('upload', { localPath, destPath, mime: null }, LONG_RPC_TIMEOUT_MS)
    }
    showToast('Upload complete')
    await refreshFiles()
  }, [refreshFiles, showToast])

  const uploadFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const bridge = getBridge()
      const files = [...fileList]
      if (!files.length) return
      for (const file of files) {
        const fileName = fileBaseName(file.name)
        let localPath = bridge.getPathForFile(file)
        if (!localPath) {
          const nativePaths = await bridge.chooseUploadFiles()
          if (!nativePaths?.length) continue
          localPath = nativePaths[0]
        }
        const destPath = joinPath(currentDirRef.current, fileName)
        showToast('Uploading ' + fileName + '…')
        await rpc('upload', { localPath, destPath, mime: file.type || null }, LONG_RPC_TIMEOUT_MS)
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
      }
    },
    [refreshFiles, showToast]
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
      if (nextStatus) setStatus(nextStatus)
      if (unlocked) {
        showApp(nextStatus)
        return
      }
      setView('auth')
      if (!authFlowActiveRef.current) setAuthPanel('home')
    },
    [showApp]
  )

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

  const closePreviewModal = useCallback(() => {
    setPreviewModal((prev) => {
      if (prev.url) URL.revokeObjectURL(prev.url)
      return closedPreview
    })
  }, [])

  const downloadSelected = useCallback(async () => {
    if (!selectedEntry) return
    const name = selectedEntry.path.split('/').filter(Boolean).pop() || 'download'
    const dest = await getBridge().chooseDownloadPath(name)
    if (!dest) return
    const result = await rpc<{ verified?: boolean }>(
      'download',
      { path: selectedEntry.path, destLocalPath: dest },
      LONG_RPC_TIMEOUT_MS
    )
    if (result?.verified === false) showToast('Downloaded, but chunk hashes did not match')
    else showToast('Downloaded')
  }, [selectedEntry, showToast])

  const previewSelected = useCallback(async () => {
    if (!selectedEntry) return
    const name = selectedEntry.path.split('/').filter(Boolean).pop() || 'file'
    showToast('Fetching chunks from network peers…')
    setPreviewModal({ ...closedPreview, open: true, name })
    try {
      const result = await rpc<FilePreviewResult>(
        'previewFile',
        { path: selectedEntry.path },
        LONG_RPC_TIMEOUT_MS
      )
      if (result.tooLarge) {
        closePreviewModal()
        showToast('File too large to preview — choose a download location')
        await downloadSelected()
        return
      }
      const bytes = bytesFromBase64(result.bytes)
      const mime = result.mime || 'application/octet-stream'
      const copy = new Uint8Array(bytes.byteLength)
      copy.set(bytes)
      const url = URL.createObjectURL(new Blob([copy.buffer], { type: mime }))
      setPreviewModal({
        open: true,
        name: result.name || name,
        url,
        mime,
        content: isTextPreview(mime, result.name || name) ? new TextDecoder().decode(bytes) : null,
        error: null
      })
      if (result.verified === false) showToast('Previewed, but chunk hashes did not match')
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
  }, [closePreviewModal, downloadSelected, selectedEntry, showToast])

  const deleteSelected = useCallback(async () => {
    if (!selectedEntry) return
    const ok = await askConfirm('Delete file?', selectedEntry.path)
    if (!ok) return
    await rpc('delete', { path: selectedEntry.path })
    closeDetail()
    await refreshFiles()
  }, [askConfirm, closeDetail, refreshFiles, selectedEntry])

  useEffect(() => {
    askConfirmRef.current = askConfirm
  }, [askConfirm])
  useEffect(() => {
    resolveAuthRef.current = resolveAuth
  }, [resolveAuth])
  useEffect(() => {
    showToastRef.current = showToast
  }, [showToast])

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
        showToastRef.current('Update failed: ' + (err instanceof Error ? err.message : String(err)))
      }
    }

    function onWorkerMessage(data: Uint8Array) {
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
          if (data.unlocked === true && authResolvedRef.current) setView('app')
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
      }, restartAttempts * 500)
    })

    let cancelled = false
    ;(async () => {
      try {
        await ensureWorkerStarted()
        if (cancelled) return
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
      deleteSelected
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
      selectedEntry,
      detailOpen,
      detailName,
      detailMeta,
      chunkList,
      toast,
      prompt,
      dragging,
      showToast,
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
      deleteSelected
    ]
  )

  return <DriveContext.Provider value={value}>{children}</DriveContext.Provider>
}

export function useDrive() {
  const ctx = useContext(DriveContext)
  if (!ctx) throw new Error('useDrive must be used within DriveProvider')
  return ctx
}
