import * as React from 'react'
import { cn } from '@/lib/utils'

// EmptyState (v1.8.6) — un seul pattern d'état vide guidé (icône 32 + texte
// + action), fini les py-14 text-center dupliqués avec des libellés divergents.
export function EmptyState({ icon, title, hint, action }: {
  icon: React.ReactNode
  title: string
  hint?: string
  action?: React.ReactNode
}) {
  return (
    <div className="py-14 text-center">
      <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-card-2 border border-border flex items-center justify-center text-fg-3">
        {icon}
      </div>
      <p className="text-sm font-semibold text-fg-2">{title}</p>
      {hint && <p className="text-xs text-fg-3 mt-1.5 max-w-sm mx-auto">{hint}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}
