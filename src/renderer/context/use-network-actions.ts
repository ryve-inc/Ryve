import { useCallback } from 'react'
import type { AppStatus } from '../../shared/types.ts'
import { rpc } from '@/lib/rpc'

export function useNetworkActions({
  setStatus,
  showToast,
  refreshFiles,
  resolveAuth,
  setAuthFlowActive
}: {
  setStatus: React.Dispatch<React.SetStateAction<AppStatus>>
  showToast: (msg: string) => void
  refreshFiles: () => Promise<void>
  resolveAuth: (unlocked: boolean, nextStatus?: AppStatus | null) => void
  setAuthFlowActive: (active: boolean) => void
}) {
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
    [setStatus, showToast]
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
    [setStatus, showToast]
  )

  const setNetworkStorageAllocation = useCallback(
    async (networkId: string, allocatedBytes: number) => {
      try {
        const next = await rpc<AppStatus>('setNetworkStorageAllocation', { id: networkId, allocatedBytes })
        setStatus((prev) => ({ ...prev, ...next }))
        showToast('Network storage allocation updated')
      } catch (err: any) {
        showToast(`Failed to update storage: ${err?.message || err}`)
        throw err
      }
    },
    [setStatus, showToast]
  )

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
    [refreshFiles, setStatus, showToast]
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
    [resolveAuth, setAuthFlowActive, showToast]
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
    [refreshFiles, setStatus, showToast]
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
    [refreshFiles, setStatus, showToast]
  )

  return {
    saveBlindPeers,
    setStorageQuota,
    setNetworkStorageAllocation,
    createNetwork,
    joinNetwork,
    switchNetwork,
    removeNetwork
  }
}
