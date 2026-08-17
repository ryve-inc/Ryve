import { PreviewModal } from '@/components/preview-modal'
import { PromptDialog } from '@/components/prompt-dialog'
import { Toast } from '@/components/toast'
import { DriveProvider, useDrive } from '@/context/drive-context'
import { AppShell } from '@/pages/app-shell'
import { AuthView } from '@/pages/auth-view'

function Atmosphere() {
  return (
    <>
      <div className='chrome-blobs' aria-hidden='true'>
        <div className='chrome-blob chrome-blob-a' />
        <div className='chrome-blob chrome-blob-b' />
      </div>
      <div className='noise-overlay' aria-hidden='true' />
    </>
  )
}

function AppViews() {
  const { view } = useDrive()

  return (
    <>
      <Atmosphere />
      <div className='app-surface'>{view === 'auth' ? <AuthView /> : <AppShell />}</div>
      <Toast />
      <PromptDialog />
      <PreviewModal />
    </>
  )
}

export function App() {
  return (
    <DriveProvider>
      <AppViews />
    </DriveProvider>
  )
}
