import { Button } from '@/components/ui/button'
import { useDrive } from '@/context/drive-context'
import type { PromptChoice } from '@/context/drive-context'

type Props = {
  choice: PromptChoice
}

export function PromptChoiceButton({ choice }: Props) {
  const { closePrompt } = useDrive()

  return (
    <Button
      variant="ghost"
      className="w-full justify-start text-left"
      onClick={() => closePrompt(choice.value)}
    >
      {choice.label}
    </Button>
  )
}
