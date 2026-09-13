import { Component, type ReactNode } from 'react'
import { CreateNetworkModal } from '@/components/create-network-modal'
import { JoinNetworkModal } from '@/components/join-network-modal'
import { NetworkInfoModal } from '@/components/network-info-modal'
import { PreviewModal } from '@/components/preview-modal'
import { PromptDialog } from '@/components/prompt-dialog'
import { Toast } from '@/components/toast'
import { DriveProvider, useDrive } from '@/context/drive-context'
import { AppShell } from '@/pages/app-shell'
import { AuthView } from '@/pages/auth-view'

interface ErrorBoundaryProps {
  children: ReactNode
}
interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: any) {
    console.error('Unhandled UI render error:', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen w-screen flex-col items-center justify-center bg-soil p-6 text-center text-white">
          <div className="max-w-md rounded-2xl border border-line bg-moss/70 p-6 backdrop-blur-xl shadow-2xl space-y-4">
            <h2 className="text-xl font-bold text-leaf">Something went wrong</h2>
            <p className="text-xs font-mono text-mute break-all bg-soil/90 p-3 rounded-xl border border-line text-left">
              {this.state.error?.message || 'Unknown render error'}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="rounded-xl bg-leaf px-4 py-2 text-xs font-semibold text-soil hover:bg-leaf/90 cursor-pointer"
            >
              Reload Application
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

function Atmosphere() {
  return (
    <>
      <div className="chrome-blobs" aria-hidden="true">
        <div className="chrome-blob chrome-blob-a" />
        <div className="chrome-blob chrome-blob-b" />
      </div>
      <div className="noise-overlay" aria-hidden="true" />
    </>
  )
}
function AppViews() {
  const { view } = useDrive()

  return (
    <>
      <Atmosphere />
      <div className="app-surface h-full min-h-0 overflow-hidden flex flex-col">{view === 'auth' ? <AuthView /> : <AppShell />}</div>
      <Toast />
      <CreateNetworkModal />
      <JoinNetworkModal />
      <NetworkInfoModal />
      <PromptDialog />
      <PreviewModal />
    </>
  )
}

export function App() {
  return (
    <ErrorBoundary>
      <DriveProvider>
        <AppViews />
      </DriveProvider>
    </ErrorBoundary>
  )
}
