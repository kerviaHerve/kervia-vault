import * as React from 'react'
import { cn } from '@/lib/utils'

// SegmentedControl (v1.8.6) — remplace 12 réécritures avec 4 états actifs.
// Un seul langage : actif = bg-accent/12 + border-accent-fg/30 + text-accent-fg
// + aria-pressed (l'état n'est plus porté par la couleur seule — WCAG 1.4.1).
export function SegmentedControl<T extends string | number>({ options, value, onChange, ariaLabel, className, size = 'md' }: {
  options: { value: T; label: React.ReactNode; title?: string }[]
  value: T
  onChange: (v: T) => void
  ariaLabel: string
  className?: string
  size?: 'sm' | 'md'
}) {
  return (
    <div role="group" aria-label={ariaLabel} className={cn('inline-flex flex-wrap gap-1.5', className)}>
      {options.map(o => {
        const active = o.value === value
        return (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={active}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={cn(
              'rounded-lg border cursor-pointer font-medium transition-colors duration-150 whitespace-nowrap',
              size === 'sm' ? 'h-7 px-2.5 text-2xs' : 'h-9 px-3.5 text-xs',
              active
                ? 'bg-accent/12 border-accent-fg/30 text-accent-fg'
                : 'bg-card-2 border-border text-fg-2 hover:text-fg hover:border-border-2',
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
