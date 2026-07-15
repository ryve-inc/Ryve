import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { ModalCloseButton } from '@/components/buttons/modal-close-button'
import { ModalCopyButton } from '@/components/buttons/modal-copy-button'
import { useDrive } from '@/context/drive-context'

export function InviteModal() {
  const { inviteModal, closeInviteModal } = useDrive()

  return (
    <Dialog open={inviteModal.open} onOpenChange={(open) => !open && closeInviteModal()}>
      <DialogContent className="max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{inviteModal.title}</DialogTitle>
          <DialogDescription>{inviteModal.body}</DialogDescription>
        </DialogHeader>
        <pre className="mnemonic max-h-40 overflow-auto text-xs">{inviteModal.invite}</pre>
        <DialogFooter className="justify-start">
          <ModalCopyButton />
          <ModalCloseButton />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
