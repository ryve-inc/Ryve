import { Button } from '@/components/ui/button'
import { useDrive } from '@/context/drive-context'

export function NewCollabButton() {
  const { askText, createCollabShare, showToast } = useDrive()

  return (
    <Button
      onClick={async () => {
        try {
          const name = await askText('Folder name', 'Shared folder')
          if (name === null) return
          await createCollabShare(name || 'Shared folder')
        } catch (err) {
          showToast(err instanceof Error ? err.message : String(err))
        }
      }}
    >
      New collaborative folder
    </Button>
  )
}
