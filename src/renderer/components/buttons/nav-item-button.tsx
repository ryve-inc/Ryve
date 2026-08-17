import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { NavName } from '@/context/drive-context'
import { useDrive } from '@/context/drive-context'

type Props = {
  nav: NavName
  children: ReactNode
}

export function NavItemButton({ nav, children }: Props) {
  const { currentNav, navigate } = useDrive()
  const active = currentNav === nav

  return (
    <Button
      variant='ghost'
      className={cn(
        'w-full justify-start rounded-xl border border-transparent px-3 py-2.5 text-mute hover:bg-iris/10 hover:text-ink',
        active && 'border-iris/40 bg-iris/15 text-ink'
      )}
      onClick={() => navigate(nav)}
    >
      {children}
    </Button>
  )
}
