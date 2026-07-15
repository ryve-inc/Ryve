import { ConfirmMnemonicButton } from '@/components/buttons/confirm-mnemonic-button'
import { CopyMnemonicButton } from '@/components/buttons/copy-mnemonic-button'
import { CreateBackButton } from '@/components/buttons/create-back-button'
import { useDrive } from '@/context/drive-context'

export function AuthCreatePage() {
  const { pendingMnemonic } = useDrive()

  return (
    <div className="auth-panel">
      <div className="iris-wash -mx-6 -mt-6 rounded-t-3xl px-6 py-4">
        <p className="meta-label m-0 text-leaf">Recovery</p>
        <h2 className="display-heading m-0 mt-1 text-[24px]">Save your recovery key</h2>
      </div>
      <p className="m-0 text-sm leading-relaxed text-mute">
        This 24-word key is the only way to restore your drive. Store it offline. We cannot recover
        it for you.
      </p>
      <pre className="mnemonic">{pendingMnemonic}</pre>
      <div className="flex flex-wrap gap-2">
        <CopyMnemonicButton />
        <ConfirmMnemonicButton />
      </div>
      <CreateBackButton />
    </div>
  )
}
