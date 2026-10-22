import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close

export function DialogContent({ className, children, title }: { className?: string; children: React.ReactNode; title: string }) {
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
        className={cn(
          'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50',
          'w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl',
          className,
        )}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <DialogPrimitive.Title className="text-base font-semibold">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Close className="text-fg-3 hover:text-fg transition-colors duration-150 cursor-pointer rounded-md p-1 hover:bg-card-2 active:scale-95">
            <X size={16} />
          </DialogPrimitive.Close>
        </div>
        <div className="px-6 py-5">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}
