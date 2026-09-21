import { Languages } from 'lucide-react'
import { useLang } from './index'
import { cn } from '@/lib/utils'

export function LangSwitch({ className }: { className?: string }) {
  const { lang, setLang } = useLang()
  return (
    <button
      onClick={() => setLang(lang === 'fr' ? 'en' : 'fr')}
      className={cn(
        'flex items-center gap-2 px-3 h-8 rounded-lg text-[11px] font-bold cursor-pointer transition-colors border w-full',
        lang === 'fr'
          ? 'bg-accent/12 border-accent/50 text-accent'
          : 'bg-card-2 border-border text-fg-2 hover:text-fg',
        className,
      )}
      title="FR / EN"
    >
      <Languages size={13} />
      {lang === 'fr' ? 'FR' : 'EN'}
    </button>
  )
}
