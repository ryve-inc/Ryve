import { useDrive } from '@/context/drive-context'
import { StorageStatsOverview } from '@/components/storage/storage-stats-overview'
import { NetworkCard } from '@/components/network/network-card'
import {
  Server,
  Plus,
  Link as LinkIcon,
  Radio,
  Sparkles
} from 'lucide-react'

export function HomeDashboard() {
  const {
    status,
    displayName,
    openCreateNetworkModal,
    openJoinNetworkModal,
    navigate
  } = useDrive()

  const networks = status.network.networks || []
  const name = displayName || status.displayName || 'Peer'

  const storage = status.storage || {
    totalAllocatedBytes: 0,
    totalUsedBytes: 0,
    totalFreeDiskBytes: 50 * 1024 * 1024 * 1024,
    remainingDriveBytes: 50 * 1024 * 1024 * 1024,
    reservedSystemBytes: 2 * 1024 * 1024 * 1024,
    networks: {}
  }

  return (
    <div className="flex flex-col gap-8 max-w-6xl mx-auto pb-10">
      {/* Welcome Hero Banner */}
      <div className="relative overflow-hidden rounded-3xl border border-line bg-linear-to-r from-soil via-moss to-fern/30 p-7 sm:p-8 shadow-2xl">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-leaf/40 bg-fern/40 px-3 py-1 text-xs font-semibold text-leaf">
              <Sparkles className="h-3.5 w-3.5" />
              <span>P2P Encrypted Cloud Network</span>
            </div>
            <h1 className="display-heading text-3xl md:text-5xl font-bold tracking-tight text-white">
              Hi {name}, welcome to <span className="text-leaf">RYVE</span>
            </h1>
            <p className="text-sm md:text-base text-mute max-w-xl leading-relaxed">
              Your decentralized peer-to-peer storage hub. Allocate storage per network, store files with erasure coding, and seed public catalogs across nodes.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => openCreateNetworkModal('')}
              className="flex items-center gap-2 rounded-xl bg-leaf px-4 py-2.5 text-sm font-semibold text-soil hover:bg-leaf/90 transition-all shadow-lg shadow-leaf/20 cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              <span>Create Network</span>
            </button>
            <button
              onClick={openJoinNetworkModal}
              className="flex items-center gap-2 rounded-xl border border-line bg-moss px-4 py-2.5 text-sm font-semibold text-white hover:border-leaf/50 transition-colors cursor-pointer"
            >
              <LinkIcon className="h-4 w-4 text-leaf" />
              <span>Join Network</span>
            </button>
          </div>
        </div>
      </div>

      {/* Storage & Network Stats Overview Component */}
      <StorageStatsOverview
        storage={storage}
        networks={networks}
        onOpenSettings={() => navigate('settings')}
      />

      {/* Networks Grid Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2 m-0">
              <Radio className="h-5 w-5 text-leaf" />
              <span>Your Joined P2P Networks</span>
            </h2>
            <p className="text-xs text-mute m-0 mt-1">
              Select a network to open files, invite peers, or configure dedicated storage allocation
            </p>
          </div>
        </div>

        {networks.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-line p-10 text-center bg-moss/30 space-y-3">
            <Server className="mx-auto h-10 w-10 text-mute" />
            <h3 className="text-base font-semibold text-white">No networks joined yet</h3>
            <p className="text-xs text-mute max-w-md mx-auto">
              Create your first network workspace or join one with an invite link. Each network gets 1 GB of storage allocated by default.
            </p>
            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                onClick={() => openCreateNetworkModal('')}
                className="inline-flex items-center gap-2 rounded-xl bg-leaf px-4 py-2.5 text-xs font-semibold text-soil hover:bg-leaf/90 cursor-pointer shadow-md shadow-leaf/20"
              >
                <Plus className="h-4 w-4" />
                <span>Create Network</span>
              </button>
              <button
                onClick={openJoinNetworkModal}
                className="inline-flex items-center gap-2 rounded-xl border border-line bg-moss px-4 py-2.5 text-xs font-semibold text-white hover:border-leaf/50 cursor-pointer"
              >
                <LinkIcon className="h-4 w-4 text-leaf" />
                <span>Join Network</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {networks.map((net) => (
              <NetworkCard
                key={net.id}
                network={net}
                storage={storage}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
