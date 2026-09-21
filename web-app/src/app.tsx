import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { motion, AnimatePresence } from 'framer-motion'
import { Toaster, toast } from 'sonner'
import { LayoutDashboard, Bot, Archive, KeyRound, Shield, ScrollText, Vault } from 'lucide-react'
import { cn } from '@/lib/utils'
import '@/index.css'

import Dashboard from '@/pages/dashboard'
import Agents from '@/pages/agents'
import Vaults from '@/pages/vaults'
import Secrets from '@/pages/secrets'
import Grants from '@/pages/grants'
import Audit from '@/pages/audit'
import Login from '@/pages/login'

const NAV = [
  { id: 'dashboard', label: "Vue d'ensemble", icon: LayoutDashboard },
  { id: 'agents', label: 'Agents', icon: Bot },
  { id: 'vaults', label: 'Vaults', icon: Archive },
  { id: 'secrets', label: 'Secrets', icon: KeyRound },
  { id: 'grants', label: 'Permissions', icon: Shield },
  { id: 'audit', label: 'Audit', icon: ScrollText },
] as const

type PageId = (typeof NAV)[number]['id'] | 'login'

function App() {
  const [page, setPage] = React.useState<PageId>((window.location.hash.slice(1) || 'dashboard') as PageId)
  const [authed, setAuthed] = React.useState<boolean | null>(null)

  React.useEffect(() => {
    fetch('/admin/agents', { credentials: 'same-origin' }).then(r => setAuthed(r.ok)).catch(() => setAuthed(false))
  }, [])

  React.useEffect(() => {
    const onHash = () => setPage((window.location.hash.slice(1) || 'dashboard') as PageId)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  if (authed === null) {
    return <div className="grid place-items-center h-screen"><Vault className="animate-pulse text-fg-3" size={32} /></div>
  }

  const go = (p: string) => { window.location.hash = p }

  return (
    <div className="flex min-h-screen">
      {/* sidebar */}
      <aside className="w-56 bg-card border-r border-border sticky top-0 h-screen flex flex-col">
        <div className="flex items-center gap-2.5 px-5 h-16 border-b border-border">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent to-emerald-700 grid place-items-center">
            <Vault size={16} className="text-[#0F172A]" strokeWidth={2.5} />
          </div>
          <span className="font-bold text-[15px] tracking-tight">Kervia-vault</span>
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
              {label}
            </button>
          ))}
        </nav>
        <div className="px-4 py-3 border-t border-border text-[10px] text-fg-3 leading-relaxed">
          Kervia-vault v1.0 · AGPL-3.0<br />chiffré AES-256-GCM
        </div>
      </aside>

      {/* main */}
      <main className="flex-1 min-w-0 p-8">
        <AnimatePresence mode="wait">
          <motion.div
            key={authed ? page : 'login'}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
          >
            {!authed
              ? <Login onLogin={() => { setAuthed(true); go('dashboard') }} />
              : page === 'agents' ? <Agents />
              : page === 'vaults' ? <Vaults />
              : page === 'secrets' ? <Secrets />
              : page === 'grants' ? <Grants />
              : page === 'audit' ? <Audit />
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

createRoot(document.getElementById('root')!).render(<App />)
