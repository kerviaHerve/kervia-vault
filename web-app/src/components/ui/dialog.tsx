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
      {/* Scrim : fade + matérialisation du blur ensemble (§12).
          ROBUSTESSE (v1.7.1) : PAS d'animation de sortie. Radix garde
          l'élément monté jusqu'au animationend de l'exit — si cet
          événement ne part jamais (extension navigateur, quirk de
          rendering), le scrim reste suspendu à vie : page floue et
          figée. Sans classe data-[state=closed], Radix voit
          animationName:none et démonte immédiatement à la fermeture. */}
      <DialogPrimitive.Overlay
        className="fixed inset-0 bg-black/70 z-50 [backdrop-filter:blur(16px)]
          data-[state=open]:animate-[scrim-in_.22s_cubic-bezier(0.32,0.72,0,1)]"
      />
      <DialogPrimitive.Content
        className={cn(
          'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50',
          'w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl',
          'data-[state=open]:animate-[popin_.26s_cubic-bezier(0.32,0.72,0,1)]',
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
