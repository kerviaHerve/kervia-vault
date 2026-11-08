import * as React from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { tr } from '@/i18n'

// Focus des champs (v1.8.6, audit a11y A8) : le ring global `*:focus-visible`
// existe et passe (menthe, 8-10:1) — on l'utilise, on ne le remplace PAS par
// un ring accent à 20% d'opacité (≈2:1, invisible). L'accent-fg marque le
// champ actif par la bordure en plus de l'outline.
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'w-full h-9 bg-bg border border-border rounded-lg px-3 text-sm text-fg',
        'placeholder:text-fg-3 transition-colors duration-150',
        'focus:border-accent-fg focus:outline-2 focus:outline-offset-1 focus:outline-focus',
        className,
      )}
      {...props}
    />
  ),
)
Input.displayName = 'Input'

// PasswordInput: un Input password avec l'œil intégré — l'utilisateur PEUT
// voir la valeur en édition (toggle par champ, jamais masqué à double).
// v1.8.6 : l'œil est atteignable au clavier (tabIndex retiré), localisé et
// porte son état (aria-pressed) — avant : souris-only, aria-label figé en FR.
export function PasswordInput({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  const [show, setShow] = React.useState(false)
  return (
    <div className="relative">
      <Input
        {...props}
        type={show ? 'text' : 'password'}
        className={cn('pr-9 font-mono', className)}
      />
      <button
        type="button"
        onClick={() => setShow(s => !s)}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-fg-3 hover:text-fg cursor-pointer rounded-sm p-0.5"
        aria-label={show ? tr('hide') : tr('show')}
        aria-pressed={show}
      >
        {show ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
      </button>
    </div>
  )
}

export const Label = ({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) => (
  <label className={cn('block text-xs font-semibold text-fg-2 mb-1.5', className)} {...props} />
)

// Field (v1.8.6, audit a11y A1 — BLOQUANT) : le label est maintenant ASSOCIÉ
// à l'input (useId + htmlFor) et l'aide liée par aria-describedby. Avant, les
// ~40 champs de l'app étaient des « zones de saisie, vide » pour les lecteurs
// d'écran. Support d'un message d'erreur lié (aria-invalid + aria-describedby).
export function Field({ label, help, error, id, className, children, required }: {
  label: string
  help?: string
  error?: string
  id?: string
  className?: string
  children: React.ReactNode
  required?: boolean
}) {
  const fid = id ?? React.useId()
  const hid = `${fid}-help`
  const eid = `${fid}-err`
  const desc = [help ? hid : '', error ? eid : ''].filter(Boolean).join(' ') || undefined
  // Le premier élément React est le champ contrôlé : on lui injecte l'id et
  // les descriptions. Les autres enfants (ex : <datalist>) passent intacts.
  const kids = React.Children.toArray(children)
  const child = kids.find(k => React.isValidElement(k))
  const rest = child ? kids.filter(k => k !== child) : []
  const fieldEl = child
    ? React.cloneElement(child as any, {
      id: fid,
      'aria-describedby': desc,
      ...(error ? { 'aria-invalid': true } : {}),
    })
    : null
  return (
    <div className={cn('mb-4', className)}>
      <Label htmlFor={fid}>{label}{required && <span className="text-danger" aria-hidden="true"> *</span>}</Label>
      {fieldEl}
      {rest}
      {help && <p id={hid} className="text-2xs text-fg-3 mt-1.5">{help}</p>}
      {error && <p id={eid} role="alert" className="text-2xs text-danger font-medium mt-1.5">{error}</p>}
    </div>
  )
}

// Textarea (v1.8.6) : même focus que Input — avant, 3 dérivives divergentes.
export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'w-full bg-bg border border-border rounded-lg p-3 text-sm text-fg min-h-24',
        'placeholder:text-fg-3 transition-colors duration-150',
        'focus:border-accent-fg focus:outline-2 focus:outline-offset-1 focus:outline-focus',
        className,
      )}
      {...props}
    />
  ),
)
Textarea.displayName = 'Textarea'

// Select (v1.8.6) : select natif stylé — même surface, même focus que Input.
// Natif assumé : la popup reste native (robuste, clavier, mobile) — seul le
// champ fermé est dans la charte.
export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        'w-full h-9 bg-bg border border-border rounded-lg px-3 text-sm text-fg cursor-pointer',
        'hover:border-border-2 transition-colors duration-150',
        'focus:border-accent-fg focus:outline-2 focus:outline-offset-1 focus:outline-focus',
        className,
      )}
      {...props}
    />
  ),
)
Select.displayName = 'Select'
