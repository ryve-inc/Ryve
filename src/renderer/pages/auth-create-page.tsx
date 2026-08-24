import { ConfirmMnemonicButton } from '@/components/buttons/confirm-mnemonic-button'
import { CopyMnemonicButton } from '@/components/buttons/copy-mnemonic-button'
import { CreateBackButton } from '@/components/buttons/create-back-button'
import { useDrive } from '@/context/drive-context'
import { KeyRound, ShieldAlert } from 'lucide-react'

export function AuthCreatePage() {
  const { pendingMnemonic, displayName } = useDrive()

  return (
    <div className="auth-panel">
      <div className="iris-wash -mx-6 -mt-6 rounded-t-3xl px-6 py-4">
        <p className="meta-label m-0 text-leaf">Step 2 of 3 · Recovery Key</p>
        <h2 className="display-heading m-0 mt-1 text-[24px]">
          {displayName ? `${displayName}, save your 24-word key` : 'Save your recovery key'}
        </h2>
      </div>

      <div className="flex items-start gap-2.5 rounded-xl border border-leaf/30 bg-fern/20 p-3 text-xs text-soft">
        <ShieldAlert className="h-4 w-4 shrink-0 text-leaf mt-0.5" />
        <span>
          This 24-word key is the ONLY way to restore your RYVE account and files. Store it offline in a safe place.
        </span>
      </div>

      <div className="relative">
        <pre className="mnemonic max-h-40 overflow-y-auto p-4 rounded-xl border border-line bg-soil/80 font-mono text-xs text-leaf leading-relaxed select-all">
          {pendingMnemonic}
        </pre>
      </div>

      <div className="flex flex-wrap gap-2 pt-1">
        <CopyMnemonicButton />
        <ConfirmMnemonicButton />
      </div>

      <CreateBackButton />
    </div>
  )
}
