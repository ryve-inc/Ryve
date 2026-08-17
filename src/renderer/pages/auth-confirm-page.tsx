import { useState } from 'react'
import { ConfirmBackButton } from '@/components/buttons/confirm-back-button'
import { ConfirmSubmitButton } from '@/components/buttons/confirm-submit-button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useDrive } from '@/context/drive-context'

export function AuthConfirmPage() {
  const { confirmCreateAccount } = useDrive()
  const [mnemonic, setMnemonic] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    try {
      setBusy(true)
      setError('')
      await confirmCreateAccount(mnemonic)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className='auth-panel'
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <div className='iris-wash -mx-6 -mt-6 rounded-t-3xl px-6 py-4'>
        <p className='meta-label m-0 text-leaf'>Confirm</p>
        <h2 className='display-heading m-0 mt-1 text-[24px]'>Confirm recovery key</h2>
      </div>
      <p className='m-0 text-sm text-mute'>Type or paste your recovery key to confirm.</p>
      <div className='grid gap-2'>
        <Label htmlFor='mnemonic-confirm' className='sr-only'>
          Recovery key
        </Label>
        <Textarea
          id='mnemonic-confirm'
          rows={4}
          autoFocus
          placeholder='word1 word2 … word24'
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
      {error ? <p className='m-0 font-mono text-sm text-danger'>{error}</p> : null}
      <div className='flex flex-wrap gap-2'>
        <ConfirmBackButton />
        <ConfirmSubmitButton busy={busy} />
      </div>
    </form>
  )
}
