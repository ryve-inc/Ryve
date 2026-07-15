import { Button } from '@/components/ui/button'
import { getBridge } from '@/lib/rpc'
import { useDrive } from '@/context/drive-context'

export function ModalCopyButton() {
  const { inviteModal, showToast } = useDrive()

  return (
    <Button
      variant="ghost"
      onClick={() => {
        try {
          getBridge().writeClipboard(inviteModal.invite)
          showToast('Invite copied')
        } catch (err) {
          showToast(err instanceof Error ? err.message : 'Copy failed')
        }
      }}
    >
      Copy invite
    </Button>
  )
}
