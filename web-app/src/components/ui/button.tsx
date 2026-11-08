import * as React from 'react'
import { cn } from '@/lib/utils'

const variants = {
  primary: 'bg-accent text-accent-text hover:bg-accent-hover active:bg-accent-pressed font-semibold',
  // v1.8.6 : le survol repeint la SURFACE relevée, pas la couleur de bordure
  // (avant : hover:bg-muted peignait le bouton en "border color" en dark).
  secondary: 'bg-card-2 text-fg hover:bg-card-2/60 hover:border-border-2 border border-border',
  ghost: 'text-fg-2 hover:text-fg hover:bg-card-2',
  destructive: 'text-danger hover:bg-danger/10 border border-danger/30',
  // v1.8.6 : lien dans la charte (fin des 6 stylages à la main).
  link: 'text-link underline underline-offset-4 hover:decoration-2 font-medium h-auto px-0',
} as const

const sizes = {
  sm: 'h-8 px-3 text-xs gap-1.5 rounded-md',
  md: 'h-9 px-4 text-sm gap-2 rounded-lg',
  lg: 'h-11 px-5 text-sm gap-2 rounded-lg',
  icon: 'h-8 w-8 rounded-md',
  iconSm: 'h-7 w-7 rounded-md',
} as const

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants
  size?: keyof typeof sizes
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'secondary', size = 'md', ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center cursor-pointer select-none',
        /* Press : feedback AU pointer-down, transition de transform 100 ms
           ease-out (§1 response) — le scale ne claque plus, il s'enfonce. */
        'transition-[color,background-color,border-color,transform] duration-150 ease-out',
        'disabled:opacity-50 disabled:pointer-events-none active:scale-[0.97]',
        variants[variant], sizes[size], className,
      )}
      {...props}
    />
  ),
)
Button.displayName = 'Button'
