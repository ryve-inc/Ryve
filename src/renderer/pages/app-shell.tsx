import { NewFolderButton } from '@/components/buttons/new-folder-button'
import { UploadButton } from '@/components/buttons/upload-button'
import { AppSidebar } from '@/components/app-sidebar'
import { DetailPanel } from '@/components/detail-panel'
import { FilesPage } from '@/pages/files-page'
import { HomeDashboard } from '@/pages/home-dashboard'
import { SettingsPage } from '@/pages/settings-page'
import { cn } from '@/lib/utils'
import { useDrive } from '@/context/drive-context'
import { Share2 } from 'lucide-react'

export function AppShell() {
  const {
    currentNav,
    currentDir,
    dragging,
    setDragging,
    uploadFiles,
    openNetworkInfoModal,
    status
  } = useDrive()

  const activeNetwork = (status.network.networks || []).find((n) => n.id === status.network.activeId)

  const breadcrumb =
    currentNav === 'home'
      ? 'RYVE / Dashboard'
      : currentNav === 'settings'
        ? 'RYVE / Settings & Storage Allocation'
        : `${activeNetwork?.name || 'P2P Network'} ${currentDir}`

  return (
    <section className="grid h-full min-h-0 grid-cols-[280px_1fr_auto] overflow-hidden">
      <AppSidebar />

      <main className="flex min-w-0 min-h-0 h-full flex-col overflow-hidden">
        <header className="sticky top-0 z-20 flex min-h-16 shrink-0 flex-wrap items-center justify-between gap-3 border-b border-line bg-soil/80 px-5 py-3.5 backdrop-blur-xl">
          <div className="font-mono text-sm text-mute">{breadcrumb}</div>
          {currentNav === 'files' ? (
            <div className="flex flex-wrap items-center gap-2">
              <NewFolderButton />
              <UploadButton />
              <button
                onClick={openNetworkInfoModal}
                className="flex items-center gap-1.5 rounded-xl border border-leaf/40 bg-fern/30 px-3.5 py-2 text-xs font-semibold text-leaf hover:bg-fern/60 transition-colors cursor-pointer"
              >
                <Share2 className="h-3.5 w-3.5" />
                <span>Invite to Network</span>
              </button>
            </div>
          ) : null}
        </header>

        <div
          className={cn('min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-5 md:p-6 custom-scrollbar', dragging && 'drag')}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            if (currentNav === 'files') {
              uploadFiles(e.dataTransfer.files).catch((err) => console.error(err))
            }
          }}
        >
          {currentNav === 'home' ? (
            <HomeDashboard />
          ) : currentNav === 'settings' ? (
            <SettingsPage />
          ) : (
            <FilesPage />
          )}
        </div>
      </main>

      <DetailPanel />
    </section>
  )
}
