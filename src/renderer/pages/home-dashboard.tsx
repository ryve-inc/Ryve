import { useDrive } from '@/context/drive-context'
import {
  Server,
  Users,
  Plus,
  Link as LinkIcon,
  ShieldCheck,
  Folder,
  ArrowRight,
  Sparkles,
  HardDrive,
  Copy,
  Radio
} from 'lucide-react'

export function HomeDashboard() {
  const {
    status,
    displayName,
    switchNetwork,
    createNetwork,
    openCreateNetworkModal,
    openJoinNetworkModal,
    navigate,
    showToast,
    copyClipboard
  } = useDrive()

  const networks = status.network.networks || []
  const activeId = status.network.activeId
  const name = displayName || status.displayName || 'Peer'

  return (
    <div className="flex flex-col gap-8 max-w-6xl mx-auto pb-10">
      {/* Welcome Banner */}
      <div className="relative overflow-hidden rounded-3xl border border-line bg-linear-to-r from-soil via-moss to-fern/30 p-8 shadow-2xl">
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
              Your decentralized peer-to-peer storage hub. Connect to private networks, store files with erasure coding, and seed public catalogs across nodes.
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

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-line bg-moss/60 p-5 backdrop-blur-xl">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono text-mute">JOINED NETWORKS</span>
            <Server className="h-4 w-4 text-leaf" />
          </div>
          <div className="mt-3 text-3xl font-mono font-bold text-white">
            {networks.length}
          </div>
          <p className="mt-1 text-xs text-mute">Active P2P workspaces</p>
        </div>

        <div className="rounded-2xl border border-line bg-moss/60 p-5 backdrop-blur-xl">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono text-mute">ACTIVE PEERS</span>
            <Users className="h-4 w-4 text-leaf" />
          </div>
          <div className="mt-3 text-3xl font-mono font-bold text-leaf">
            {status.peers}
          </div>
          <p className="mt-1 text-xs text-mute">Connected network nodes</p>
        </div>

        <div className="rounded-2xl border border-line bg-moss/60 p-5 backdrop-blur-xl">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono text-mute">STORAGE ENGINE</span>
            <HardDrive className="h-4 w-4 text-leaf" />
          </div>
          <div className="mt-3 text-lg font-mono font-bold text-white">
            Reed-Solomon EC
          </div>
          <p className="mt-1 text-xs text-mute">K=2, M=2 Fault Tolerance</p>
        </div>
      </div>

      {/* Networks Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Radio className="h-5 w-5 text-leaf" />
              <span>Your P2P Networks</span>
            </h2>
            <p className="text-xs text-mute">Select a network to open files or invite peers</p>
          </div>
        </div>

        {networks.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line p-8 text-center bg-moss/30">
            <Server className="mx-auto h-8 w-8 text-mute mb-2" />
            <h3 className="text-sm font-semibold text-white">No networks joined yet</h3>
            <p className="text-xs text-mute mt-1 mb-4">Create your first network or join one via an invite link.</p>
            <button
              onClick={() => openCreateNetworkModal('')}
              className="inline-flex items-center gap-2 rounded-xl bg-leaf px-4 py-2 text-xs font-semibold text-soil hover:bg-leaf/90 cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              <span>Create Network</span>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {networks.map((net) => {
              const isActive = net.id === activeId
              return (
                <div
                  key={net.id}
                  className={`relative flex flex-col justify-between rounded-2xl border p-5 transition-all duration-200 ${
                    isActive
                      ? 'border-leaf/60 bg-fern/30 shadow-lg shadow-leaf/10'
                      : 'border-line bg-moss/70 hover:border-line-hover'
                  }`}
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-soil border border-line font-mono text-xs font-bold text-leaf">
                          {net.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <h3 className="text-sm font-bold text-white truncate max-w-40">{net.name}</h3>
                          <span className="text-[11px] font-mono text-mute">ID: {net.id.slice(0, 8)}</span>
                        </div>
                      </div>

                      {isActive ? (
                        <span className="flex items-center gap-1 rounded-full bg-leaf/20 px-2 py-0.5 text-[10px] font-semibold text-leaf border border-leaf/30">
                          <ShieldCheck className="h-3 w-3" />
                          <span>Active</span>
                        </span>
                      ) : null}
                    </div>

                    <div className="flex items-center justify-between text-xs font-mono text-mute bg-soil/60 rounded-xl px-3 py-2 border border-line/60">
                      <div className="flex items-center gap-1.5">
                        <Users className="h-3.5 w-3.5 text-leaf" />
                        <span>Connected Peers</span>
                      </div>
                      <span className="font-bold text-white">{net.peers || status.peers || 0}</span>
                    </div>
                  </div>

                  <div className="mt-5 pt-3 border-t border-line/50 flex items-center gap-2">
                    <button
                      onClick={async () => {
                        await switchNetwork(net.id)
                        navigate('files')
                      }}
                      className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-leaf/15 hover:bg-leaf hover:text-soil text-leaf text-xs font-semibold py-2 transition-colors cursor-pointer"
                    >
                      <Folder className="h-3.5 w-3.5" />
                      <span>Open Files</span>
                      <ArrowRight className="h-3 w-3 ml-auto" />
                    </button>

                    <button
                      onClick={() => {
                        copyClipboard(net.networkLink)
                        showToast('Invite link copied')
                      }}
                      title="Copy Invite Link"
                      className="flex h-8 w-8 items-center justify-center rounded-xl border border-line bg-soil text-mute hover:text-white hover:border-leaf/40 transition-colors cursor-pointer"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
