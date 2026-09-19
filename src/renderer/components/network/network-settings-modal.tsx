import { useDrive } from '@/context/drive-context'
import { StorageAllocationSlider } from '@/components/storage/storage-allocation-slider'
import { formatBytes } from '@/lib/format'
import {
  X,
  Copy,
  Users,
  Radio,
  Trash2,
  Folder,
  ArrowRight,
  Sliders,
  ShieldCheck
} from 'lucide-react'

export function NetworkSettingsModal() {
  const {
    networkSettingsModal,
    closeNetworkSettingsModal,
    status,
    copyClipboard,
    showToast,
    switchNetwork,
    removeNetwork,
    navigate,
    setNetworkStorageAllocation
  } = useDrive()

  if (!networkSettingsModal.open || !networkSettingsModal.networkId) return null

  const targetNetwork = (status.network.networks || []).find(
    (n) => n.id === networkSettingsModal.networkId
  )

  if (!targetNetwork) return null

  const storage = status.storage || {
    totalAllocatedBytes: 0,
    totalUsedBytes: 0,
    totalFreeDiskBytes: 50 * 1024 * 1024 * 1024,
    remainingDriveBytes: 50 * 1024 * 1024 * 1024,
    reservedSystemBytes: 2 * 1024 * 1024 * 1024,
    networks: {}
  }

  const networkAlloc =
    storage.networks[targetNetwork.id] || {
      allocatedBytes: targetNetwork.allocatedBytes || 1073741824,
      usedBytes: targetNetwork.usedBytes || 0,
      availableBytes: 1073741824
    }

  const isActive = status.network.activeId === targetNetwork.id

  const handleSaveStorage = async (bytes: number) => {
    await setNetworkStorageAllocation(targetNetwork.id, bytes)
  }

  const handleLeaveNetwork = async () => {
    const ok = window.confirm(`Are you sure you want to leave ${targetNetwork.name}?`)
    if (!ok) return
    closeNetworkSettingsModal()
    await removeNetwork(targetNetwork.id)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md animate-in fade-in duration-200 overflow-y-auto">
      <div className="relative w-full max-w-xl max-h-[90vh] overflow-y-auto custom-scrollbar rounded-3xl border border-line bg-soil p-6 sm:p-7 shadow-2xl space-y-6">
        {/* Close Button */}
        <button
          onClick={closeNetworkSettingsModal}
          className="absolute right-5 top-5 rounded-xl p-2 text-mute hover:bg-moss/50 hover:text-white transition-colors cursor-pointer"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Modal Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-moss border border-line font-mono text-sm font-bold text-leaf shadow-md">
              {targetNetwork.name.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold text-white m-0 truncate max-w-xs">{targetNetwork.name}</h2>
                {isActive ? (
                  <span className="flex items-center gap-1 rounded-full bg-leaf/20 px-2 py-0.5 text-[10px] font-semibold text-leaf border border-leaf/30">
                    <ShieldCheck className="h-3 w-3" />
                    <span>Active</span>
                  </span>
                ) : null}
              </div>
              <span className="text-xs font-mono text-mute">Network ID: {targetNetwork.id}</span>
            </div>
          </div>
        </div>

        {/* Network Stats Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs font-mono">
          <div className="rounded-xl border border-line bg-moss/40 p-3">
            <div className="flex items-center gap-1.5 text-mute text-[11px]">
              <Users className="h-3.5 w-3.5 text-leaf" />
              <span>Peers Connected</span>
            </div>
            <div className="mt-1 font-bold text-base text-white">{targetNetwork.peers || 0}</div>
          </div>

          <div className="rounded-xl border border-line bg-moss/40 p-3">
            <div className="flex items-center gap-1.5 text-mute text-[11px]">
              <Sliders className="h-3.5 w-3.5 text-leaf" />
              <span>Storage Provided</span>
            </div>
            <div className="mt-1 font-bold text-base text-leaf">{formatBytes(networkAlloc.allocatedBytes)}</div>
          </div>

          <div className="rounded-xl border border-line bg-moss/40 p-3 col-span-2 sm:col-span-1">
            <div className="flex items-center gap-1.5 text-mute text-[11px]">
              <Radio className="h-3.5 w-3.5 text-leaf" />
              <span>Used Chunks</span>
            </div>
            <div className="mt-1 font-bold text-base text-soft">{formatBytes(networkAlloc.usedBytes)}</div>
          </div>
        </div>

        {/* Network Storage Allocation Slider Component */}
        <div className="space-y-2">
          <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-mute flex items-center gap-2">
            <span>Storage Space Settings for this Network</span>
          </h3>
          <StorageAllocationSlider
            networkId={targetNetwork.id}
            networkName={targetNetwork.name}
            currentAllocatedBytes={networkAlloc.allocatedBytes}
            currentUsedBytes={networkAlloc.usedBytes}
            freeDiskBytes={storage.totalFreeDiskBytes}
            remainingDriveBytes={storage.remainingDriveBytes}
            onSave={handleSaveStorage}
          />
        </div>

        {/* Invite Link */}
        <div className="space-y-2">
          <label className="text-xs font-medium uppercase tracking-wider text-mute">Network Invite Link</label>
          <div className="flex items-center gap-2 rounded-xl border border-line bg-moss/50 p-2.5">
            <input
              type="text"
              readOnly
              value={targetNetwork.networkLink}
              className="w-full bg-transparent font-mono text-xs text-white outline-none select-all"
            />
            <button
              type="button"
              onClick={() => {
                copyClipboard(targetNetwork.networkLink)
                showToast('Invite link copied')
              }}
              className="flex shrink-0 items-center gap-1.5 rounded-lg bg-leaf/20 px-3 py-1.5 text-xs font-semibold text-leaf hover:bg-leaf/30 transition-colors cursor-pointer"
            >
              <Copy className="h-3.5 w-3.5" />
              <span>Copy</span>
            </button>
          </div>
        </div>

        {/* Bottom Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-line/50">
          <button
            type="button"
            onClick={async () => {
              await switchNetwork(targetNetwork.id)
              closeNetworkSettingsModal()
              navigate('files')
            }}
            className="flex items-center gap-2 rounded-xl bg-moss border border-line hover:border-leaf/50 px-4 py-2 text-xs font-semibold text-white transition-colors cursor-pointer"
          >
            <Folder className="h-3.5 w-3.5 text-leaf" />
            <span>Open Network Files</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            onClick={handleLeaveNetwork}
            className="flex items-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-xs font-semibold text-rose-300 hover:bg-rose-500/20 transition-colors cursor-pointer"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>Leave Network</span>
          </button>
        </div>
      </div>
    </div>
  )
}
