import { Button } from '@/components/ui/button'
import { useDrive } from '@/context/drive-context'

export function ShareBackButton() {
  const { closeShare } = useDrive()

  return (
    <Button variant="link" onClick={closeShare}>
      ← Back to shares
    </Button>
  )
}
