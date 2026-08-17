import { Button } from '@/components/ui/button'

type Props = {
  busy?: boolean
}

export function ConfirmSubmitButton({ busy }: Props) {
  return (
    <Button type='submit' disabled={busy}>
      Open drive
    </Button>
  )
}
