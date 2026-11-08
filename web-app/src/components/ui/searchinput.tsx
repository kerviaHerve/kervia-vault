import * as React from 'react'
import { Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { tr } from '@/i18n'

// SearchInput (v1.8.6) — champ de recherche à icône avec bouton d'effacement,
// label accessible (fin du placeholder-seul), focus visible (fin de l'outline-none).
export function SearchInput({ value, onChange, placeholder, className, autoFocus }: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
  autoFocus?: boolean
}) {
  return (
    <div className={cn('relative', className)}>
      <Search size={14} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-3 pointer-events-none" />
      <input
        type="search"
        value={value}
        autoFocus={autoFocus}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder ?? tr('searchLabel')}
        className="w-full h-9 bg-bg border border-border rounded-lg pl-9 pr-8 text-sm text-fg
          placeholder:text-fg-3 transition-colors duration-150
          focus:border-accent-fg focus:outline-2 focus:outline-offset-1 focus:outline-focus
          [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label={tr('clearSearch')}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-fg-3 hover:text-fg cursor-pointer rounded-sm p-0.5"
        >
          <X size={13} aria-hidden="true" />
        </button>
      )}
    </div>
  )
}
