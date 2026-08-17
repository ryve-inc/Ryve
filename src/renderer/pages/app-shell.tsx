import { NewFolderButton } from '@/components/buttons/new-folder-button'
import { UploadButton } from '@/components/buttons/upload-button'
import { AppSidebar } from '@/components/app-sidebar'
import { DetailPanel } from '@/components/detail-panel'
import { FilesPage } from '@/pages/files-page'
import { SettingsPage } from '@/pages/settings-page'
import { cn } from '@/lib/utils'
import { useDrive } from '@/context/drive-context'

export function AppShell() {
  const { currentNav, currentDir, dragging, setDragging, uploadFiles, showToast } = useDrive()
  const breadcrumb = currentNav === 'files' ? currentDir : 'Settings'

  return (
    <section className='grid h-full grid-cols-[220px_1fr_auto]'>
      <AppSidebar />

      <main className='flex min-w-0 flex-col'>
        <header className='sticky top-0 z-20 flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-line bg-soil/80 px-5 py-3.5 backdrop-blur-xl'>
          <div className='font-mono text-sm text-mute'>{breadcrumb}</div>
          {currentNav === 'files' ? (
            <div className='flex flex-wrap gap-2'>
              <NewFolderButton />
              <UploadButton />
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
              uploadFiles(e.dataTransfer.files).catch((err) => showToast(err.message))
            }
          }}
        >
          {currentNav === 'files' ? <FilesPage /> : null}
          {currentNav === 'settings' ? <SettingsPage /> : null}
        </div>
      </main>

      <DetailPanel />
    </section>
  )
}
