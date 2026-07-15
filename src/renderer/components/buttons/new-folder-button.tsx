import { Button } from '@/components/ui/button'
import { useDrive } from '@/context/drive-context'

export function NewFolderButton() {
  const { askText, mkdir, showToast } = useDrive()

  return (
    <Button
      variant="ghost"
      onClick={async () => {
        try {
          const name = await askText('New folder', '', 'Name for the folder in this directory.')
          if (!name) return
          await mkdir(name)
        } catch (err) {
          showToast(err instanceof Error ? err.message : String(err))
        }
      }}
    >
      New folder
    </Button>
  )
}
