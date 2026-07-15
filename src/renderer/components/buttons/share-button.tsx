import { Button } from '@/components/ui/button'
import { useDrive } from '@/context/drive-context'

export function ShareButton() {
  const { askDialog, askText, createReadShare, createCollabShare, showToast } = useDrive()

  return (
    <Button
      variant="ghost"
      onClick={async () => {
        try {
          const choice = await askDialog({
            title: 'Share',
            body: 'Choose a share type for the current folder.',
            mode: 'choice',
            choices: [
              { label: 'Read-only link', value: 'read' },
              { label: 'Collaborative folder', value: 'collab' }
            ]
          })
          if (!choice) return
          if (choice === 'collab') {
            const name = await askText('Folder name', 'Shared folder')
            if (name === null) return
            await createCollabShare(name || 'Shared folder')
          } else {
            await createReadShare()
          }
        } catch (err) {
          showToast(err instanceof Error ? err.message : String(err))
        }
      }}
    >
      Share
    </Button>
  )
}
