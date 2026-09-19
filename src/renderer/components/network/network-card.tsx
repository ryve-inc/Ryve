import { useDrive } from '@/context/drive-context'
import { formatBytes } from '@/lib/format'
import type { NetworkItem, StorageInfo } from '@shared/types'
import {
  Users,
  Folder,
  Sliders,
  Copy,
  ArrowRight,
  ShieldCheck,
  HardDrive
} from 'lucide-react'

interface NetworkCardProps {
  network: NetworkItem
  storage?: StorageInfo
}

export function NetworkCard({ network, storage }: NetworkCardProps) {
  const {
    status,
    switchNetwork,
    navigate,
    openNetworkSettingsModal,
    copyClipboard,
    showToast
  } = useDrive()

  const isActive = network.id === status.network.activeId
  const networkAlloc = storage?.networks[network.id] || {
    allocatedBytes: network.allocatedBytes || 1073741824,
    usedBytes: network.usedBytes || 0,
    availableBytes: 1073741824
  }

  const allocatedBytes = networkAlloc.allocatedBytes
  const usedBytes = networkAlloc.usedBytes
  const usedPercent =
    allocatedBytes > 0
      ? Math.min(100, Math.round((usedBytes / allocatedBytes) * 100))
      : 0

  const networkTotalAllocated = network.networkTotalAllocatedBytes || allocatedBytes
  const networkTotalUsed = network.networkTotalUsedBytes || usedBytes
  const networkTotalPercent =
    networkTotalAllocated > 0
      ? Math.min(100, Math.round((networkTotalUsed / networkTotalAllocated) * 100))
      : 0

  return (
    <div
      className={`relative flex flex-col justify-between rounded-3xl border p-5 transition-all duration-200 shadow-lg ${
        isActive
          ? 'border-leaf/60 bg-fern/30 shadow-leaf/10'
          : 'border-line bg-moss/70 hover:border-line-hover'
      }`}
    >
      <div className="space-y-4">
        {/* Header: Initials, Name, Active Badge */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-soil border border-line font-mono text-sm font-bold text-leaf shadow-inner">
              {network.name.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <h3 className="text-sm font-bold text-white truncate max-w-44 m-0">{network.name}</h3>
              <span className="text-[11px] font-mono text-mute">ID: {network.id.slice(0, 8)}</span>
            </div>
          </div>

          {isActive ? (
            <span className="flex items-center gap-1 rounded-full bg-leaf/20 px-2.5 py-0.5 text-[10px] font-semibold text-leaf border border-leaf/30">
              <ShieldCheck className="h-3 w-3" />
              <span>Active</span>
            </span>
          ) : null}
        </div>

        {/* 1. Network Total Storage Pool Box */}
        <div className="rounded-2xl bg-fern/20 border border-leaf/30 p-3 space-y-2">
          <div className="flex items-center justify-between text-xs font-mono">
            <div className="flex items-center gap-1.5 text-mute">
              <ShieldCheck className="h-3.5 w-3.5 text-leaf" />
              <span>Network Total Pool</span>
            </div>
            <span className="font-bold text-leaf">{formatBytes(networkTotalAllocated)}</span>
          </div>

          {/* Network-wide progress bar */}
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-soil">
            <div
              className="h-full bg-leaf transition-all duration-300"
              style={{ width: `${Math.max(2, networkTotalPercent)}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-[10px] font-mono text-mute">
            <span>Network Consumed: <strong className="text-soft">{formatBytes(networkTotalUsed)}</strong> ({networkTotalPercent}%)</span>
            <span>Pool Free: <strong className="text-soft">{formatBytes(Math.max(0, networkTotalAllocated - networkTotalUsed))}</strong></span>
          </div>
        </div>

        {/* 2. This Peer's Storage Provided & Used Box */}
        <div className="rounded-2xl bg-soil/70 border border-line/70 p-3 space-y-2">
          <div className="flex items-center justify-between text-xs font-mono">
            <div className="flex items-center gap-1.5 text-mute">
              <HardDrive className="h-3.5 w-3.5 text-amber-400" />
              <span>My Storage Provided</span>
            </div>
            <span className="font-bold text-amber-400">{formatBytes(allocatedBytes)}</span>
          </div>

          {/* Mini progress bar */}
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-moss">
            <div
              className={`h-full transition-all duration-300 ${
                usedPercent >= 90
                  ? 'bg-rose-500'
                  : usedPercent >= 70
                  ? 'bg-amber-400'
                  : 'bg-leaf'
              }`}
              style={{ width: `${Math.max(2, usedPercent)}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-[10px] font-mono text-mute">
            <span>My Used: <strong className="text-soft">{formatBytes(usedBytes)}</strong> ({usedPercent}%)</span>
            <span>My Free: <strong className="text-soft">{formatBytes(Math.max(0, allocatedBytes - usedBytes))}</strong></span>
          </div>
        </div>

        {/* Peers Count Box */}
        <div className="flex items-center justify-between text-xs font-mono text-mute bg-moss/40 rounded-xl px-3 py-2 border border-line/40">
          <div className="flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5 text-leaf" />
            <span>Connected Peers</span>
          </div>
          <span className="font-bold text-white">{network.peers || 0}</span>
        </div>
      </div>

      {/* Card Actions */}
      <div className="mt-5 pt-3 border-t border-line/50 flex items-center gap-2">
        <button
          onClick={async () => {
            await switchNetwork(network.id)
            navigate('files')
          }}
          className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-leaf/15 hover:bg-leaf hover:text-soil text-leaf text-xs font-semibold py-2.5 transition-colors cursor-pointer"
        >
          <Folder className="h-3.5 w-3.5" />
          <span>Open Files</span>
          <ArrowRight className="h-3 w-3 ml-auto" />
        </button>

        <button
          onClick={() => openNetworkSettingsModal(network.id)}
          title="Network Storage & Settings"
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-line bg-soil text-mute hover:text-leaf hover:border-leaf/50 transition-colors cursor-pointer"
        >
          <Sliders className="h-4 w-4" />
        </button>

        <button
          onClick={() => {
            copyClipboard(network.networkLink)
            showToast('Invite link copied')
          }}
          title="Copy Invite Link"
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-line bg-soil text-mute hover:text-white hover:border-leaf/40 transition-colors cursor-pointer"
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
