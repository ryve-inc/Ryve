import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-leaf/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)]',
  {
    variants: {
      variant: {
        default:
          'border border-transparent bg-leaf text-soil shadow-[0_6px_18px_rgba(198,242,78,0.28)] hover:brightness-110',
        secondary: 'border border-line bg-fern text-soft hover:border-cyan/40 hover:text-ink',
        ghost: 'border border-transparent bg-transparent text-mute hover:bg-fern/70 hover:text-ink',
        link: 'border-0 bg-transparent px-0 py-1 text-mute hover:text-leaf',
        destructive: 'border border-danger/40 bg-danger/10 text-[#ffb0b0] hover:bg-danger/20',
        outline: 'border border-line bg-moss text-soft hover:border-leaf/40 hover:text-ink'
      },
      size: {
        default: 'h-10 px-5 py-2.5',
        sm: 'h-8 px-3.5 text-xs',
        lg: 'h-11 px-6 text-[0.95rem]',
        icon: 'h-10 w-10'
      }
    },
    defaultVariants: {
      variant: 'default',
      size: 'default'
    }
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    )
  }
)
Button.displayName = 'Button'

export { Button, buttonVariants }
