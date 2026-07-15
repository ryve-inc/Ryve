import { Button } from '@/components/ui/button'
import { useDrive } from '@/context/drive-context'

export function ModalCloseButton() {
  const { closeInviteModal } = useDrive()

  return <Button onClick={closeInviteModal}>Done</Button>
}
