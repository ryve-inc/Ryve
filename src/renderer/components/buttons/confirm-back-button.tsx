import { Button } from '@/components/ui/button'
import { useDrive } from '@/context/drive-context'

export function ConfirmBackButton() {
  const { setAuthPanel } = useDrive()

  return (
    <Button type="button" variant="ghost" onClick={() => setAuthPanel('create')}>
      Back
    </Button>
  )
}
