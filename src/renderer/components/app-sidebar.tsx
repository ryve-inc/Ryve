import { useDrive } from '@/context/drive-context'
import { Plus, Server, Home, Folder, Sliders } from 'lucide-react'

export function AppSidebar() {
  const {
    status,
    currentNav,
    navigate,
    switchNetwork,
    openCreateNetworkModal
  } = useDrive()

  const networks = status.network.networks || []
  const activeId = status.network.activeId
  const activeNetwork = networks.find((n) => n.id === activeId)

  return (
    <aside className="flex h-full border-r border-line bg-moss/90 backdrop-blur-xl">
      {/* Discord-style Vertical Network Rail */}
      <div className="flex w-16 flex-col items-center gap-3 border-r border-line/60 bg-soil/90 py-4">
        {/* RYVE Logo Home Redirect Button */}
        <button
          onClick={() => navigate('home')}
          className={`group relative flex h-11 w-11 items-center justify-center rounded-2xl transition-all duration-200 cursor-pointer ${
            currentNav === 'home'
              ? 'bg-leaf text-soil shadow-lg shadow-leaf/30 scale-105'
              : 'bg-fern/40 border border-line text-leaf hover:bg-leaf hover:text-soil hover:rounded-xl'
          }`}
          title="RYVE Home Dashboard"
        >
          <Home className="h-5 w-5" />
        </button>

        <div className="h-px w-8 bg-line/60" />

        {/* Joined Networks Icons */}
        <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto custom-scrollbar w-full items-center px-2">
          {networks.map((net) => {
            const isActive = net.id === activeId && currentNav === 'files'
            const initials = net.name.split(' ').map((s) => s[0]).join('').slice(0, 2).toUpperCase() || 'NET'

            return (
              <div key={net.id} className="relative group flex items-center">
                {/* Active Indicator Bar */}
                {isActive ? (
                  <div className="absolute -left-2 top-1.5 h-6 w-1 rounded-r bg-leaf shadow-[0_0_8px_rgba(52,211,153,0.5)]" />
                ) : null}

                <button
                  onClick={async () => {
                    await switchNetwork(net.id)
                    navigate('files')
                  }}
                  className={`relative flex h-11 w-11 items-center justify-center rounded-2xl font-mono text-xs font-bold transition-all duration-200 cursor-pointer ${
                    isActive
                      ? 'bg-leaf text-soil shadow-lg shadow-leaf/20 scale-105'
                      : 'bg-moss border border-line text-mute hover:border-leaf/50 hover:text-white hover:rounded-xl'
                  }`}
                  title={`${net.name} (${net.peers || status.peers || 0} active peers)`}
                >
                  {initials}
                  {/* Peer Count Badge */}
                  <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-soil border border-line text-[9px] font-mono font-bold text-leaf">
                    {net.peers || status.peers || 0}
                  </span>
                </button>
              </div>
            )
          })}

          {/* Create New Network Button */}
          <button
            onClick={() => openCreateNetworkModal('')}
            className="flex h-11 w-11 items-center justify-center rounded-2xl border border-dashed border-leaf/40 bg-fern/20 text-leaf hover:bg-leaf hover:text-soil hover:rounded-xl transition-all duration-200 cursor-pointer mt-1"
            title="Create New Network"
          >
            <Plus className="h-5 w-5" />
          </button>
        </div>

        {/* Settings & Storage Button in Vertical Rail */}
        <div className="h-px w-8 bg-line/60 my-1" />
        <button
          onClick={() => navigate('settings')}
          className={`group relative flex h-11 w-11 items-center justify-center rounded-2xl transition-all duration-200 cursor-pointer ${
            currentNav === 'settings'
              ? 'bg-leaf text-soil shadow-lg shadow-leaf/30 scale-105'
              : 'bg-moss border border-line text-mute hover:border-leaf/50 hover:text-white hover:rounded-xl'
          }`}
          title="Settings & Storage Allocation"
        >
          <Sliders className="h-5 w-5" />
        </button>
      </div>

      {/* Main Navigation Panel */}
      <div className="flex flex-1 flex-col justify-between p-3.5">
        <div className="flex flex-col gap-4 overflow-hidden">
          <div className="flex items-center gap-2 px-1 py-1">
            <Server className="h-4 w-4 text-leaf" />
            <span className="display-title text-sm font-semibold truncate text-white">
              {currentNav === 'home'
                ? 'RYVE Dashboard'
                : currentNav === 'settings'
                  ? 'Preferences'
                  : activeNetwork?.name || 'P2P Workspace'}
            </span>
          </div>

          <nav className="flex-1 overflow-y-auto custom-scrollbar space-y-1">
            <div className="text-[10px] font-mono uppercase tracking-wider text-mute px-2 py-1">
              Networks ({networks.length})
            </div>

            {networks.map((net) => {
              const isActive = net.id === activeId && currentNav === 'files'
              return (
                <button
                  key={net.id}
                  onClick={async () => {
                    await switchNetwork(net.id)
                    navigate('files')
                  }}
                  className={`w-full flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-leaf/15 text-leaf font-bold border border-leaf/30'
                      : 'text-mute hover:bg-fern/30 hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    <Folder className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{net.name}</span>
                  </div>
                  <span className="font-mono text-[10px] bg-soil/60 px-1.5 py-0.5 rounded text-leaf">
                    {net.peers || status.peers || 0}
                  </span>
                </button>
              )
            })}
          </nav>
        </div>

        {/* Bottom Settings Link */}
        <div className="pt-2 border-t border-line/60">
          <button
            onClick={() => navigate('settings')}
            className={`w-full flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-xs font-semibold transition-all cursor-pointer ${
              currentNav === 'settings'
                ? 'bg-leaf text-soil font-bold shadow-md shadow-leaf/20'
                : 'text-mute hover:bg-fern/30 hover:text-white border border-transparent hover:border-line'
            }`}
          >
            <Sliders className="h-4 w-4 shrink-0" />
            <span>Settings & Storage</span>
          </button>
        </div>
      </div>
    </aside>
  )
}
