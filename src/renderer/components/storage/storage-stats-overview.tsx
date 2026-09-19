import { formatBytes } from '@/lib/format'
import type { StorageInfo, NetworkItem } from '@shared/types'
import { Server, HardDrive, Database, ShieldCheck, Sparkles, Layers } from 'lucide-react'

interface StorageStatsOverviewProps {
  storage: StorageInfo
  networks: NetworkItem[]
  onOpenSettings?: () => void
}

const NETWORK_COLORS = [
  'bg-emerald-400',
  'bg-teal-400',
  'bg-cyan-400',
  'bg-sky-400',
  'bg-indigo-400',
  'bg-violet-400',
  'bg-amber-400',
  'bg-rose-400'
]

export function StorageStatsOverview({
  storage,
  networks,
  onOpenSettings
}: StorageStatsOverviewProps) {
  const totalAllocated = storage.totalAllocatedBytes || 0
  const totalUsed = storage.totalUsedBytes || 0
  const freeDisk = storage.totalFreeDiskBytes || 50 * 1024 * 1024 * 1024
  const remainingDrive = storage.remainingDriveBytes || Math.max(0, freeDisk - totalAllocated)

  const usedPercent =
    totalAllocated > 0
      ? Math.min(100, Math.round((totalUsed / totalAllocated) * 100))
      : 0

  return (
    <div className="space-y-4">
      {/* 4 Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Joined Networks */}
        <div className="rounded-2xl border border-line bg-moss/60 p-5 backdrop-blur-xl shadow-lg">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono text-mute">JOINED NETWORKS</span>
            <Server className="h-4 w-4 text-leaf" />
          </div>
          <div className="mt-3 text-3xl font-mono font-bold text-white">
            {networks.length}
          </div>
          <p className="mt-1 text-xs text-mute">Active P2P workspaces</p>
        </div>

        {/* Card 2: Total Storage Provided (Sum of all Networks) */}
        <div
          onClick={onOpenSettings}
          className="rounded-2xl border border-leaf/40 bg-fern/20 p-5 backdrop-blur-xl shadow-lg hover:border-leaf transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono text-leaf font-semibold group-hover:underline flex items-center gap-1">
              <span>TOTAL STORAGE PROVIDED</span>
              <Sparkles className="h-3 w-3" />
            </span>
            <HardDrive className="h-4 w-4 text-leaf group-hover:scale-110 transition-transform" />
          </div>
          <div className="mt-3 text-3xl font-mono font-bold text-white">
            {formatBytes(totalAllocated)}
          </div>
          <p className="mt-1 text-xs text-mute">
            Sum of storages across {networks.length} network{networks.length === 1 ? '' : 's'} (1 GB default)
          </p>
        </div>

        {/* Card 3: Total Storage Used */}
        <div className="rounded-2xl border border-line bg-moss/60 p-5 backdrop-blur-xl shadow-lg">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono text-mute">TOTAL USED STORAGE</span>
            <Database className="h-4 w-4 text-leaf" />
          </div>
          <div className="mt-3 text-3xl font-mono font-bold text-leaf">
            {formatBytes(totalUsed)}
          </div>
          <p className="mt-1 text-xs text-mute">
            {usedPercent}% of total allocated capacity
          </p>
        </div>

        {/* Card 4: Host Storage Drive Space */}
        <div className="rounded-2xl border border-line bg-moss/60 p-5 backdrop-blur-xl shadow-lg">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono text-mute">STORAGE DRIVE SPACE</span>
            <ShieldCheck className="h-4 w-4 text-leaf" />
          </div>
          <div className="mt-3 text-2xl font-mono font-bold text-white">
            {formatBytes(freeDisk)}
          </div>
          <p className="mt-1 text-xs text-mute">
            Remaining unallocated: <strong className="text-soft font-mono">{formatBytes(remainingDrive)}</strong>
          </p>
        </div>
      </div>

      {/* Multi-Network Color-Coded Storage Allocation Distribution Bar */}
      {networks.length > 0 && totalAllocated > 0 && (
        <div className="rounded-2xl border border-line/80 bg-moss/40 p-4 backdrop-blur-xl space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-leaf" />
              <span className="font-semibold text-white">Storage Allocation Distribution (Per Network)</span>
            </div>
            <span className="font-mono text-mute text-[11px]">
              Total Allocated: <strong className="text-leaf">{formatBytes(totalAllocated)}</strong> / Host Free: <strong className="text-soft">{formatBytes(freeDisk)}</strong>
            </span>
          </div>

          {/* Segmented Progress Bar */}
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-soil p-0.5 border border-line/40">
            {networks.map((net, idx) => {
              const netAlloc = net.allocatedBytes || 1073741824
              const sharePercent = Math.max(2, (netAlloc / totalAllocated) * 100)
              const colorClass = NETWORK_COLORS[idx % NETWORK_COLORS.length]

              return (
                <div
                  key={net.id}
                  className={`h-full ${colorClass} transition-all duration-300 first:rounded-l-full last:rounded-r-full`}
                  style={{ width: `${sharePercent}%` }}
                  title={`${net.name}: ${formatBytes(netAlloc)} (${sharePercent.toFixed(1)}%)`}
                />
              )
            })}
          </div>

          {/* Legend Items */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-1 text-[11px] font-mono">
            {networks.map((net, idx) => {
              const colorClass = NETWORK_COLORS[idx % NETWORK_COLORS.length]
              const netAlloc = net.allocatedBytes || 1073741824
              const netUsed = net.usedBytes || 0

              return (
                <div key={net.id} className="flex items-center gap-1.5">
                  <span className={`h-2.5 w-2.5 rounded-full ${colorClass} shrink-0`} />
                  <span className="text-white font-medium truncate max-w-28">{net.name}:</span>
                  <span className="text-leaf font-bold">{formatBytes(netAlloc)}</span>
                  <span className="text-mute text-[10px]">({formatBytes(netUsed)} used)</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
