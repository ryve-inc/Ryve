import { AuthBootPage } from '@/pages/auth-boot-page'
import { AuthConfirmPage } from '@/pages/auth-confirm-page'
import { AuthCreatePage } from '@/pages/auth-create-page'
import { AuthHomePage } from '@/pages/auth-home-page'
import { AuthUnlockPage } from '@/pages/auth-unlock-page'
import { useDrive } from '@/context/drive-context'

export function AuthView() {
  const { authPanel } = useDrive()

  return (
    <section className='relative flex h-full flex-col overflow-auto'>
      <div className='relative z-10 mx-auto grid w-full max-w-[1200px] flex-1 place-content-center gap-8 px-6 py-16'>
        <div className='mx-auto w-full max-w-[560px] text-center'>
          <div className='mb-5 inline-flex items-center gap-2 rounded-full border border-line bg-fern/40 px-3 py-1.5'>
            <span className='status-dot' aria-hidden='true' />
            <span className='text-[12px] text-soft'>Encrypted peer-to-peer storage</span>
          </div>
          <div className='logo-mark' aria-hidden='true' />
          <h1 className='display-heading mt-5 text-[46px] md:text-[58px]'>Drive</h1>
          <p className='mx-auto mt-3 max-w-[560px] text-base text-mute'>
            Your keys, your peers. No seats, no surprises.
          </p>
        </div>

        {authPanel === 'boot' ? <AuthBootPage /> : null}
        {authPanel === 'home' ? <AuthHomePage /> : null}
        {authPanel === 'create' ? <AuthCreatePage /> : null}
        {authPanel === 'confirm' ? <AuthConfirmPage /> : null}
        {authPanel === 'unlock' ? <AuthUnlockPage /> : null}
      </div>

      <footer className='relative z-10 border-t border-line'>
        <div className='mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-3 px-6 py-4'>
          <div className='flex items-center gap-2'>
            <div className='logo-mark logo-mark-sm' aria-hidden='true' />
            <span className='display-title text-sm'>Drive</span>
          </div>
          <span className='text-[13px] text-mute'>Cancel anytime · Your keys stay local</span>
          <span className='flex items-center gap-2 text-[13px] text-mute'>
            <span className='status-dot' aria-hidden='true' />
            System operational
          </span>
        </div>
      </footer>
    </section>
  )
}
