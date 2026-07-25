import { Button } from '@/components/ui/button'
import { useDrive } from '@/context/drive-context'

export function ModalCopyButton() {
  const { inviteModal, showToast } = useDrive()

  const handleCopy = async () => {
    const text = String(inviteModal.invite)
    try {
      const bridge = window.bridge
      if (bridge && typeof bridge.writeClipboard === 'function') {
        await bridge.writeClipboard(text)
        showToast('Invite copied')
        return
      }
    } catch {
      // bridge failed, fall through
    }
    try {
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none'
      document.body.appendChild(textarea)
      textarea.focus()
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      showToast('Invite copied')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Copy failed')
    }
  }

  return (
    <Button variant="ghost" onClick={handleCopy}>
      Copy invite
    </Button>
  )
}
