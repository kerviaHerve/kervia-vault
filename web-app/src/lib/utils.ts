import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)) }

// v1.8.6 : la locale suit la langue choisie — avant, tout était verrouillé
// en fr-FR (dates françaises en mode EN, deux formats sur une même page).
function activeLocale(): string {
  return localStorage.getItem('kerviavault-lang') === 'en' ? 'en-GB' : 'fr-FR'
}

export function fmtDate(s?: string | null) {
  if (!s) return '—'
  const d = new Date(s)
  return d.toLocaleDateString(activeLocale(), { day: '2-digit', month: 'short', year: 'numeric' })
}
export function fmtDateTime(s?: string | null) {
  if (!s) return '—'
  const d = new Date(s)
  return d.toLocaleDateString(activeLocale(), { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}
