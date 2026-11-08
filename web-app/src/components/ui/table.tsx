import * as React from 'react'
import { cn } from '@/lib/utils'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'

// Table (v1.8.6) — LE primitif des 6 tableaux du produit.
// overflow-x-auto par défaut (reflow 320px, WCAG 1.4.10), padding normalisé
// (fin des py-2.5/py-3/py-3.5 selon la page), th scope="col" (1.3.1) et tri
// annoncé (aria-sort + icône — fin du ▲▼ à 9px).
export function Table({ className, children, label }: { className?: string; children: React.ReactNode; label?: string }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className={cn('w-full text-sm', className)} aria-label={label}>
        {children}
      </table>
    </div>
  )
}

export function Th({ className, children, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn('text-left font-semibold text-2xs text-fg-3 uppercase tracking-wide px-5 py-3 border-b border-border bg-card-2/50', className)}
      {...props}
    >
      {children}
    </th>
  )
}

export function Td({ className, children, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={cn('px-5 py-3 border-b border-border/50 align-middle', className)} {...props}>
      {children}
    </td>
  )
}

// En-tête de colonne triable : la direction est écrite dans aria-sort, pas
// seulement dans un glyphe.
export function SortTh({ active, dir, onSort, children, className }: {
  active: boolean
  dir?: 'asc' | 'desc'
  onSort: () => void
  children: React.ReactNode
  className?: string
}) {
  return (
    <Th
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={className}
    >
      <button
        type="button"
        onClick={onSort}
        className={cn('inline-flex items-center gap-1 hover:text-fg cursor-pointer transition-colors', active && 'text-accent-fg')}
      >
        {children}
        {active
          ? (dir === 'asc'
              ? <ArrowUp size={12} aria-hidden="true" />
              : <ArrowDown size={12} aria-hidden="true" />)
          : <ArrowUpDown size={12} aria-hidden="true" className="text-fg-3/50" />}
      </button>
    </Th>
  )
}
