import * as React from 'react'
import { cn } from '@/lib/utils'

// Skeleton (v1.8.6) — fin des `return null` : chaque page affiche la forme
// de son contenu pendant le chargement (pas de flash de layout, pas de saut).
// aria-busy + libellé sr-only : le chargement est ANNONCÉ.
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('animate-pulse rounded-lg bg-card-2', className)} />
}

export function Loading({ rows = 4, label }: { rows?: number; label: string }) {
  return (
    <div role="status" aria-busy="true" aria-label={label}>
      <span className="sr-only">{label}</span>
      <div className="space-y-2.5">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    </div>
  )
}

// Squelette de cartes de stats (dashboard).
export function StatsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div role="status" aria-busy="true" className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-card border border-border rounded-xl p-5">
          <Skeleton className="h-3 w-20 mb-3" />
          <Skeleton className="h-7 w-14" />
        </div>
      ))}
    </div>
  )
}
