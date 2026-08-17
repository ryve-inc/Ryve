import { Button } from '@/components/ui/button'
import { useDrive } from '@/context/drive-context'

export function DetailCloseButton() {
  const { closeDetail } = useDrive()

  return (
    <Button variant='link' onClick={closeDetail}>
      Close
    </Button>
  )
}
