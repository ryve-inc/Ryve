import { Button } from '@/components/ui/button'
import { useDrive } from '@/context/drive-context'

export function CreateBackButton() {
  const { setAuthFlowActive, setPendingMnemonic, setAuthPanel } = useDrive()

  return (
    <Button
      type='button'
      variant='link'
      onClick={() => {
        setAuthFlowActive(false)
        setPendingMnemonic('')
        setAuthPanel('home')
      }}
    >
      Back
    </Button>
  )
}
