import * as React from 'react'
import { cn } from '@/lib/utils'

const variants = {
  neutral: 'bg-muted text-fg-2',
  ok: 'bg-accent/12 text-accent',
  danger: 'bg-danger/12 text-danger',
  warn: 'bg-warn/12 text-warn',
  accent: 'bg-accent/12 text-accent',
} as const

export function Badge({ variant = 'neutral', className, children, ...props }: React.HTMLAttributes<HTMLSpanElement> & { variant?: keyof typeof variants }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap', variants[variant], className)} {...props}>
      {children}
    </span>
  )
}
