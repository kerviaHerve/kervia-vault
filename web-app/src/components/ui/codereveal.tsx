import * as React from 'react'
import { Copy, Check, Eye, EyeOff } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { tr } from '@/i18n'
import { copyText } from '@/lib/clipboard'

// CodeReveal (v1.8.6) — bloc mono pour une valeur sensible/clé.
// Remplace 6 réécritures ; masqué par défaut (security UX : une valeur ne
// s'affiche que sur clic), bouton copie via copyText (fallback HTTP) avec
// feedback réel — le toast ne tombe QUE si la copie a eu lieu.
export function CodeReveal({ value, className, masked = true, breakAll = true, label }: {
  value: string
  className?: string
  /** Masqué par défaut — bouton œil pour révéler. */
  masked?: boolean
  breakAll?: boolean
  label?: string
}) {
  const [shown, setShown] = React.useState(!masked)
  const [copied, setCopied] = React.useState(false)
  const copy = async () => {
    const ok = await copyText(value)
    if (ok) {
      setCopied(true)
      toast.success(tr('copied'))
      setTimeout(() => setCopied(false), 1500)
    } else {
      toast.error(tr('copyFailed'))
    }
  }
  return (
    <div className={cn('flex items-center gap-2 bg-bg border border-accent-fg/25 rounded-lg p-3', className)}>
      <code
        className={cn('flex-1 font-mono text-xs text-accent-fg', breakAll && 'break-all')}
        aria-label={label}
      >
        {shown ? value : '•'.repeat(Math.min(value.length, 24))}
      </code>
      {masked && (
        <button
          type="button"
          onClick={() => setShown(s => !s)}
          aria-label={shown ? tr('hide') : tr('show')}
          aria-pressed={shown}
          className="text-fg-3 hover:text-fg cursor-pointer rounded-sm p-1"
        >
          {shown ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
        </button>
      )}
      <button
        type="button"
        onClick={copy}
        aria-label={tr('copy')}
        className="text-fg-3 hover:text-fg cursor-pointer rounded-sm p-1"
      >
        {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      </button>
    </div>
  )
}
