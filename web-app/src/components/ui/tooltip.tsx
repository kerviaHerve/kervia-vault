import * as React from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { cn } from '@/lib/utils'

// Tooltip (v1.8.6) — remplace les title="" natifs (inaccessibles au clavier,
// non localisés fiablement, délai long) sur les rangées d'actions denses.
// Radix : Escape, focus, aria-describedby — tout est géré.
export const TooltipProvider = TooltipPrimitive.Provider

export function Tip({ label, children, side = 'top' }: {
  label: string
  children: React.ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
}) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          collisionPadding={8}
          className={cn(
            'z-[60] bg-card-2 border border-border rounded-lg px-2.5 py-1.5',
            'text-2xs text-fg shadow-lg max-w-64',
          )}
        >
          {label}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
}
