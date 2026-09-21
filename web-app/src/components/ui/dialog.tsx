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
      <DialogPrimitive.Overlay className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 data-[state=open]:animate-[fadein_.15s_ease-out]" />
      <DialogPrimitive.Content
        className={cn(
          'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50',
          'w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl',
          'data-[state=open]:animate-[popin_.18s_ease-out]',
          className,
        )}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <DialogPrimitive.Title className="text-base font-semibold">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Close className="text-fg-3 hover:text-fg transition-colors cursor-pointer rounded-md p-1 hover:bg-card-2">
            <X size={16} />
          </DialogPrimitive.Close>
        </div>
        <div className="px-6 py-5">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}
