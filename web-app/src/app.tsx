import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { motion, AnimatePresence } from 'framer-motion'
import { Toaster, toast } from 'sonner'
import { LayoutDashboard, Bot, Archive, KeyRound, Shield, ScrollText, LogOut, Lock, Settings as SettingsIcon } from 'lucide-react'
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

function App() {
  const [page, setPage] = React.useState<PageId>((window.location.hash.slice(1) || 'dashboard') as PageId)
  const [authed, setAuthed] = React.useState<boolean | null>(null)
  const [setupInfo, setupSet] = React.useState<any>(null)
  const [upd, setUpd] = React.useState<any>(null)

  React.useEffect(() => {
    fetch('/setup/info').then(r => r.json()).then(setupSet).catch(() => setupSet({ setup_done: true }))
    fetch('/admin/agents', { credentials: 'same-origin' }).then(r => setAuthed(r.ok)).catch(() => setAuthed(false))
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

  // hooks d'affichage — toujours appelés, avant tout early return (règles de hooks)
  const { t } = useLang()
  const { theme } = useTheme()
  const kerviaLogo = theme === 'dark' ? kerviaLogoDark : kerviaLogoClair
  const kerviaIcone = theme === 'dark' ? kerviaIconeDark : kerviaIconeClair

  if (authed === null || setupInfo === null) {
    return <div className="grid place-items-center h-screen"><img src={kerviaIcone} className="w-12 h-12 animate-pulse" alt="Kervia" /></div>
  }

  const go = (p: string) => { window.location.hash = p }

  const logout = async () => {
    await fetch('/admin/logout', { method: 'POST', credentials: 'same-origin' })
    setAuthed(false)
  }

  // écran de setup (premier boot) : PLEIN ÉCRAN avec la TÊTE DE VIKING
  if (!setupInfo.setup_done) {
    return (
      <>
        <Wizard onDone={() => { setupSet({ setup_done: true }); window.location.reload() }} />
        <Toaster
          position="bottom-right"
          toastOptions={{
            style: { background: 'var(--color-card-2)', border: '1px solid var(--color-border)', color: 'var(--color-fg)' },
          }}
        />
      </>
    )
  }

  // non authentifié : écran de login PLEIN ÉCRAN (pas de sidebar ni de menus)
  if (!authed) {
    return (
      <>
        <Login onLogin={() => { setAuthed(true); go('dashboard') }} />
        <Toaster
          position="bottom-right"
          toastOptions={{
            style: { background: 'var(--color-card-2)', border: '1px solid var(--color-border)', color: 'var(--color-fg)' },
          }}
        />
      </>
    )
  }

  return (
    <div className="flex min-h-screen">
      {/* sidebar */}
      <aside className="w-56 bg-card border-r border-border sticky top-0 h-screen flex flex-col">
        {/* bloc marque — logo Kervia officiel intact + nom du produit séparé (règle kit) */}
        <div className="flex flex-col gap-1 px-5 pt-4 pb-3 border-b border-border">
          <img src={kerviaLogo} alt="Kervia" className="h-7 w-auto" />
          <span className="text-[12px] leading-[1.4] font-semibold tracking-[0.1em] ml-[31px]">Kervia-vault</span>
        </div>
        <nav className="flex-1 p-3 space-y-0.5">
          {NAV.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => go(id)}
              className={cn(
                'w-full flex items-center gap-2.5 px-3 h-9 rounded-lg text-[13px] font-medium cursor-pointer transition-colors duration-150',
                page === id ? 'bg-accent/12 text-accent' : 'text-fg-2 hover:text-fg hover:bg-card-2',
              )}
            >
              <Icon size={16} />
              {String(t[label])}
            </button>
          ))}
        </nav>
        <div className="px-3 pb-2">
          {upd?.update_available && (
            <button
              onClick={() => go('settings')}
              className="flex items-center gap-2 px-3 h-8 w-full rounded-lg text-[11px] font-bold cursor-pointer transition-colors border border-accent/40 bg-accent/10 text-accent hover:bg-accent/20 mb-1.5"
              title={`${upd.latest} disponible`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
              {String(t.updateBadge)} {upd.latest}
            </button>
          )}
          <LangSwitch />
          <ThemeToggle />
          <button
            onClick={logout}
            className="flex items-center gap-2 px-3 h-8 mt-1.5 w-full rounded-lg text-[11px] font-bold cursor-pointer transition-colors border bg-card-2 border-border text-fg-2 hover:text-danger hover:border-danger/40"
          >
            <LogOut size={13} />
            {String(t.logout)}
          </button>
        </div>
        <div className="px-4 py-3 border-t border-border text-[10px] text-fg-3 leading-relaxed">
          Kervia-vault {upd?.current || 'v1.0'} ·{' '}
          <a href="https://github.com/kerviaHerve/kervia-vault" target="_blank" rel="noreferrer"
             className="hover:text-fg-2 transition-colors">AGPL-3.0-or-later</a>
          <br />{String(t.footer)}
        </div>
      </aside>

      {/* main */}
      <main className="flex-1 min-w-0 p-8">
        <AnimatePresence mode="wait">
          <motion.div
            key={page}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
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
      </main>

      <Toaster
        position="bottom-right"
        toastOptions={{
          style: { background: 'var(--color-card-2)', border: '1px solid var(--color-border)', color: 'var(--color-fg)' },
        }}
      />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<LangProvider><App /></LangProvider>)
