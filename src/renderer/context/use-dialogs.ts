import { useCallback, useRef, useState } from 'react'
import type {
  InviteModalState,
  PromptChoice,
  PromptMode,
  PromptState
} from './types'
import { closedInvite, closedPrompt } from './types'

export function useDialogs() {
  const [toast, setToast] = useState<string | null>(null)
  const [prompt, setPrompt] = useState<PromptState>(closedPrompt)
  const [inviteModal, setInviteModal] = useState<InviteModalState>(closedInvite)

  const [createNetworkModal, setCreateNetworkModal] = useState<{ open: boolean; inviteLink: string }>({
    open: false,
    inviteLink: ''
  })
  const [joinNetworkModal, setJoinNetworkModal] = useState<{ open: boolean }>({ open: false })
  const [networkInfoModal, setNetworkInfoModal] = useState<{ open: boolean }>({ open: false })
  const [networkSettingsModal, setNetworkSettingsModal] = useState<{ open: boolean; networkId: string | null }>({
    open: false,
    networkId: null
  })

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const promptResolve = useRef<((value: string | boolean | null) => void) | null>(null)

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

  const openNetworkSettingsModal = useCallback((networkId: string) => {
    setNetworkSettingsModal({ open: true, networkId })
  }, [])

  const closeNetworkSettingsModal = useCallback(() => {
    setNetworkSettingsModal({ open: false, networkId: null })
  }, [])

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

  return {
    toast,
    showToast,
    prompt,
    closePrompt,
    askDialog,
    askText,
    askConfirm,
    inviteModal,
    openInviteModal,
    closeInviteModal,
    createNetworkModal,
    openCreateNetworkModal,
    closeCreateNetworkModal,
    joinNetworkModal,
    openJoinNetworkModal,
    closeJoinNetworkModal,
    networkInfoModal,
    openNetworkInfoModal,
    closeNetworkInfoModal,
    networkSettingsModal,
    openNetworkSettingsModal,
    closeNetworkSettingsModal,
    copyClipboard
  }
}
