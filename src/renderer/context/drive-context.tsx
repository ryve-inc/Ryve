import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode
} from 'react'
import type { AppStatus } from '../../shared/types.ts'

import { decoder, getBridge, rpc, settlePending } from '@/lib/rpc'
import {
  ensureWorkerStarted,
  subscribeWorkerExit,
  subscribeWorkerIpc
} from '@/lib/worker-bridge'

import { useDialogs } from './use-dialogs'
import { useAuthActions } from './use-auth-actions'
import { useNetworkActions } from './use-network-actions'
import { useFileActions } from './use-file-actions'
import type {
  AuthPanel,
  DriveContextValue,
  InviteModalState,
  NavName,
  PreviewModalState,
  PromptChoice,
  PromptMode,
  PromptState,
  SelectedEntry
} from './types'

export type {
  AuthPanel,
  DriveContextValue,
  InviteModalState,
  NavName,
  PreviewModalState,
  PromptChoice,
  PromptMode,
  PromptState,
  SelectedEntry
}

const DriveContext = createContext<DriveContextValue | null>(null)

export function DriveProvider({ children }: { children: ReactNode }) {
  const dialogs = useDialogs()

  const authActionsRef = useRef<{
    resolveAuth: (unlocked: boolean, nextStatus?: AppStatus | null) => void
    showApp: (nextStatus?: AppStatus | null) => void
  }>({ resolveAuth: () => {}, showApp: () => {} })

  const fileActionsRef = useRef<{
    refreshFiles: () => Promise<void>
    closeDetail: () => void
    setCurrentNav: (nav: NavName) => void
  }>({ refreshFiles: async () => {}, closeDetail: () => {}, setCurrentNav: () => {} })

  const auth = useAuthActions({
    showToast: dialogs.showToast,
    setCurrentNav: (nav) => fileActionsRef.current.setCurrentNav(nav),
    setEntries: (entries) => files.setEntries(entries),
    closeDetail: () => fileActionsRef.current.closeDetail(),
    refreshFiles: () => fileActionsRef.current.refreshFiles()
  })

  const files = useFileActions({
    showToast: dialogs.showToast,
    askConfirm: dialogs.askConfirm,
    setStatus: auth.setStatus
  })

  const network = useNetworkActions({
    setStatus: auth.setStatus,
    showToast: dialogs.showToast,
    refreshFiles: files.refreshFiles,
    resolveAuth: auth.resolveAuth,
    setAuthFlowActive: auth.setAuthFlowActive
  })

  fileActionsRef.current = {
    refreshFiles: files.refreshFiles,
    closeDetail: files.closeDetail,
    setCurrentNav: files.setCurrentNav
  }

  authActionsRef.current = {
    resolveAuth: auth.resolveAuth,
    showApp: auth.showApp
  }

  const askConfirmRef = useRef(dialogs.askConfirm)
  const showToastRef = useRef(dialogs.showToast)
  const resolveAuthRef = useRef(auth.resolveAuth)
  const authResolvedRef = useRef(auth.authResolved)
  const authFlowActiveRef = useRef(auth.authFlowActive)
  const refreshFilesRef = useRef(files.refreshFiles)

  useEffect(() => {
    askConfirmRef.current = dialogs.askConfirm
  }, [dialogs.askConfirm])
  useEffect(() => {
    showToastRef.current = dialogs.showToast
  }, [dialogs.showToast])
  useEffect(() => {
    resolveAuthRef.current = auth.resolveAuth
  }, [auth.resolveAuth])
  useEffect(() => {
    authResolvedRef.current = auth.authResolved
  }, [auth.authResolved])
  useEffect(() => {
    authFlowActiveRef.current = auth.authFlowActive
  }, [auth.authFlowActive])
  useEffect(() => {
    refreshFilesRef.current = files.refreshFiles
  }, [files.refreshFiles])

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
          auth.setStatus((s) => ({ ...s, ...data }))
          // Keep shell/auth view aligned if status announces unlock after boot.
          if (data.unlocked === true && authResolvedRef.current) {
            auth.setView('app')
          }
        }
        if (msg.name === 'public-catalog-updated') {
          refreshFilesRef.current()
          rpc<AppStatus>('getStatus').then((s) => auth.setStatus((prev) => ({ ...prev, ...s }))).catch(() => {})
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
      auth.setAuthFlowActive(false)
      auth.setAuthResolved(false)
      auth.setView('auth')
      auth.setAuthPanel('boot')
      if (restartAttempts >= 2) {
        showToastRef.current('Backend stopped — restart the app')
        auth.setAuthResolved(true)
        auth.setAuthPanel('home')
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
            auth.setAuthResolved(true)
            auth.setAuthPanel('home')
            showToastRef.current('Backend stopped — restart the app')
          })
      }, delay)
    })

    let cancelled = false
    ;(async () => {
      try {
        await ensureWorkerStarted()
        if (cancelled) return
        const s = await rpc<AppStatus>('getStatus')
        if (cancelled) return
        auth.setStatus((prev) => ({ ...prev, ...s }))
        resolveAuthRef.current(!!s.unlocked, s)
      } catch (err) {
        console.error('getStatus failed', err)
        if (!cancelled && !authResolvedRef.current) {
          auth.setAuthResolved(true)
          if (!authFlowActiveRef.current) auth.setAuthPanel('home')
        }
      }
    })()

    return () => {
      cancelled = true
      unsubIpc()
      unsubExit()
    }
  }, [])

  const value = useMemo<DriveContextValue>(
    () => ({
      status: auth.status,
      view: auth.view,
      authPanel: auth.authPanel,
      authFlowActive: auth.authFlowActive,
      pendingMnemonic: auth.pendingMnemonic,
      displayName: auth.displayName,
      setDisplayName: auth.setDisplayName,
      currentNav: files.currentNav,
      currentDir: files.currentDir,
      entries: files.entries,
      selectedEntry: files.selectedEntry,
      detailOpen: files.detailOpen,
      detailName: files.detailName,
      detailMeta: files.detailMeta,
      chunkList: files.chunkList,
      toast: dialogs.toast,
      prompt: dialogs.prompt,
      dragging: files.dragging,
      createNetworkModal: dialogs.createNetworkModal,
      joinNetworkModal: dialogs.joinNetworkModal,
      networkInfoModal: dialogs.networkInfoModal,
      networkSettingsModal: dialogs.networkSettingsModal,
      setDragging: files.setDragging,
      showToast: dialogs.showToast,
      setAuthPanel: auth.setAuthPanel,
      setPendingMnemonic: auth.setPendingMnemonic,
      setAuthFlowActive: auth.setAuthFlowActive,
      navigate: files.navigate,
      refreshFiles: files.refreshFiles,
      setCurrentDir: files.setCurrentDir,
      onEntryClick: files.onEntryClick,
      showDetail: files.showDetail,
      closeDetail: files.closeDetail,
      uploadPaths: files.uploadPaths,
      uploadFiles: files.uploadFiles,
      askDialog: dialogs.askDialog,
      askText: dialogs.askText,
      askConfirm: dialogs.askConfirm,
      closePrompt: dialogs.closePrompt,
      resolveAuth: auth.resolveAuth,
      showAuthHome: auth.showAuthHome,
      showApp: auth.showApp,
      createNetwork: network.createNetwork,
      joinNetwork: network.joinNetwork,
      switchNetwork: network.switchNetwork,
      removeNetwork: network.removeNetwork,
      openCreateNetworkModal: dialogs.openCreateNetworkModal,
      closeCreateNetworkModal: dialogs.closeCreateNetworkModal,
      openJoinNetworkModal: dialogs.openJoinNetworkModal,
      closeJoinNetworkModal: dialogs.closeJoinNetworkModal,
      openNetworkInfoModal: dialogs.openNetworkInfoModal,
      closeNetworkInfoModal: dialogs.closeNetworkInfoModal,
      openNetworkSettingsModal: dialogs.openNetworkSettingsModal,
      closeNetworkSettingsModal: dialogs.closeNetworkSettingsModal,
      createAccount: auth.createAccount,
      confirmCreateAccount: auth.confirmCreateAccount,
      unlock: auth.unlock,
      logout: auth.logout,
      saveBlindPeers: network.saveBlindPeers,
      mkdir: files.mkdir,
      downloadSelected: files.downloadSelected,
      previewSelected: files.previewSelected,
      previewModal: files.previewModal,
      closePreviewModal: files.closePreviewModal,
      deleteSelected: files.deleteSelected,
      copyClipboard: dialogs.copyClipboard,
      setStorageQuota: network.setStorageQuota,
      setNetworkStorageAllocation: network.setNetworkStorageAllocation
    }),
    [
      auth.status,
      auth.view,
      auth.authPanel,
      auth.authFlowActive,
      auth.pendingMnemonic,
      auth.displayName,
      auth.setDisplayName,
      auth.setAuthPanel,
      auth.setPendingMnemonic,
      auth.setAuthFlowActive,
      auth.resolveAuth,
      auth.showAuthHome,
      auth.showApp,
      auth.createAccount,
      auth.confirmCreateAccount,
      auth.unlock,
      auth.logout,
      files.currentNav,
      files.currentDir,
      files.entries,
      files.selectedEntry,
      files.detailOpen,
      files.detailName,
      files.detailMeta,
      files.chunkList,
      files.dragging,
      files.setDragging,
      files.navigate,
      files.refreshFiles,
      files.setCurrentDir,
      files.onEntryClick,
      files.showDetail,
      files.closeDetail,
      files.uploadPaths,
      files.uploadFiles,
      files.mkdir,
      files.downloadSelected,
      files.previewSelected,
      files.previewModal,
      files.closePreviewModal,
      files.deleteSelected,
      dialogs.toast,
      dialogs.prompt,
      dialogs.createNetworkModal,
      dialogs.joinNetworkModal,
      dialogs.networkInfoModal,
      dialogs.networkSettingsModal,
      dialogs.showToast,
      dialogs.askDialog,
      dialogs.askText,
      dialogs.askConfirm,
      dialogs.closePrompt,
      dialogs.openCreateNetworkModal,
      dialogs.closeCreateNetworkModal,
      dialogs.openJoinNetworkModal,
      dialogs.closeJoinNetworkModal,
      dialogs.openNetworkInfoModal,
      dialogs.closeNetworkInfoModal,
      dialogs.openNetworkSettingsModal,
      dialogs.closeNetworkSettingsModal,
      dialogs.copyClipboard,
      network.createNetwork,
      network.joinNetwork,
      network.switchNetwork,
      network.removeNetwork,
      network.saveBlindPeers,
      network.setStorageQuota,
      network.setNetworkStorageAllocation
    ]
  )

  return <DriveContext.Provider value={value}>{children}</DriveContext.Provider>
}

export function useDrive() {
  const ctx = useContext(DriveContext)
  if (!ctx) throw new Error('useDrive must be used within DriveProvider')
  return ctx
}
