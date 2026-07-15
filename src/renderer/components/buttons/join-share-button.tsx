import { Button } from '@/components/ui/button'
import { useDrive } from '@/context/drive-context'

export function JoinShareButton() {
  const { askText, joinShare, showToast } = useDrive()

  return (
    <Button
      variant="ghost"
      onClick={async () => {
        try {
          const invite = await askText('Join invite', '', 'Paste a drive:… share invite.')
          if (!invite) return
          await joinShare(invite)
        } catch (err) {
          showToast(err instanceof Error ? err.message : String(err))
        }
      }}
    >
      Join invite
    </Button>
  )
}
