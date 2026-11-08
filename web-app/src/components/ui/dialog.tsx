import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { tr } from '@/i18n'

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close

export function DialogContent({ className, children, title, closeLabel, onEscapeKeyDown, onInteractOutside, description }: {
  className?: string
  children: React.ReactNode
  title: string
  /** Libellé accessible du bouton Fermer — défaut : traduction « Fermer ». */
  closeLabel?: string
  /** Garde Escape (ex : dialog dirty → « Abandonner les modifications ? »). */
  onEscapeKeyDown?: (e: KeyboardEvent) => void
  /** Garde clic-overlay (idem). preventDefault() = ne pas fermer. */
  onInteractOutside?: (e: Event) => void
  /** Sous-titre : rendu visible ET exposé aux lecteurs d'écran (aria-describedby). */
  description?: string
}) {
  const descId = React.useId()
  return (
    <DialogPrimitive.Portal>
      {/* ROBUSTESSE (v1.7.2) : AUCUNE animation, même à l'ouverture.
          Symptôme réel (Firefox 158/macOS + extension) : premier clic →
          overlay peint mais CONTENU INVISIBLE — l'animation d'entrée
          popin part de opacity:0 et ne progressait jamais dans cet
          environnement (peinture/GPU/extension). Sans animation du tout,
          l'élément n'a JAMAIS d'état initial invisible : il se peint
          d'emblée à l'état final. On échange 260 ms de polish contre
          l'impossibilité structurelle d'un dialog invisible. */}
      <DialogPrimitive.Overlay
        className="fixed inset-0 bg-black/70 z-50 [backdrop-filter:blur(16px)]"
      />
      <DialogPrimitive.Content
        onEscapeKeyDown={onEscapeKeyDown}
        onInteractOutside={onInteractOutside}
        aria-describedby={description ? descId : undefined}
        className={cn(
          'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50',
          'w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl',
          className,
        )}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <DialogPrimitive.Title className="text-base font-semibold">{title}</DialogPrimitive.Title>
          {/* v1.8.6 : nom accessible (l'œil d'un lecteur d'écran ne voit pas une croix) */}
          <DialogPrimitive.Close
            aria-label={closeLabel ?? tr('close')}
            className="text-fg-3 hover:text-fg transition-colors duration-150 cursor-pointer rounded-md p-1 hover:bg-card-2 active:scale-95"
          >
            <X size={16} aria-hidden="true" />
          </DialogPrimitive.Close>
        </div>
        {description && (
          <DialogPrimitive.Description id={descId} className="px-6 pt-3 text-sm text-fg-2">
            {description}
          </DialogPrimitive.Description>
        )}
        <div className="px-6 py-5">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}
