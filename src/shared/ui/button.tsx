import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'
import { cn } from '@/shared/lib/utils'

// El botón base. Las variables (`bg-primary`, `border-input`…) las apunta `globals.css` a los tokens de design/tokens.css. Los
// componentes de shadcn que se agreguen (`pnpm dlx shadcn add …`) lo reemplazan por el suyo con la misma API (`buttonVariants`).
// Sin `transition-all` (`.claude/rules/ui.md`): `transition` y nada más.
export const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-(length:--text-sm) font-medium whitespace-nowrap transition outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-(--color-primario-oscuro)',
        outline: 'border border-input bg-background hover:bg-accent',
        ghost: 'hover:bg-accent',
      },
      size: {
        default: 'h-9 px-4',
        sm: 'h-8 px-3',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

export type PropsDeButton = ComponentProps<'button'> & VariantProps<typeof buttonVariants>

export function Button({ className, variant, size, ...props }: PropsDeButton) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />
}
