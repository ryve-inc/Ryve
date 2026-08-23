import { NavItemButton } from '@/components/buttons/nav-item-button'
import { useDrive } from '@/context/drive-context'
import { ShieldCheck, Users, Plus, Radio, Server } from 'lucide-react'

export function AppSidebar() {
  const {
    status,
    switchNetwork,
    openJoinNetworkModal,
    openCreateNetworkModal,
    openNetworkInfoModal
  } = useDrive()

  const networks = status.network.networks || []
  const activeId = status.network.activeId

  return (
    <aside className="flex h-full border-r border-line bg-moss/90 backdrop-blur-xl">
      {/* Discord-style Vertical Network Rail */}
      <div className="flex w-15 flex-col items-center gap-3 border-r border-line/60 bg-soil/90 py-4">
        <div className="logo-mark logo-mark-sm mb-1" aria-hidden="true" title="P2P Cloud" />
        
        <div className="h-px w-8 bg-line/60" />

        {/* Joined Networks Icons */}
        <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto w-full items-center px-2">
          {networks.map((net, idx) => {
            const isActive = net.id === activeId || (networks.length === 1 && idx === 0)
            const initials = net.name.split(' ').map(s => s[0]).join('').slice(0, 2).toUpperCase() || 'NET'

            return (
              <div key={net.id} className="relative group flex items-center">
                {/* Active Indicator Bar */}
                {isActive ? (
                  <div className="absolute -left-2 top-1.5 h-6 w-1 rounded-r bg-leaf shadow-[0_0_8px_rgba(52,211,153,0.5)]" />
                ) : null}

                <button
                  onClick={() => switchNetwork(net.id)}
                  className={`relative flex h-11 w-11 items-center justify-center rounded-2xl font-mono text-xs font-bold transition-all duration-200 cursor-pointer ${
                    isActive
                      ? 'bg-leaf text-soil shadow-lg shadow-leaf/20 scale-105'
                      : 'bg-moss border border-line text-mute hover:border-leaf/50 hover:text-white hover:rounded-xl'
                  }`}
                  title={`${net.name} (${net.peers || status.peers || 0} peers connected)`}
                >
                  {initials}
                  {/* Peer Count Badge */}
                  <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-soil border border-line text-[9px] font-mono text-leaf">
                    {net.peers || status.peers || 0}
                  </span>
                </button>
              </div>
            )
          })}

          {/* Add / Join Network Action Button */}
          <button
            onClick={openJoinNetworkModal}
            className="flex h-11 w-11 items-center justify-center rounded-2xl border border-dashed border-leaf/40 bg-fern/20 text-leaf hover:bg-leaf hover:text-soil hover:rounded-xl transition-all duration-200 cursor-pointer mt-1"
            title="Join or Create Network"
          >
            <Plus className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Main Navigation Panel */}
      <div className="flex flex-1 flex-col gap-5 p-3.5">
        <div className="flex items-center gap-2 px-1 py-1">
          <Server className="h-4 w-4 text-leaf" />
          <span className="display-title text-sm font-semibold truncate">
            {networks.find(n => n.id === activeId)?.name || 'P2P Workspace'}
          </span>
        </div>

        <nav className="grid gap-1">
          <NavItemButton nav="files">My Drive</NavItemButton>
          <NavItemButton nav="settings">Settings</NavItemButton>
        </nav>

        {/* Network Invite Card */}
        <button
          onClick={openNetworkInfoModal}
          className="liquid-panel mt-auto flex flex-col gap-2 p-3 text-left hover:border-leaf/50 transition-colors group cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs text-leaf font-medium">
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>Active Network</span>
            </div>
            <div className="flex items-center gap-1 text-xs font-mono font-medium text-mute group-hover:text-white">
              <Users className="h-3 w-3" />
              <span>{status.peers || 0}</span>
            </div>
          </div>
          <div className="text-[11px] font-mono text-mute truncate group-hover:text-leaf">
            View Invite & Key
          </div>
        </button>
      </div>
    </aside>
  )
}

