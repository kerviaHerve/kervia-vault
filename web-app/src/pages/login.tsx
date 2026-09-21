import * as React from 'react'
import { motion } from 'framer-motion'
import { Vault, LoaderCircle } from 'lucide-react'
import { Button, Input, Field } from '@/components/ui'

export default function Login({ onLogin }: { onLogin: () => void }) {
  const [pw, setPw] = React.useState('')
  const [err, setErr] = React.useState(false)
  const [busy, setBusy] = React.useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!pw || busy) return
    setBusy(true); setErr(false)
    const r = await fetch('/admin/login', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    })
    setBusy(false)
    if (r.ok) onLogin()
    else setErr(true)
  }

  return (
    <div className="grid place-items-center min-h-screen">
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
        className="w-[360px] bg-card border border-border rounded-2xl p-8 shadow-2xl"
      >
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-accent to-emerald-700 grid place-items-center">
            <Vault size={20} className="text-[#0F172A]" strokeWidth={2.5} />
          </div>
          <div>
            <div className="font-bold text-lg tracking-tight">Kervia-vault</div>
            <div className="text-xs text-fg-2">Coffre multi-agents</div>
          </div>
        </div>
        <form onSubmit={submit}>
          <Field label="Mot de passe administrateur">
            <Input
              type="password" value={pw} autoFocus autoComplete="current-password"
              onChange={e => { setPw(e.target.value); setErr(false) }}
              className={err ? 'border-danger' : ''}
            />
          </Field>
          {err && <p className="text-xs text-danger font-medium -mt-2 mb-4">Identifiants invalides.</p>}
          <Button variant="primary" className="w-full" type="submit" disabled={!pw || busy}>
            {busy ? <LoaderCircle size={16} className="animate-spin" /> : 'Se connecter'}
          </Button>
        </form>
      </motion.div>
    </div>
  )
}
