import { NewFolderButton } from '@/components/buttons/new-folder-button'
import { UploadButton } from '@/components/buttons/upload-button'
import { AppSidebar } from '@/components/app-sidebar'
import { DetailPanel } from '@/components/detail-panel'
import { FilesPage } from '@/pages/files-page'
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
    openNetworkInfoModal
  } = useDrive()

  const breadcrumb = currentNav === 'files' ? currentDir : 'Settings'

  return (
    <section className="grid h-full grid-cols-[260px_1fr_auto]">
      <AppSidebar />

      <main className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-20 flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-line bg-soil/80 px-5 py-3.5 backdrop-blur-xl">
          <div className="font-mono text-sm text-mute">{breadcrumb}</div>
          {currentNav === 'files' ? (
            <div className="flex flex-wrap items-center gap-2">
              <NewFolderButton />
              <UploadButton />
              <button
                onClick={openNetworkInfoModal}
                className="flex items-center gap-1.5 rounded-xl border border-leaf/40 bg-fern/30 px-3.5 py-2 text-xs font-semibold text-leaf hover:bg-fern/60 transition-colors"
              >
                <Share2 className="h-3.5 w-3.5" />
                <span>Invite to Network</span>
              </button>
            </div>
          ) : null}
        </header>

        <div
          className={cn('min-h-0 flex-1 overflow-auto p-5 md:p-6', dragging && 'drag')}
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
          {currentNav === 'files' ? <FilesPage /> : <SettingsPage />}
        </div>
      </main>

      <DetailPanel />
    </section>
  )
}

