import * as React from 'react'
import { motion } from 'framer-motion'
import { LoaderCircle } from 'lucide-react'
import { useLang } from '@/i18n'
import emblem from '@/assets/emblem-dark.png'
import { Button, Input, Field } from '@/components/ui'

export default function Login({ onLogin }: { onLogin: () => void }) {
  const { t } = useLang()
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
        <div className="flex flex-col items-center gap-3 mb-6">
          <img src={emblem} alt="Kervia-vault" className="w-16 h-16" />
          <div className="text-center">
            <div className="font-bold text-xl tracking-tight text-accent">Kervia-vault</div>
            <div className="text-xs text-fg-2">{String(t.loginTitle)}</div>
          </div>
        </div>
        <form onSubmit={submit}>
          <Field label={String(t.loginLabel)}>
            <Input
              type="password" value={pw} autoFocus autoComplete="current-password"
              onChange={e => { setPw(e.target.value); setErr(false) }}
              className={err ? 'border-danger' : ''}
            />
          </Field>
          {err && <p className="text-xs text-danger font-medium -mt-2 mb-4">{String(t.loginError)}</p>}
          <Button variant="primary" className="w-full" type="submit" disabled={!pw || busy}>
            {busy ? <LoaderCircle size={16} className="animate-spin" /> : String(t.loginBtn)}
          </Button>
        </form>
      </motion.div>
    </div>
  )
}
