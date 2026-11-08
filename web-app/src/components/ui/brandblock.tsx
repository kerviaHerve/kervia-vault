import * as React from 'react'
import { cn } from '@/lib/utils'
import { useTheme } from '@/theme'
import kerviaLogoDark from '@/assets/kervia-logo-dark.svg'
import kerviaLogoClair from '@/assets/kervia-logo-clair.svg'

// BrandBlock (v1.8.6 — brief design n°14) — LE bloc marque du produit.
// Avant : trois implémentations divergentes (sidebar h-7, login h-12,
// wizard h-16) avec des alignements et des tailles de nom incohérentes.
// Règle kit conservée : le logo officiel reste INTACT, le nom du produit
// est un texte séparé (jamais dans le SVG).
//
//   sm — sidebar (compact, aligné gauche, nom sous le logo)
//   md — login  (centré, h-12, avec tagline)
//   lg — wizard (centré, h-16, avec tagline)
export function BrandBlock({ size = 'md', tagline, taglineAs = 'p', centered = false, className }: {
  size?: 'sm' | 'md' | 'lg'
  /** Slogan sous le nom (ex : « Coffre-fort multi-agents »). */
  tagline?: React.ReactNode
  /** La tagline peut être le h1 unique de la page (login). */
  taglineAs?: 'p' | 'h1'
  centered?: boolean
  className?: string
}) {
  const { theme } = useTheme()
  const logo = theme === 'dark' ? kerviaLogoDark : kerviaLogoClair
  const Tag = taglineAs
  const S = {
    sm: { logo: 'h-7', name: 'text-xs', gap: 'gap-1', align: 'items-start', tag: 'text-2xs' },
    md: { logo: 'h-12', name: 'text-xs', gap: 'gap-2.5', align: 'items-center', tag: 'text-xs' },
    lg: { logo: 'h-16', name: 'text-sm', gap: 'gap-2', align: 'items-center', tag: 'text-xs' },
  }[size]
  return (
    <div className={cn('flex flex-col', S.align, S.gap, centered && 'items-center text-center', className)}>
      {/* alt="" : le nom du produit est le texte juste dessous — pas de double annonce */}
      <img src={logo} alt="" className={cn(S.logo, 'w-auto')} />
      <div className={cn(size === 'sm' && 'ml-[31px]')}>
        <div className={cn(S.name, 'font-semibold tracking-[0.1em] text-fg-2')}>Kervia-vault</div>
        {tagline != null && (
          <Tag className={cn(S.tag, 'text-fg-3 mt-1 font-normal')}>{tagline}</Tag>
        )}
      </div>
    </div>
  )
}
