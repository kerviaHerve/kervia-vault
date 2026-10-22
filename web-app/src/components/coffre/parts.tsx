// Coffre v2 — briques partagées : icônes/couleurs par catégorie, code
// TOTP vivant (multi-algo), barre de force, copie presse-papier.
import * as React from 'react'
import { toast } from 'sonner'
import {
  Globe, FileText, CreditCard, Landmark, UserRound, BookOpen, Bitcoin,
  Terminal, Server, Database, Wifi, KeySquare, BadgeCheck, Timer,
  type LucideIcon,
} from 'lucide-react'
import { Badge } from '@/components/ui'
import { cn } from '@/lib/utils'
import { useLang } from '@/i18n'
import * as C from '@/lib/coffre'
import type { CategoryId } from '@/lib/coffre-schema'

// ---- identité visuelle par catégorie ----
export const CAT_ICON: Record<CategoryId, LucideIcon> = {
  login: Globe, note: FileText, card: CreditCard, bank: Landmark,
  identity: UserRound, passport: BookOpen, crypto: Bitcoin, ssh: Terminal,
  server: Server, db: Database, wifi: Wifi, license: KeySquare,
  membership: BadgeCheck, otp: Timer,
}

// classe tailwind (fond teinté + texte) — la palette du design system
export const CAT_COLOR: Record<CategoryId, string> = {
  login: 'bg-accent/12 text-accent',
  note: 'bg-muted text-fg-2',
  card: 'bg-info/12 text-info',
  bank: 'bg-warn/12 text-warn',
  identity: 'bg-accent/12 text-accent',
  passport: 'bg-warn/12 text-warn',
  crypto: 'bg-warn/12 text-warn',
  ssh: 'bg-muted text-fg-2',
  server: 'bg-info/12 text-info',
  db: 'bg-warn/12 text-warn',
  wifi: 'bg-accent/12 text-accent',
  license: 'bg-info/12 text-info',
  membership: 'bg-accent/12 text-accent',
  otp: 'bg-danger/12 text-danger',
}

// ---- copie presse-papier + effacement auto (30 s) ----
export function useCopy() {
  const { t } = useLang()
  return (v: string) => {
    navigator.clipboard.writeText(v).catch(() => {})
    toast.success(String(t.cofCopied), { description: String(t.cofAutoClear) })
    window.setTimeout(() => { if (document.hasFocus()) navigator.clipboard.writeText('').catch(() => {}) }, 30000)
  }
}

// ---- code TOTP vivant — un par champ totp, algo/digits/période v2 ----
export function TotpLive({ value }: { value: string }) {
  const { t } = useLang()
  const [s, setS] = React.useState<{ code: string; remaining: number; digits: number } | null>(null)
  const [bad, setBad] = React.useState(false)
  React.useEffect(() => {
    let alive = true
    const spec = C.parseTotp(value)
    if (!spec.secret) { setBad(true); setS(null); return }
    setBad(false)
    const tick = async () => {
      try {
        const c = await C.totpNowEx(spec)
        if (alive) setS({ ...c, digits: spec.digits })
      } catch { if (alive) { setS(null); setBad(true) } }
    }
    void tick()
    const i = window.setInterval(tick, 1000)
    return () => { alive = false; window.clearInterval(i) }
  }, [value])
  if (bad || !s) return <Badge variant="warn">{t.cofTotpBad}</Badge>
  const half = Math.ceil(s.digits / 2)
  return (
    <span className="inline-flex items-center gap-2 font-mono text-sm tracking-wider text-accent">
      {s.code.slice(0, half)} {s.code.slice(half)}
      <span className="text-[10px] text-fg-3 not-italic">{s.remaining}s</span>
    </span>
  )
}

// ---- barre de force (entropie estimée par la lib) ----
export function Strength({ pw }: { pw: string }) {
  const { t } = useLang()
  const st = C.passwordStrength(pw)
  const colors: Record<string, string> = {
    weak: 'bg-danger', fair: 'bg-warn', good: 'bg-accent', strong: 'bg-accent', excellent: 'bg-accent',
  }
  const labels: Record<string, string> = {
    weak: t.cofWeak, fair: t.cofFair, good: t.cofGood, strong: t.cofStrong, excellent: t.cofExcellent,
  }
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 rounded-full bg-muted overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', colors[st.label])} style={{ width: `${Math.min(100, st.bits)}%` }} />
      </div>
      <span className="text-[11px] text-fg-3">{labels[st.label]} · {st.bits} bits</span>
    </div>
  )
}

// ---- badge de catégorie (icône + libellé) ----
export function CatBadge({ cat, className }: { cat: CategoryId; className?: string }) {
  const { t } = useLang()
  const Icon = CAT_ICON[cat]
  const label = t['cofCat' + cat[0].toUpperCase() + cat.slice(1)] as string
  return (
    <span className={cn('inline-flex items-center gap-1 text-[11px] font-medium px-2 h-6 rounded-md', CAT_COLOR[cat], className)}>
      <Icon size={12} />{String(label)}
    </span>
  )
}