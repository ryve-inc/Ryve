import { Button } from '@/components/ui/button'

type Props = {
  busy?: boolean
}

export function UnlockSubmitButton({ busy }: Props) {
  return (
    <Button type="submit" disabled={busy}>
      Unlock
    </Button>
  )
}
