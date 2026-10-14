import { Moon, Sun } from 'lucide-react'
import { useTheme } from '@/theme'
import { useLang } from '@/i18n'
import { cn } from '@/lib/utils'

// Bascule sombre/clair — libellé explicite + aria-pressed (règles kit Kervia).
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggle } = useTheme()
  const { t } = useLang()
  const dark = theme === 'dark'
  return (
    <button
      onClick={toggle}
      aria-pressed={!dark}
      title={dark ? String(t.toLight) : String(t.toDark)}
      className={cn(
        'flex items-center gap-2 px-3 h-8 rounded-lg text-[11px] font-bold cursor-pointer transition-colors border w-full',
        dark
          ? 'bg-card-2 border-border text-fg-2 hover:text-fg'
          : 'bg-accent/12 border-accent/50 text-accent',
        className,
      )}
    >
      {dark ? <Sun size={13} /> : <Moon size={13} />}
      {dark ? String(t.toLight) : String(t.toDark)}
    </button>
  )
}