import { Button } from '@/components/ui/button'
import { getBridge } from '@/lib/rpc'
import { useDrive } from '@/context/drive-context'

export function CopyMnemonicButton() {
  const { pendingMnemonic, showToast } = useDrive()

  return (
    <Button
      variant="ghost"
      onClick={() => {
        try {
          getBridge().writeClipboard(pendingMnemonic)
          showToast('Recovery key copied')
        } catch (err) {
          showToast(err instanceof Error ? err.message : 'Copy failed')
        }
      }}
    >
      Copy
    </Button>
  )
}
