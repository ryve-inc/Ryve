import { NavItemButton } from '@/components/buttons/nav-item-button'
import { useDrive } from '@/context/drive-context'
import { ShieldCheck, Users } from 'lucide-react'

export function AppSidebar() {
  const { status, openNetworkInfoModal } = useDrive()

  return (
    <aside className="flex flex-col gap-5 border-r border-line bg-moss/80 p-3.5 backdrop-blur-xl">
      <div className="flex items-center gap-2.5 px-1.5 py-2">
        <div className="logo-mark logo-mark-sm" aria-hidden="true" />
        <span className="display-title text-base">P2P Drive</span>
      </div>

      <nav className="grid gap-1">
        <NavItemButton nav="files">My Drive</NavItemButton>
        <NavItemButton nav="settings">Settings</NavItemButton>
      </nav>

      <button
        onClick={openNetworkInfoModal}
        className="liquid-panel mt-auto flex flex-col gap-2 p-3 text-left hover:border-leaf/50 transition-colors group cursor-pointer"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs text-leaf font-medium">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>P2P Network</span>
          </div>
          <div className="flex items-center gap-1 text-xs font-mono font-medium text-mute group-hover:text-white">
            <Users className="h-3 w-3" />
            <span>{status.peers || 0}</span>
          </div>
        </div>
        <div className="text-[11px] font-mono text-mute truncate group-hover:text-leaf">
          View Invite Link
        </div>
      </button>
    </aside>
  )
}

