import { useEffect, useState } from 'react'
import { LogoutButton } from '@/components/buttons/logout-button'
import { SaveBlindPeersButton } from '@/components/buttons/save-blind-peers-button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useDrive } from '@/context/drive-context'
import { StorageAllocationSlider } from '@/components/storage/storage-allocation-slider'
import { formatBytes } from '@/lib/format'
import {
  HardDrive,
  Radio,
  Server,
  Sparkles,
  ShieldCheck,
  Plus,
  Sliders
} from 'lucide-react'

export function SettingsPage() {
  const {
    status,
    setNetworkStorageAllocation,
    openCreateNetworkModal,
    openJoinNetworkModal
  } = useDrive()

  const [blindKeys, setBlindKeys] = useState((status.blindPeerKeys || []).join('\n'))
  const [selectedNetworkId, setSelectedNetworkId] = useState<string | null>(null)

  const networks = status.network.networks || []
  const storage = status.storage || {
    totalAllocatedBytes: 0,
    totalUsedBytes: 0,
    totalFreeDiskBytes: 50 * 1024 * 1024 * 1024,
    remainingDriveBytes: 50 * 1024 * 1024 * 1024,
    reservedSystemBytes: 2 * 1024 * 1024 * 1024,
    networks: {}
  }

  useEffect(() => {
    setBlindKeys((status.blindPeerKeys || []).join('\n'))
  }, [status.blindPeerKeys])

  useEffect(() => {
    if (networks.length > 0 && !selectedNetworkId) {
      setSelectedNetworkId(networks[0].id)
    }
  }, [networks, selectedNetworkId])

  const totalAllocated = storage.totalAllocatedBytes || 0
  const totalUsed = storage.totalUsedBytes || 0
  const freeDisk = storage.totalFreeDiskBytes || (50 * 1024 * 1024 * 1024)
  const remainingDrive = storage.remainingDriveBytes || Math.max(0, freeDisk - totalAllocated)

  const activeNetwork = networks.find((n) => n.id === selectedNetworkId) || networks[0] || null
  const activeAlloc = activeNetwork
    ? storage.networks[activeNetwork.id] || {
        allocatedBytes: activeNetwork.allocatedBytes || 1073741824,
        usedBytes: activeNetwork.usedBytes || 0,
        availableBytes: 1073741824
      }
    : null

  const handleSaveNetworkStorage = async (bytes: number) => {
    if (!activeNetwork) return
    await setNetworkStorageAllocation(activeNetwork.id, bytes)
  }

  return (
    <div className="mx-auto max-w-[860px] pb-12 space-y-7">
      <div>
        <p className="meta-label text-leaf font-mono">System & Preferences</p>
        <h2 className="display-heading m-0 mt-1 text-[34px] font-bold text-white">Settings</h2>
      </div>

      {/* Identity Card */}
      <div className="panel-surface overflow-hidden rounded-3xl border border-line bg-soil">
        <div className="iris-wash px-6 py-4 border-b border-line flex items-center justify-between">
          <h3 className="display-title m-0 text-base font-bold text-white">Device Identity</h3>
          <span className="font-mono text-xs text-leaf font-semibold">Online & Ready</span>
        </div>
        <div className="grid gap-3 p-6">
          <div>
            <span className="text-xs text-mute font-mono uppercase">Public Node Identity</span>
            <code className="block mt-1 break-all font-mono text-xs text-soft bg-moss/50 p-2.5 rounded-xl border border-line/60">
              {status.identity || '—'}
            </code>
          </div>
          <div>
            <span className="text-xs text-mute font-mono uppercase">Vault Drive Key</span>
            <code className="block mt-1 font-mono text-xs text-leaf bg-moss/50 p-2.5 rounded-xl border border-line/60">
              {status.driveKey || '—'}
            </code>
          </div>
          <div className="pt-2">
            <LogoutButton />
          </div>
        </div>
      </div>

      {/* Host Storage Drive Overview */}
      <div className="liquid-panel grid gap-5 p-6 border border-line bg-moss/50 rounded-3xl backdrop-blur-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-fern/30 border border-leaf/40 text-leaf">
              <HardDrive className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white m-0 flex items-center gap-2">
                <span>Storage Drive Allocation</span>
                <span className="text-xs font-mono font-normal rounded-full border border-leaf/40 bg-fern/30 px-2.5 py-0.5 text-leaf">
                  Per-Network Mode
                </span>
              </h3>
              <p className="m-0 text-xs text-mute">
                Storage is allocated independently for each network (1 GB default per network)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-leaf font-bold px-3 py-1 rounded-xl bg-fern/30 border border-leaf/30">
              Total Provided: {formatBytes(totalAllocated)}
            </span>
          </div>
        </div>

        {/* Global Storage Meter */}
        <div className="space-y-2 rounded-2xl bg-soil/70 border border-line p-4">
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-mute">
              Host Disk: <strong className="text-white">{formatBytes(freeDisk)}</strong> Free
            </span>
            <span className="text-leaf font-bold">
              Total Used: {formatBytes(totalUsed)} / Total Provided: {formatBytes(totalAllocated)}
            </span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-moss/80">
            <div
              className="h-full bg-linear-to-r from-fern via-leaf to-emerald-400 transition-all duration-300"
              style={{
                width: `${totalAllocated > 0 ? Math.min(100, Math.max(2, (totalUsed / totalAllocated) * 100)) : 0}%`
              }}
            />
          </div>
          <div className="flex items-center justify-between text-[11px] text-mute pt-1">
            <span>Remaining unallocated drive space: <strong className="text-soft font-mono">{formatBytes(remainingDrive)}</strong></span>
            <span>OS Safety buffer: <strong className="text-soft font-mono">2 GB</strong></span>
          </div>
        </div>

        {/* Per-Network Selector & Slider */}
        {networks.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line p-6 text-center bg-soil/50 space-y-2">
            <Server className="mx-auto h-6 w-6 text-mute" />
            <p className="text-xs text-mute m-0">No networks joined yet. Create or join a network to configure storage.</p>
            <div className="flex justify-center gap-2 pt-1">
              <button
                onClick={() => openCreateNetworkModal('')}
                className="px-3 py-1.5 rounded-xl bg-leaf text-soil text-xs font-semibold hover:bg-leaf/90 cursor-pointer"
              >
                Create Network
              </button>
              <button
                onClick={openJoinNetworkModal}
                className="px-3 py-1.5 rounded-xl border border-line bg-moss text-white text-xs font-semibold hover:border-leaf/40 cursor-pointer"
              >
                Join Network
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 pt-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono font-bold uppercase tracking-wider text-mute flex items-center gap-1.5">
                <Sliders className="h-3.5 w-3.5 text-leaf" />
                <span>Configure Storage by Network</span>
              </span>
              <span className="text-[11px] font-mono text-soft">{networks.length} Network{networks.length === 1 ? '' : 's'}</span>
            </div>

            {/* Network Tab Chips */}
            <div className="flex flex-wrap gap-2">
              {networks.map((net) => {
                const isSelected = net.id === (activeNetwork?.id || '')
                const netAllocBytes = net.allocatedBytes || 1073741824
                return (
                  <button
                    key={net.id}
                    onClick={() => setSelectedNetworkId(net.id)}
                    className={`flex items-center gap-2 px-3.5 py-2 rounded-2xl border text-xs font-semibold transition-all cursor-pointer ${
                      isSelected
                        ? 'border-leaf bg-leaf text-soil font-bold shadow-md shadow-leaf/20 scale-105'
                        : 'border-line bg-soil/80 text-mute hover:border-leaf/40 hover:text-white'
                    }`}
                  >
                    <Radio className="h-3.5 w-3.5" />
                    <span>{net.name}</span>
                    <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded-md ${isSelected ? 'bg-soil/20 text-soil' : 'bg-moss text-leaf'}`}>
                      {formatBytes(netAllocBytes)}
                    </span>
                  </button>
                )
              })}
            </div>

            {/* Selected Network Slider Component */}
            {activeNetwork && activeAlloc && (
              <StorageAllocationSlider
                key={activeNetwork.id}
                networkId={activeNetwork.id}
                networkName={activeNetwork.name}
                currentAllocatedBytes={activeAlloc.allocatedBytes}
                currentUsedBytes={activeAlloc.usedBytes}
                freeDiskBytes={freeDisk}
                remainingDriveBytes={remainingDrive}
                onSave={handleSaveNetworkStorage}
              />
            )}
          </div>
        )}
      </div>

      {/* Blind Peers Card */}
      <div className="liquid-panel grid gap-3 p-6 border border-line bg-moss/50 rounded-3xl backdrop-blur-xl">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-leaf" />
          <h3 className="meta-label m-0 text-leaf font-bold">Blind Peer Replication</h3>
        </div>
        <p className="m-0 text-xs leading-relaxed text-mute">
          Pin encrypted replicas to blind peers so files stay reachable when your devices are offline. Paste one public key per line.
        </p>
        <div className="grid gap-2">
          <Label htmlFor="blind-keys" className="sr-only">
            Blind peer keys
          </Label>
          <Textarea
            id="blind-keys"
            rows={4}
            placeholder="z32… blind peer keys"
            value={blindKeys}
            onChange={(e) => setBlindKeys(e.target.value)}
            className="rounded-2xl border border-line bg-soil/70 font-mono text-xs text-white placeholder-mute p-3 focus:border-leaf"
          />
        </div>
        <SaveBlindPeersButton value={blindKeys} />
      </div>
    </div>
  )
}
