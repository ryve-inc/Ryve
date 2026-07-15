import { Button } from '@/components/ui/button'
import { useDrive } from '@/context/drive-context'

export function DownloadButton() {
  const { downloadSelected, showToast } = useDrive()

  return (
    <Button
      onClick={async () => {
        try {
          await downloadSelected()
        } catch (err) {
          showToast(err instanceof Error ? err.message : String(err))
        }
      }}
    >
      Download
    </Button>
  )
}
