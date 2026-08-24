import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useDrive } from '@/context/drive-context'
import { User, ArrowRight, ArrowLeft } from 'lucide-react'

export function AuthNamePage() {
  const { displayName, setDisplayName, createAccount, setAuthPanel } = useDrive()
  const [nameInput, setNameInput] = useState(displayName || '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    const trimmed = nameInput.trim()
    if (!trimmed) {
      setError('Please enter your display name.')
      return
    }
    try {
      setBusy(true)
      setError('')
      setDisplayName(trimmed)
      await createAccount(trimmed)
    } catch (err: any) {
      setError(err?.message || String(err))
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
        <p className="meta-label m-0 text-leaf">Step 1 of 3</p>
        <h2 className="display-heading m-0 mt-1 text-[24px]">What should we call you?</h2>
      </div>

      <p className="m-0 text-sm text-mute">
        Enter your public display name. This name will be visible to connected network peers.
      </p>

      <div className="grid gap-2">
        <Label htmlFor="display-name" className="text-xs font-semibold text-leaf">
          Public Display Name
        </Label>
        <div className="relative">
          <User className="absolute left-3.5 top-3 h-4 w-4 text-mute" />
          <Input
            id="display-name"
            type="text"
            autoFocus
            placeholder="e.g. Alex, Satoshi, Sam..."
            value={nameInput}
            onChange={(e) => {
              setNameInput(e.target.value)
              if (error) setError('')
            }}
            className="pl-10"
          />
        </div>
      </div>

      {error ? <p className="m-0 font-mono text-xs text-danger">{error}</p> : null}

      <div className="flex flex-wrap gap-2 pt-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => setAuthPanel('home')}
          className="flex items-center gap-1.5"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back</span>
        </Button>

        <Button
          type="submit"
          disabled={busy || !nameInput.trim()}
          className="flex-1 flex items-center justify-center gap-2 bg-leaf text-soil hover:bg-leaf/90 font-semibold"
        >
          <span>{busy ? 'Generating Key...' : 'Continue to Recovery Key'}</span>
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </form>
  )
}
