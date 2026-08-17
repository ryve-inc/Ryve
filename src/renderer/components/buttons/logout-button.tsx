import { Button } from '@/components/ui/button'
import { useDrive } from '@/context/drive-context'

export function LogoutButton() {
  const { logout, showToast } = useDrive()

  return (
    <Button
      variant='destructive'
      className='w-fit'
      onClick={async () => {
        try {
          await logout()
        } catch (err) {
          showToast(err instanceof Error ? err.message : String(err))
        }
      }}
    >
      Log out
    </Button>
  )
}
