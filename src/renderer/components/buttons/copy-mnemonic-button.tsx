import { Button } from '@/components/ui/button'
import { useDrive } from '@/context/drive-context'

export function CopyMnemonicButton() {
  const { pendingMnemonic, showToast } = useDrive()

  const handleCopy = async () => {
    const text = String(pendingMnemonic)
    try {
      // Tier 1: Electron IPC bridge (main process has full clipboard access)
      const bridge = window.bridge
      if (bridge && typeof bridge.writeClipboard === 'function') {
        await bridge.writeClipboard(text)
        showToast('Recovery key copied')
        return
      }
    } catch {
      // bridge failed, fall through to DOM fallback
    }
    try {
      // Tier 2: DOM execCommand (works in sandboxed Electron)
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none'
      document.body.appendChild(textarea)
      textarea.focus()
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      showToast('Recovery key copied')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Copy failed')
    }
  }

  return (
    <Button variant="ghost" onClick={handleCopy}>
      Copy
    </Button>
  )
}
