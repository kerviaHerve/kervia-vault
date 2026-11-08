import * as React from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { MoreHorizontal, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from './button'
import { Tip } from './tooltip'

export interface RowAction {
  icon: LucideIcon
  /** Nom accessible (i18n) — sert de libellé dans le kebab ET d'aria-label/tooltip inline. */
  label: string
  onClick: () => void
  destructive?: boolean
}

// RowActions (v1.8.6 — audit responsive) — rangées d'actions denses.
// Desktop (md+) : boutons icône inline avec Tooltips (regard rapide possible).
// Sous md : les 5-7 boutons ne tiennent pas dans un viewport 320 px →
// replis dans un menu kebab accessible (Radix DropdownMenu : clavier,
// focus, Escape, aria). Le menu affiche l'icône ET le libellé — les actions
// deviennent plus explicites sur mobile qu'un mur d'icônes.
export function RowActions({ actions, className }: { actions: RowAction[]; className?: string }) {
  return (
    <>
      <div className={cn('hidden md:inline-flex items-center gap-0.5', className)}>
        {actions.map(a => (
          <Tip key={a.label} label={a.label}>
            <Button
              variant="ghost"
              size="iconSm"
              aria-label={a.label}
              onClick={a.onClick}
              className={a.destructive ? 'text-danger hover:bg-danger/10' : undefined}
            >
              <a.icon size={14} aria-hidden="true" />
            </Button>
          </Tip>
        ))}
      </div>
      <div className={cn('md:hidden', className)}>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button variant="ghost" size="iconSm" aria-label="Actions">
              <MoreHorizontal size={14} aria-hidden="true" />
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={4}
              collisionPadding={8}
              className="z-[60] min-w-44 rounded-xl border border-border bg-card p-1.5 shadow-2xl"
            >
              {actions.map(a => (
                <DropdownMenu.Item
                  key={a.label}
                  onSelect={a.onClick}
                  className={cn(
                    'flex items-center gap-2.5 h-9 px-3 rounded-lg text-sm cursor-pointer outline-none select-none',
                    'data-[highlighted]:bg-card-2 data-[state=open]:bg-card-2',
                    a.destructive ? 'text-danger' : 'text-fg-2',
                  )}
                >
                  <a.icon size={14} aria-hidden="true" />
                  {a.label}
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </>
  )
}
