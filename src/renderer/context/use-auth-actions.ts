import { useCallback, useRef, useState } from 'react'
import type { AppStatus, DriveEntry } from '../../shared/types.ts'
import type { AuthPanel, NavName } from './types'
import { emptyStatus } from './types'
import { normalizeMnemonic } from '@/lib/format'
import { rpc } from '@/lib/rpc'

export function useAuthActions({
  showToast,
  setCurrentNav,
  setEntries,
  closeDetail,
  refreshFiles
}: {
  showToast: (msg: string) => void
  setCurrentNav: (nav: NavName) => void
  setEntries: (entries: DriveEntry[]) => void
  closeDetail: () => void
  refreshFiles: () => Promise<void>
}) {
  const [status, setStatus] = useState<AppStatus>(emptyStatus)
  const [view, setView] = useState<'auth' | 'app'>('auth')
  const [authPanel, setAuthPanel] = useState<AuthPanel>('boot')
  const [authFlowActive, setAuthFlowActive] = useState(false)
  const [authResolved, setAuthResolved] = useState(false)
  const [pendingMnemonic, setPendingMnemonic] = useState('')
  const [displayName, setDisplayName] = useState('')

  const authFlowActiveRef = useRef(authFlowActive)
  const authResolvedRef = useRef(authResolved)

  authFlowActiveRef.current = authFlowActive
  authResolvedRef.current = authResolved

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
    [refreshFiles, setCurrentNav, showToast]
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
  }, [closeDetail, setEntries])

  return {
    status,
    setStatus,
    view,
    setView,
    authPanel,
    setAuthPanel,
    authFlowActive,
    setAuthFlowActive,
    authResolved,
    setAuthResolved,
    pendingMnemonic,
    setPendingMnemonic,
    displayName,
    setDisplayName,
    showApp,
    resolveAuth,
    showAuthHome,
    createAccount,
    confirmCreateAccount,
    unlock,
    logout
  }
}
