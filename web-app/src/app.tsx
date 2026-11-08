import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { motion, AnimatePresence, MotionConfig } from 'framer-motion'
import { Toaster, toast } from 'sonner'
import { LayoutDashboard, Bot, Archive, KeyRound, Shield, ScrollText, LogOut, Lock, Settings as SettingsIcon, Menu, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import '@/index.css'
import kerviaLogoDark from '@/assets/kervia-logo-dark.svg'
import kerviaLogoClair from '@/assets/kervia-logo-clair.svg'
import kerviaIconeDark from '@/assets/kervia-icone-dark.svg'
import kerviaIconeClair from '@/assets/kervia-icone-claire.svg'
import { LangProvider } from '@/i18n'
import { LangSwitch } from '@/i18n/LangSwitch'
import { useLang } from '@/i18n'
import { useTheme } from '@/theme'
import { ThemeToggle } from '@/components/ThemeToggle'
import { TooltipProvider, BrandBlock } from '@/components/ui'
import { setOnUnauthorized } from '@/lib/api'

import Dashboard from '@/pages/dashboard'
import Agents from '@/pages/agents'
import Vaults from '@/pages/vaults'
import Secrets from '@/pages/secrets'
import Coffre from '@/pages/coffre'
import Grants from '@/pages/grants'
import Audit from '@/pages/audit'
import Settings from '@/pages/settings'
import Login from '@/pages/login'
import Wizard from '@/pages/wizard'

/* Toast = couche flottante au-dessus du contenu → matériau translucide
   (skill §12) : le contenu défile dessous, la surface lit comme un vrai
   matériau. Sous prefers-reduced-transparency, .kv-glass la rend opaque. */
const toastGlass: React.CSSProperties = {
  background: 'color-mix(in srgb, var(--color-card-2) 72%, transparent)',
  backdropFilter: 'blur(20px) saturate(180%)',
  WebkitBackdropFilter: 'blur(20px) saturate(180%)',
  border: '1px solid var(--color-border)',
  color: 'var(--color-fg)',
}

const NAV = [
  { id: 'dashboard', label: 'overview', icon: LayoutDashboard },
  { id: 'agents', label: 'agents', icon: Bot },
  { id: 'vaults', label: 'vaults', icon: Archive },
  { id: 'secrets', label: 'secrets', icon: KeyRound },
  { id: 'coffre', label: 'coffre', icon: Lock },
  { id: 'grants', label: 'permissions', icon: Shield },
  { id: 'audit', label: 'audit', icon: ScrollText },
  { id: 'settings', label: 'settings', icon: SettingsIcon },
] as const

type PageId = (typeof NAV)[number]['id'] | 'login'

// ---- ErrorBoundary (v1.7.1, i18n v1.8.6) ------------------------------------
// Filet de sécurité : un crash de rendu (composant, provider, i18n…)
// affiche une carte claire + bouton recharger, JAMAIS une page blanche
// ou figée sans explication. Auto-contenu : aucun import risqué (le
// crash peut venir de n'importe quel module), bilingue via localStorage
// (pas de hook dans une classe), tokens du thème avec fallback inline.
const EB_TEXT = {
  fr: { title: 'Une erreur inattendue est survenue', body: 'Vos données ne risquent rien : tout est chiffré et stocké côté serveur. Rechargez la page.', btn: 'Recharger' },
  en: { title: 'Something went wrong', body: 'Your data is safe: everything is encrypted and stored server-side. Reload the page.', btn: 'Reload' },
} as const

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  render() {
    const e = this.state.error
    if (!e) return this.props.children
    const L = localStorage.getItem('kerviavault-lang') === 'en' ? EB_TEXT.en : EB_TEXT.fr
    return (
      <div className="min-h-screen grid place-items-center bg-bg p-6" style={{ background: 'var(--color-bg, #171B19)', color: 'var(--color-fg, #F4F5F1)' }}>
        <div className="max-w-md w-full border border-danger/40 bg-card rounded-2xl p-8 text-center"
          style={{ background: 'var(--color-card, #222A25)', color: 'var(--color-fg, #e9efe9)', fontFamily: 'system-ui, sans-serif' }}>
          <div className="w-12 h-12 rounded-xl mx-auto mb-4 grid place-items-center text-danger"
            style={{ background: 'color-mix(in srgb, var(--color-danger, #FFADA7) 14%, transparent)' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
              <path d="M12 9v4" /><path d="M12 17h.01" />
            </svg>
          </div>
          <h1 className="text-lg font-bold">{L.title}</h1>
          <p className="text-sm mt-2 leading-relaxed text-fg-2">{L.body}</p>
          <pre className="mt-4 text-left text-2xs font-mono rounded-lg p-3 max-h-32 overflow-auto whitespace-pre-wrap bg-bg text-fg-2">
            {String((e && (e.message || e)) || e)}
          </pre>
          <button onClick={() => window.location.reload()}
            className="mt-5 h-9 px-4 rounded-lg text-sm font-semibold cursor-pointer w-full bg-accent text-accent-text">
            {L.btn}
          </button>
        </div>
      </div>
    )
  }
}

function App() {
  const [page, setPage] = React.useState<PageId>((window.location.hash.slice(1) || 'dashboard') as PageId)
  const [authed, setAuthed] = React.useState<boolean | null>(null)
  const [setupInfo, setupSet] = React.useState<any>(null)
  const [upd, setUpd] = React.useState<any>(null)
  const [navOpen, setNavOpen] = React.useState(false) // drawer < lg (v1.8.6)

  React.useEffect(() => {
    fetch('/setup/info').then(r => r.json()).then(setupSet).catch(() => setupSet({ setup_done: true }))
    fetch('/admin/agents', { credentials: 'same-origin' }).then(r => setAuthed(r.ok)).catch(() => setAuthed(false))
  }, [])

  // v1.8.6 (audit A1) : session expirée en cours d'usage — avant, chaque page
  // restait blanche ou mentait (« Aucun vault »). Le 401 intercepté par api()
  // atterrit ICI : toast explicite + retour au login, une seule fois.
  React.useEffect(() => {
    setOnUnauthorized(() => {
      setAuthed(false)
      toast.error(localStorage.getItem('kerviavault-lang') === 'en' ? 'Session expired — sign in again.' : 'Session expirée — reconnectez-vous.')
    })
    return () => setOnUnauthorized(null)
  }, [])

  // update check once logged in (badge in the sidebar, details in Settings)
  React.useEffect(() => {
    if (authed === true && upd === null) {
      fetch('/admin/update/status', { credentials: 'same-origin' })
        .then(r => r.ok ? r.json() : null).then(d => { if (d) setUpd(d) }).catch(() => {})
    }
  }, [authed])

  React.useEffect(() => {
    const onHash = () => setPage((window.location.hash.slice(1) || 'dashboard') as PageId)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // Escape ferme le drawer mobile
  React.useEffect(() => {
    if (!navOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setNavOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navOpen])

  // hooks d'affichage — toujours appelés, avant tout early return (règles de hooks)
  const { t } = useLang()
  const { theme } = useTheme()
  const kerviaLogo = theme === 'dark' ? kerviaLogoDark : kerviaLogoClair
  const kerviaIcone = theme === 'dark' ? kerviaIconeDark : kerviaIconeClair

  if (authed === null || setupInfo === null) {
    return (
      <div className="grid place-items-center h-screen" role="status" aria-busy="true" aria-label={String(t.loading)}>
        <span className="sr-only">{String(t.loading)}</span>
        <img src={kerviaIcone} className="w-12 h-12 animate-pulse" alt="" />
      </div>
    )
  }

  const go = (p: string) => { window.location.hash = p; setNavOpen(false) }

  const logout = async () => {
    await fetch('/admin/logout', { method: 'POST', credentials: 'same-origin' })
    setAuthed(false)
  }

  // v1.8.6 : UN seul <Toaster> déclaré une fois, rendu dans chaque branche.
  const toaster = <Toaster position="bottom-right" toastOptions={{ style: toastGlass, className: 'kv-glass' }} />

  // écran de setup (premier boot) : PLEIN ÉCRAN avec wizard
  if (!setupInfo.setup_done) {
    return (
      <>
        <Wizard onDone={() => { setupSet({ setup_done: true }); window.location.reload() }} />
        {toaster}
      </>
    )
  }

  // non authentifié : écran de login PLEIN ÉCRAN (pas de sidebar ni de menus)
  if (!authed) {
    return (
      <>
        <Login onLogin={() => { setAuthed(true); go('dashboard') }} />
        {toaster}
      </>
    )
  }

  const navButtons = (
    <nav className="flex-1 p-3 space-y-0.5" aria-label={String(t.overview)}>
      {NAV.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          onClick={() => go(id)}
          // v1.8.6 (WCAG 2.4.8/4.1.2) : la page active est annoncée —
          // avant, elle n'était distinguée que par la couleur.
          aria-current={page === id ? 'page' : undefined}
          className={cn(
            'w-full flex items-center gap-2.5 px-3 h-9 rounded-lg text-sm font-medium cursor-pointer',
            'transition-[color,background-color,transform] duration-150 ease-out active:scale-[0.98]',
            page === id ? 'bg-accent/12 text-accent-fg' : 'text-fg-2 hover:text-fg hover:bg-card-2',
          )}
        >
          <Icon size={16} aria-hidden="true" />
          {String(t[label])}
        </button>
      ))}
    </nav>
  )

  return (
    <div className="flex min-h-screen">
      {/* v1.8.6 (WCAG 2.4.1) : lien d'évitement — premier élément focusable. */}
      <a
        href="#main"
        onClick={e => { e.preventDefault(); (document.getElementById('main') as HTMLElement)?.focus() }}
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[70] focus:px-4 focus:py-2 focus:rounded-lg focus:bg-accent focus:text-accent-text focus:text-sm focus:font-semibold focus:shadow-xl"
      >
        {String(t.skipToContent)}
      </a>

      {/* v1.8.6 (reflow) : < lg la sidebar devient un drawer (hamburger),
          sur desktop elle redevient la colonne sticky historique. */}
      {navOpen && (
        <button
          aria-label={String(t.close)}
          onClick={() => setNavOpen(false)}
          className="fixed inset-0 z-30 bg-black/60 cursor-default lg:hidden"
        />
      )}
      <aside
        id="sidebar"
        className={cn(
          'w-56 bg-card border-r border-border flex flex-col z-40',
          'fixed inset-y-0 left-0 lg:sticky lg:top-0 lg:h-screen lg:z-auto lg:translate-x-0 lg:static',
          'transition-transform duration-200 ease-out',
          navOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        )}
      >
        {/* bloc marque — BrandBlock (v1.8.6) : logo Kervia officiel intact +
            nom du produit séparé (règle kit), une seule implémentation */}
        <div className="flex items-center justify-between gap-2 px-5 pt-4 pb-3 border-b border-border">
          <BrandBlock size="sm" />
          {/* fermeture du drawer mobile */}
          <button onClick={() => setNavOpen(false)} aria-label={String(t.close)} className="lg:hidden text-fg-3 hover:text-fg cursor-pointer rounded-md p-1.5 hover:bg-card-2">
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        {navButtons}
        <div className="px-3 pb-2">
          {upd?.update_available && (
            <button
              onClick={() => go('settings')}
              className="flex items-center gap-2 px-3 h-8 w-full rounded-lg text-2xs font-bold cursor-pointer transition-colors border border-accent/40 bg-accent/10 text-accent-fg hover:bg-accent/20 mb-1.5"
              aria-label={`${String(t.updateBadge)} ${upd.latest}`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" aria-hidden="true" />
              {String(t.updateBadge)} {upd.latest}
            </button>
          )}
          <LangSwitch />
          <ThemeToggle />
          <button
            onClick={logout}
            className="flex items-center gap-2 px-3 h-8 mt-1.5 w-full rounded-lg text-2xs font-bold cursor-pointer transition-colors border bg-card-2 border-border text-fg-2 hover:text-danger hover:border-danger/40"
          >
            <LogOut size={13} aria-hidden="true" />
            {String(t.logout)}
          </button>
        </div>
        <div className="px-4 py-3 border-t border-border text-2xs text-fg-3 leading-relaxed">
          Kervia-vault {upd?.current || 'v1.0'} ·{' '}
          <a href="https://github.com/kerviaHerve/kervia-vault" target="_blank" rel="noreferrer"
             className="hover:text-fg-2 transition-colors">AGPL-3.0-or-later</a>
          <br />{String(t.footer)}
        </div>
      </aside>

      {/* main — v1.8.6 : id pour le skip-link, focusable, padding responsive,
          largeur bornée (lisible sur écran large) */}
      <div className="flex-1 min-w-0">
        {/* barre mobile (hamburger) */}
        <header className="lg:hidden sticky top-0 z-20 bg-bg/90 backdrop-blur border-b border-border flex items-center gap-3 px-4 h-12">
          <button
            onClick={() => setNavOpen(true)}
            aria-label={String(t.menu)}
            aria-expanded={navOpen}
            aria-controls="sidebar"
            className="text-fg-2 hover:text-fg cursor-pointer rounded-md p-1.5 hover:bg-card-2"
          >
            <Menu size={18} aria-hidden="true" />
          </button>
          <img src={kerviaLogo} alt="" className="h-5 w-auto" />
        </header>
        <main id="main" tabIndex={-1} className="p-4 md:p-8 outline-none">
          <div className="max-w-6xl mx-auto">
            <AnimatePresence mode="wait">
              <motion.div
                key={page}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                /* Spring amorti critique (damping 1.0, response ~0.3) — le
                   standard Apple pour la navigation : pas d'overshoot sur une
                   action qui n'en porte pas (skill §4), interruptible par
                   construction, et réduit automatiquement sous
                   prefers-reduced-motion via MotionConfig. */
                transition={{ type: 'spring', bounce: 0, duration: 0.3 }}
              >
                {page === 'agents' ? <Agents />
                  : page === 'vaults' ? <Vaults />
                  : page === 'secrets' ? <Secrets />
                  : page === 'coffre' ? <Coffre />
                  : page === 'grants' ? <Grants />
                  : page === 'audit' ? <Audit />
                  : page === 'settings' ? <Settings />
                  : <Dashboard go={go} />}
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>

      {toaster}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  /* reducedMotion="user" : framer bascule en cross-fade dès que l'utilisateur
     demande moins de mouvement (skill §14) — équivalent doux, pas l'absence. */
  <MotionConfig reducedMotion="user">
    <LangProvider>
      <TooltipProvider>
        <ErrorBoundary><App /></ErrorBoundary>
      </TooltipProvider>
    </LangProvider>
  </MotionConfig>
)
