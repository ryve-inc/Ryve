import { Button } from '@/components/ui/button'
import { useDrive } from '@/context/drive-context'

type Props = {
  value: string
}

export function SaveBlindPeersButton({ value }: Props) {
  const { saveBlindPeers, showToast } = useDrive()

  return (
    <Button
      className="w-fit"
      onClick={async () => {
        try {
          await saveBlindPeers(value)
        } catch (err) {
          showToast(err instanceof Error ? err.message : String(err))
        }
      }}
    >
      Save blind peers
    </Button>
  )
}
