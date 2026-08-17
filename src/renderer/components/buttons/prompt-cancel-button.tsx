import { Button } from '@/components/ui/button'
import { useDrive } from '@/context/drive-context'

export function PromptCancelButton() {
  const { prompt, closePrompt } = useDrive()

  return (
    <Button variant='ghost' onClick={() => closePrompt(null)}>
      {prompt.cancelLabel}
    </Button>
  )
}
