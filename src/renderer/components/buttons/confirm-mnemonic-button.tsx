import { Button } from '@/components/ui/button'
import { useDrive } from '@/context/drive-context'

export function ConfirmMnemonicButton() {
  const { setAuthPanel } = useDrive()

  return (
    <Button onClick={() => setAuthPanel('confirm')}>I saved it — continue</Button>
  )
}
