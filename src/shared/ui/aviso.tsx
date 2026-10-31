import type { ReactNode } from 'react'
import { cn } from '@/shared/lib/utils'

// Un aviso en su lugar: texto + color de su tono, nunca sólo color (`.claude/rules/ui.md`). `peligro` y `aviso` se anuncian
// (`role="alert"`); `info` y `positivo`, como estado.
type Tono = 'info' | 'positivo' | 'aviso' | 'peligro'

const TONOS: Record<Tono, string> = {
  info: 'bg-(--color-info-soft) text-(--color-info-ink)',
  positivo: 'bg-(--color-positivo-soft) text-(--color-positivo-ink)',
  aviso: 'bg-(--color-aviso-soft) text-(--color-aviso-ink)',
  peligro: 'bg-(--color-peligro-soft) text-(--color-peligro-ink)',
}

export function Aviso({
  tono = 'info',
  className,
  children,
}: {
  tono?: Tono
  className?: string
  children: ReactNode
}) {
  return (
    <div
      role={tono === 'peligro' || tono === 'aviso' ? 'alert' : 'status'}
      className={cn(
        'flex gap-2 rounded-md px-3 py-2 text-(length:--text-sm)',
        TONOS[tono],
        className,
      )}
    >
      {children}
    </div>
  )
}
