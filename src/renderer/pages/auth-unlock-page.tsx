import { useState } from 'react'
import { UnlockBackButton } from '@/components/buttons/unlock-back-button'
import { UnlockSubmitButton } from '@/components/buttons/unlock-submit-button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useDrive } from '@/context/drive-context'

export function AuthUnlockPage() {
  const { unlock } = useDrive()
  const [mnemonic, setMnemonic] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    try {
      setBusy(true)
      setError('')
      await unlock(mnemonic)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="auth-panel"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <div className="iris-wash -mx-6 -mt-6 rounded-t-3xl px-6 py-4">
        <p className="meta-label m-0 text-leaf">Access</p>
        <h2 className="display-heading m-0 mt-1 text-[24px]">Unlock</h2>
      </div>
      <p className="m-0 text-sm text-mute">Enter the 24-word recovery key for this drive.</p>
      <div className="grid gap-2">
        <Label htmlFor="mnemonic-unlock" className="sr-only">
          Recovery key
        </Label>
        <Textarea
          id="mnemonic-unlock"
          rows={4}
          autoFocus
          placeholder="word1 word2 … word24"
          value={mnemonic}
          onChange={(e) => setMnemonic(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault()
              submit()
            }
          }}
        />
      </div>
      {error ? <p className="m-0 font-mono text-sm text-danger">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <UnlockBackButton />
        <UnlockSubmitButton busy={busy} />
      </div>
    </form>
  )
}
