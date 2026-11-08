import * as React from 'react'
import { Dialog, DialogContent, DialogClose } from './dialog'
import { Button } from './button'
import { tr } from '@/i18n'
import { AlertTriangle } from 'lucide-react'

// ConfirmDialog (v1.8.6) — LE rituel de destruction du produit.
// Avant : 9 window.confirm() natifs hors charte + des actions graves sans
// aucune confirmation (purge item, cycle grants). Règles :
//  - danger par défaut, focus sur Annuler (impossible de valider par Enter)
//  - la conséquence est ÉCRITE (pas un « Êtes-vous sûr ? »)
//  - requireText : type-to-confirm pour l'irréversible total (DESTROY/EXPORT)
export function ConfirmDialog({ open, onOpenChange, title, message, confirmLabel, onConfirm, busy, requireText, tone = 'danger' }: {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: string
  message: React.ReactNode
  confirmLabel: string
  onConfirm: () => void | Promise<void>
  busy?: boolean
  /** Texte exact à taper pour débloquer (ex : "DESTROY", nom de la ressource). */
  requireText?: string
  tone?: 'danger' | 'default'
}) {
  const [typed, setTyped] = React.useState('')
  const ready = !requireText || typed === requireText
  React.useEffect(() => { if (!open) setTyped('') }, [open])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} className="max-w-sm" closeLabel={tr('close')}>
        <div className="flex gap-3">
          {tone === 'danger' && (
            <span className="shrink-0 w-8 h-8 rounded-full bg-danger/12 text-danger flex items-center justify-center">
              <AlertTriangle size={16} aria-hidden="true" />
            </span>
          )}
          <div className="text-sm text-fg-2 flex-1">{message}</div>
        </div>
        {requireText && (
          <input
            value={typed}
            onChange={e => setTyped(e.target.value)}
            placeholder={requireText}
            className="mt-4 w-full h-9 bg-bg border border-border rounded-lg px-3 font-mono text-sm text-fg placeholder:text-fg-3 focus:border-accent-fg focus:outline-2 focus:outline-offset-1 focus:outline-focus"
            aria-label={tr('typeToConfirm', requireText)}
          />
        )}
        <div className="flex justify-end gap-2 mt-5">
          <DialogClose asChild>
            <Button autoFocus>{tr('cancel')}</Button>
          </DialogClose>
          <Button
            variant={tone === 'danger' ? 'destructive' : 'primary'}
            disabled={!ready || busy}
            onClick={async () => { await onConfirm(); onOpenChange(false) }}
          >
            {busy ? tr('loading') : confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
