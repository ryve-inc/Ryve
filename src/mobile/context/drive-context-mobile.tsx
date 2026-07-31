/**
 * drive-context-mobile.tsx
 *
 * Slimmed React context for mobile. Reuses the same state structure
 * as the desktop version but wires up to mobile-bridge instead of
 * the Electron window.bridge.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import type { AppStatus, DriveEntry, ShareInfo } from '../../shared/types'
import {
  decoder,
  ensureWorkerStarted,
  rpc,
  settlePending,
  subscribeWorkerExit,
  subscribeWorkerIpc,
  rejectAllPending
} from '../lib/mobile-bridge'

// ─── Types (shared subset) ─────────────────────────────────────────────────
export type AuthPanel = 'boot' | 'home' | 'create' | 'confirm' | 'unlock'
export type NavName = 'files' | 'settings'

export type DriveContextValue = {
  status: AppStatus
  view: 'auth' | 'app'
  authPanel: AuthPanel
  pendingMnemonic: string
  currentDir: string
  entries: DriveEntry[]
  toast: string | null
  uploading: boolean
  downloading: boolean
  setAuthPanel: (p: AuthPanel) => void
  setPendingMnemonic: (v: string) => void
  navigate: (n: NavName) => void
  showToast: (msg: string) => void
  refreshFiles: () => Promise<void>
  setCurrentDir: (dir: string) => void
  createAccount: () => Promise<void>
  confirmCreateAccount: (typed: string) => Promise<void>
  unlock: (mnemonic: string) => Promise<void>
  logout: () => Promise<void>
  mkdir: (name: string) => Promise<void>
  uploadLocalFile: (localPath: string, mime?: string | null) => Promise<void>
  downloadFile: (entryPath: string, destPath: string) => Promise<boolean>
  deleteFile: (entryPath: string) => Promise<void>
  saveBlindPeers: (keysText: string) => Promise<void>
}

const emptyStatus: AppStatus = {
  unlocked: false,
  identity: null,
  driveKey: null,
  peers: 0,
  blindPeerKeys: [],
  shares: []
}

const DriveContext = createContext<DriveContextValue | null>(null)

export function DriveProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AppStatus>(emptyStatus)
  const [view, setView] = useState<'auth' | 'app'>('auth')
  const [authPanel, setAuthPanel] = useState<AuthPanel>('boot')
  const [pendingMnemonic, setPendingMnemonic] = useState('')
  const [currentDir, setCurrentDir] = useState('/')
  const [entries, setEntries] = useState<DriveEntry[]>([])
  const [toast, setToast] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [downloading, setDownloading] = useState(false)

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const currentDirRef = useRef(currentDir)
  const authResolvedRef = useRef(false)

  useEffect(() => {
    currentDirRef.current = currentDir
  }, [currentDir])

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 3000)
  }, [])

  const refreshFiles = useCallback(async () => {
    const list = await rpc<DriveEntry[]>('list', { dir: currentDirRef.current })
    setEntries(list)
  }, [])

  const resolveAuth = useCallback(
    (unlocked: boolean, nextStatus?: AppStatus | null) => {
      authResolvedRef.current = true
      if (nextStatus) setStatus(nextStatus)
      if (unlocked) {
        setView('app')
        refreshFiles().catch(() => {})
        return
      }
      setView('auth')
      setAuthPanel('home')
    },
    [refreshFiles]
  )

  // ─── Worker boot & IPC subscription ──────────────────────────────────────
  useEffect(() => {
    let cancelled = false

    const unsubIpc = subscribeWorkerIpc((data: Uint8Array) => {
      const text = decoder.decode(data)
      if (text === 'updating') { showToast('Downloading update…'); return }
      let msg: { id?: number; ok?: boolean; result?: unknown; error?: string; type?: string; name?: string; data?: unknown }
      try { msg = JSON.parse(text) } catch { return }

      if (msg.id && settlePending(msg.id, !!msg.ok, msg.result, msg.error)) return

      if (msg.type === 'event') {
        if (msg.name === 'auth') {
          const d = msg.data as { needsAuth: boolean; status?: AppStatus }
          resolveAuth(!d.needsAuth, d.status || null)
        }
        if (msg.name === 'status') {
          setStatus((s) => ({ ...s, ...(msg.data as Partial<AppStatus>) }))
        }
      }
    })

    const unsubExit = subscribeWorkerExit((code: number) => {
      console.error('[mobile] worker exited', code)
      rejectAllPending('Worker exited (' + code + ')')
      showToast('Backend stopped — restart the app')
      setView('auth')
      setAuthPanel('home')
    })

    ensureWorkerStarted()
      .then(() => rpc<AppStatus>('getStatus'))
      .then((s) => {
        if (cancelled) return
        setStatus((prev) => ({ ...prev, ...s }))
        resolveAuth(!!s.unlocked, s)
      })
      .catch((err) => {
        console.error('[mobile] getStatus failed', err)
        if (!cancelled && !authResolvedRef.current) {
          authResolvedRef.current = true
          setAuthPanel('home')
        }
      })

    return () => {
      cancelled = true
      unsubIpc()
      unsubExit()
      if (toastTimer.current) clearTimeout(toastTimer.current)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Auth actions ─────────────────────────────────────────────────────────
  const createAccount = useCallback(async () => {
    const res = await rpc<{ mnemonic: string }>('createAccount')
    setPendingMnemonic(res.mnemonic)
    setAuthPanel('create')
  }, [])

  const confirmCreateAccount = useCallback(
    async (typed: string) => {
      const normalized = typed.trim().toLowerCase().replace(/\s+/g, ' ')
      const expected = pendingMnemonic.trim().toLowerCase().replace(/\s+/g, ' ')
      if (!normalized) throw new Error('Enter your recovery key.')
      if (normalized !== expected) throw new Error('Recovery key does not match.')
      const res = await rpc<{ status: AppStatus }>('confirmCreateAccount', { mnemonic: normalized })
      setPendingMnemonic('')
      resolveAuth(true, res.status)
      showToast('Drive ready')
    },
    [pendingMnemonic, resolveAuth, showToast]
  )

  const unlock = useCallback(
    async (mnemonic: string) => {
      const normalized = mnemonic.trim().toLowerCase().replace(/\s+/g, ' ')
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
    setEntries([])
    setView('auth')
    setAuthPanel('home')
  }, [])

  // ─── File actions ─────────────────────────────────────────────────────────
  const mkdir = useCallback(
    async (name: string) => {
      const cleanName = name.trim().replace(/[/\0]/g, '')
      if (!cleanName) throw new Error('Invalid folder name')
      const p = currentDirRef.current === '/' ? '/' + cleanName : currentDirRef.current + '/' + cleanName
      await rpc('mkdir', { path: p })
      await refreshFiles()
    },
    [refreshFiles]
  )

  const uploadLocalFile = useCallback(
    async (localPath: string, mime: string | null = null) => {
      const fileName = localPath.split('/').filter(Boolean).pop() || 'file'
      const destPath = currentDirRef.current === '/'
        ? '/' + fileName
        : currentDirRef.current + '/' + fileName
      setUploading(true)
      showToast('Uploading ' + fileName + '…')
      try {
        await rpc('upload', { localPath, destPath, mime })
        showToast('Upload complete')
        await refreshFiles()
      } finally {
        setUploading(false)
      }
    },
    [refreshFiles, showToast]
  )

  const downloadFile = useCallback(
    async (entryPath: string, destLocalPath: string): Promise<boolean> => {
      setDownloading(true)
      showToast('Fetching chunks from peers…')
      try {
        const res = await rpc<{ verified?: boolean }>('download', { path: entryPath, destLocalPath })
        showToast(res?.verified === false ? 'Downloaded (hash mismatch!)' : 'Downloaded ✓')
        return !!res?.verified
      } finally {
        setDownloading(false)
      }
    },
    [showToast]
  )

  const deleteFile = useCallback(
    async (entryPath: string) => {
      await rpc('delete', { path: entryPath })
      await refreshFiles()
    },
    [refreshFiles]
  )

  const saveBlindPeers = useCallback(
    async (keysText: string) => {
      const keys = keysText.split(/\n+/).map((s) => s.trim()).filter(Boolean)
      const next = await rpc<AppStatus>('setBlindPeers', { keys })
      setStatus(next)
      showToast('Blind peers saved')
    },
    [showToast]
  )

  const navigate = useCallback((name: NavName) => {
    if (name === 'files') refreshFiles().catch(() => {})
  }, [refreshFiles])

  const value = useMemo<DriveContextValue>(
    () => ({
      status, view, authPanel, pendingMnemonic, currentDir, entries, toast, uploading, downloading,
      setAuthPanel, setPendingMnemonic, navigate, showToast, refreshFiles, setCurrentDir,
      createAccount, confirmCreateAccount, unlock, logout, mkdir,
      uploadLocalFile, downloadFile, deleteFile, saveBlindPeers
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [status, view, authPanel, pendingMnemonic, currentDir, entries, toast, uploading, downloading]
  )

  return <DriveContext.Provider value={value}>{children}</DriveContext.Provider>
}

export function useDrive(): DriveContextValue {
  const ctx = useContext(DriveContext)
  if (!ctx) throw new Error('useDrive must be inside DriveProvider')
  return ctx
}
