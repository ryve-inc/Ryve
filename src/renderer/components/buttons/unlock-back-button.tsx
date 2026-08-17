import { Button } from '@/components/ui/button'
import { useDrive } from '@/context/drive-context'

export function UnlockBackButton() {
  const { setAuthFlowActive, setAuthPanel } = useDrive()

  return (
    <Button
      type='button'
      variant='ghost'
      onClick={() => {
        setAuthFlowActive(false)
        setAuthPanel('home')
      }}
    >
      Back
    </Button>
  )
}
