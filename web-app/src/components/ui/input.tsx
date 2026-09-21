import * as React from 'react'
import { cn } from '@/lib/utils'

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'w-full h-9 bg-bg border border-border rounded-lg px-3 text-sm text-fg',
        'placeholder:text-fg-3 transition-colors duration-150',
        'focus:border-accent focus:ring-2 focus:ring-accent/20 outline-none',
        className,
      )}
      {...props}
    />
  ),
)
Input.displayName = 'Input'

export const Label = ({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) => (
  <label className={cn('block text-xs font-semibold text-fg-2 mb-1.5', className)} {...props} />
)

export function Field({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <Label>{label}</Label>
      {children}
      {help && <p className="text-[11px] text-fg-3 mt-1.5">{help}</p>}
    </div>
  )
}
