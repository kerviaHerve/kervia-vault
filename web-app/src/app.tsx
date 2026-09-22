import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { motion, AnimatePresence } from 'framer-motion'
import { Toaster, toast } from 'sonner'
import { LayoutDashboard, Bot, Archive, KeyRound, Shield, ScrollText, LogOut, Settings as SettingsIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import '@/index.css'
import emblem from '@/assets/emblem-dark.png'
import { LangProvider } from '@/i18n'
import { LangSwitch } from '@/i18n/LangSwitch'
import { useLang } from '@/i18n'

import Dashboard from '@/pages/dashboard'
import Agents from '@/pages/agents'
import Vaults from '@/pages/vaults'
import Secrets from '@/pages/secrets'
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
  { id: 'grants', label: 'permissions', icon: Shield },
  { id: 'audit', label: 'audit', icon: ScrollText },
  { id: 'settings', label: 'settings', icon: SettingsIcon },
] as const

type PageId = (typeof NAV)[number]['id'] | 'login'

function App() {
  const [page, setPage] = React.useState<PageId>((window.location.hash.slice(1) || 'dashboard') as PageId)
  const [authed, setAuthed] = React.useState<boolean | null>(null)
  const [setupInfo, setupSet] = React.useState<any>(null)

  React.useEffect(() => {
    fetch('/setup/info').then(r => r.json()).then(setupSet).catch(() => setupSet({ setup_done: true }))
    fetch('/admin/agents', { credentials: 'same-origin' }).then(r => setAuthed(r.ok)).catch(() => setAuthed(false))
  }, [])

  React.useEffect(() => {
    const onHash = () => setPage((window.location.hash.slice(1) || 'dashboard') as PageId)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  if (authed === null || setupInfo === null) {
    return <div className="grid place-items-center h-screen"><img src={emblem} className="w-12 h-12 animate-pulse" alt="Kervia-vault" /></div>
  }

  const go = (p: string) => { window.location.hash = p }
  const { t } = useLang()

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
            style: { background: '#1B2336', border: '1px solid #2E3A54', color: '#F8FAFC' },
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
            style: { background: '#1B2336', border: '1px solid #2E3A54', color: '#F8FAFC' },
          }}
        />
      </>
    )
  }

  return (
    <div className="flex min-h-screen">
      {/* sidebar */}
      <aside className="w-56 bg-card border-r border-border sticky top-0 h-screen flex flex-col">
        <div className="flex items-center gap-2.5 px-5 h-16 border-b border-border">
          <img src={emblem} alt="" className="w-8 h-8" />
          <span className="font-bold text-[15px] tracking-tight text-accent">Kervia-vault</span>
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
          <LangSwitch />
          <button
            onClick={logout}
            className="flex items-center gap-2 px-3 h-8 mt-1.5 w-full rounded-lg text-[11px] font-bold cursor-pointer transition-colors border bg-card-2 border-border text-fg-2 hover:text-danger hover:border-danger/40"
          >
            <LogOut size={13} />
            {String(t.logout)}
          </button>
        </div>
        <div className="px-4 py-3 border-t border-border text-[10px] text-fg-3 leading-relaxed">
          Kervia-vault v1.0 · AGPL-3.0<br />{String(t.footer)}
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
          style: { background: '#1B2336', border: '1px solid #2E3A54', color: '#F8FAFC' },
        }}
      />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<LangProvider><App /></LangProvider>)
