import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useDrive } from '@/context/drive-context'

export function CreateAccountButton() {
  const { createAccount, showToast } = useDrive()
  const [busy, setBusy] = useState(false)

  return (
    <Button
      className='w-full'
      disabled={busy}
      onClick={async () => {
        try {
          setBusy(true)
          await createAccount()
        } catch (err) {
          showToast(err instanceof Error ? err.message : String(err))
        } finally {
          setBusy(false)
        }
      }}
    >
      Create account
    </Button>
  )
}
