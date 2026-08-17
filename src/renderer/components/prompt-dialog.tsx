import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { PromptCancelButton } from '@/components/buttons/prompt-cancel-button'
import { PromptChoiceButton } from '@/components/buttons/prompt-choice-button'
import { PromptOkButton } from '@/components/buttons/prompt-ok-button'
import { useDrive } from '@/context/drive-context'

export function PromptDialog() {
  const { prompt, closePrompt } = useDrive()
  const [value, setValue] = useState('')

  useEffect(() => {
    if (prompt.open) setValue(prompt.defaultValue)
  }, [prompt.open, prompt.defaultValue])

  return (
    <Dialog open={prompt.open} onOpenChange={(open) => !open && closePrompt(null)}>
      <DialogContent className='max-w-[420px]'>
        <DialogHeader>
          <DialogTitle>{prompt.title}</DialogTitle>
          {prompt.body ? <DialogDescription>{prompt.body}</DialogDescription> : null}
        </DialogHeader>

        {prompt.mode === 'text' ? (
          <Input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                closePrompt(value)
              } else if (e.key === 'Escape') {
                e.preventDefault()
                closePrompt(null)
              }
            }}
          />
        ) : null}

        {prompt.mode === 'choice' ? (
          <div className='grid gap-2'>
            {prompt.choices.map((choice) => (
              <PromptChoiceButton key={choice.value} choice={choice} />
            ))}
          </div>
        ) : null}

        {prompt.mode !== 'choice' ? (
          <DialogFooter>
            <PromptCancelButton />
            <PromptOkButton inputValue={value} />
          </DialogFooter>
        ) : (
          <DialogFooter>
            <PromptCancelButton />
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
