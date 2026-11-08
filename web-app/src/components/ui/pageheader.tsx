import * as React from 'react'
import { cn } from '@/lib/utils'

// PageHeader (v1.8.6) — l'en-tête des 7 pages (h1 + sous-titre + actions).
// Le h1 est unique par page (navigation par titres) et les actions wrappent
// proprement sur mobile (fin du débordement dès 1100px de la page secrets).
export function PageHeader({ title, sub, actions, className }: {
  title: string
  sub?: string
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-wrap items-end justify-between gap-x-6 gap-y-4 mb-6', className)}>
      <div className="min-w-0">
        <h1 className="text-xl font-bold tracking-tight mb-1">{title}</h1>
        {sub && <p className="text-sm text-fg-2">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
