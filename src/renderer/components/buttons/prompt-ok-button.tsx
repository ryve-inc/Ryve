import { Button } from '@/components/ui/button'
import { useDrive } from '@/context/drive-context'

type Props = {
  inputValue: string
}

export function PromptOkButton({ inputValue }: Props) {
  const { prompt, closePrompt } = useDrive()

  if (prompt.mode === 'choice') return null

  return (
    <Button
      onClick={() => {
        if (prompt.mode === 'text') closePrompt(inputValue)
        else closePrompt(true)
      }}
    >
      {prompt.okLabel}
    </Button>
  )
}
