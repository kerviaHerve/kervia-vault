import * as React from 'react'
import { AlertTriangle, Info, CircleAlert, CircleCheck } from 'lucide-react'
import { cn } from '@/lib/utils'

// Alert (v1.8.6) — callout unifié warn/danger/info/success.
// Remplace les 8 blocs bg-warn/10 artisanaux ; l'icône rend l'information
// accessible sans la couleur seule.
const tones = {
  info: { box: 'bg-info-bg text-info', icon: <Info size={15} aria-hidden="true" /> },
  warn: { box: 'bg-warn-bg text-warn', icon: <AlertTriangle size={15} aria-hidden="true" /> },
  danger: { box: 'bg-danger-bg text-danger', icon: <CircleAlert size={15} aria-hidden="true" /> },
  success: { box: 'bg-success-bg text-success', icon: <CircleCheck size={15} aria-hidden="true" /> },
} as const

export function Alert({ tone = 'info', children, className }: {
  tone?: keyof typeof tones
  children: React.ReactNode
  className?: string
}) {
  return (
    <div role={tone === 'danger' ? 'alert' : 'note'} className={cn('flex gap-2.5 items-start rounded-xl p-3.5 text-xs leading-relaxed', tones[tone].box, className)}>
      <span className="shrink-0 mt-0.5">{tones[tone].icon}</span>
      <div className="flex-1">{children}</div>
    </div>
  )
}
