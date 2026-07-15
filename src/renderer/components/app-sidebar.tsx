import { NavItemButton } from '@/components/buttons/nav-item-button'
import { shortId } from '@/lib/format'
import { useDrive } from '@/context/drive-context'

export function AppSidebar() {
  const { status } = useDrive()

  return (
    <aside className="flex flex-col gap-5 border-r border-line bg-moss/80 p-3.5 backdrop-blur-xl">
      <div className="flex items-center gap-2.5 px-1.5 py-2">
        <div className="logo-mark logo-mark-sm" aria-hidden="true" />
        <span className="display-title text-base">Drive</span>
      </div>

      <nav className="grid gap-1">
        <NavItemButton nav="files">My Drive</NavItemButton>
        <NavItemButton nav="shared">Shared</NavItemButton>
        <NavItemButton nav="settings">Settings</NavItemButton>
      </nav>

      <div className="liquid-panel mt-auto grid gap-1.5 p-3.5 text-sm">
        <div className="flex items-center justify-between">
          <span className="meta-label">Peers</span>
          <span className="font-mono font-medium text-leaf">{status.peers || 0}</span>
        </div>
        <div className="truncate font-mono text-[0.7rem] text-mute">
          {shortId(status.identity)}
        </div>
      </div>
    </aside>
  )
}
