import { Button } from '@/components/ui/button'
import { useDrive } from '@/context/drive-context'

export function DeleteButton() {
  const { deleteSelected, showToast } = useDrive()

  return (
    <Button
      variant="destructive"
      onClick={async () => {
        try {
          await deleteSelected()
        } catch (err) {
          showToast(err instanceof Error ? err.message : String(err))
        }
      }}
    >
      Delete
    </Button>
  )
}
