import { CreateAccountButton } from '@/components/buttons/create-account-button'
import { UnlockShowButton } from '@/components/buttons/unlock-show-button'

export function AuthHomePage() {
  return (
    <div className="auth-panel">
      <CreateAccountButton />
      <UnlockShowButton />
    </div>
  )
}
