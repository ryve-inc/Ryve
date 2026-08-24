import { AuthBootPage } from '@/pages/auth-boot-page'
import { AuthConfirmPage } from '@/pages/auth-confirm-page'
import { AuthCreatePage } from '@/pages/auth-create-page'
import { AuthHomePage } from '@/pages/auth-home-page'
import { AuthNamePage } from '@/pages/auth-name-page'
import { AuthUnlockPage } from '@/pages/auth-unlock-page'
import { useDrive } from '@/context/drive-context'
import { ShieldCheck, HardDrive } from 'lucide-react'

export function AuthView() {
  const { authPanel } = useDrive()

  return (
    <section className="relative flex h-full flex-col overflow-auto bg-soil/95">
      <div className="relative z-10 mx-auto grid w-full max-w-300 flex-1 place-content-center gap-8 px-6 py-16">
        <div className="mx-auto w-full max-w-140 text-center">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-leaf/40 bg-fern/40 px-3.5 py-1.5 shadow-lg shadow-leaf/10">
            <ShieldCheck className="h-3.5 w-3.5 text-leaf" />
            <span className="text-[12px] font-semibold text-leaf">Zero-Knowledge Peer-to-Peer Storage</span>
          </div>
          <div className="logo-mark mx-auto" aria-hidden="true" />
          <h1 className="display-heading mt-4 text-[46px] md:text-[58px] font-bold text-white tracking-tight">
            RYVE
          </h1>
          <p className="mx-auto mt-2 max-w-125 text-base text-mute">
            Your keys, your peers. Private networks, erasure-coded storage, zero servers.
          </p>
        </div>

        {authPanel === 'boot' ? <AuthBootPage /> : null}
        {authPanel === 'home' ? <AuthHomePage /> : null}
        {authPanel === 'name' ? <AuthNamePage /> : null}
        {authPanel === 'create' ? <AuthCreatePage /> : null}
        {authPanel === 'confirm' ? <AuthConfirmPage /> : null}
        {authPanel === 'unlock' ? <AuthUnlockPage /> : null}
      </div>

      <footer className="relative z-10 border-t border-line/60 bg-soil">
        <div className="mx-auto flex max-w-300 flex-wrap items-center justify-between gap-3 px-6 py-4">
          <div className="flex items-center gap-2">
            <HardDrive className="h-4 w-4 text-leaf" />
            <span className="display-title text-sm font-bold text-white">RYVE Network</span>
          </div>
          <span className="text-[13px] text-mute">End-to-End Encrypted · Local Key Security</span>
          <span className="flex items-center gap-2 text-[13px] font-mono text-leaf">
            <span className="status-dot" aria-hidden="true" />
            Network operational
          </span>
        </div>
      </footer>
    </section>
  )
}
