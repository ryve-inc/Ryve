import { Button } from '@/components/ui/button'
import { useDrive } from '@/context/drive-context'

export function UnlockShowButton() {
  const { setAuthFlowActive, setAuthPanel } = useDrive()

  return (
    <Button
      variant="ghost"
      className="w-full"
      onClick={() => {
        setAuthFlowActive(true)
        setAuthPanel('unlock')
      }}
    >
      Unlock with recovery key
    </Button>
  )
}
