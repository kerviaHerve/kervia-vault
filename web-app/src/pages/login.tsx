import * as React from 'react'
import { motion } from 'framer-motion'
import { LoaderCircle, Globe } from 'lucide-react'
import { Button, Input, Field } from '@/components/ui'
import { useLang } from '@/i18n'
import { useTheme } from '@/theme'
import { ThemeToggle } from '@/components/ThemeToggle'
import kerviaLogoDark from '@/assets/kervia-logo-dark.svg'
import kerviaLogoClair from '@/assets/kervia-logo-clair.svg'

export default function Login({ onLogin }: { onLogin: () => void }) {
  const { t, lang, setLang } = useLang()
  const { theme } = useTheme()
  const kerviaLogo = theme === 'dark' ? kerviaLogoDark : kerviaLogoClair
  const [pw, setPw] = React.useState('')
  const [err, setErr] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  // 2FA : le champ n'apparaît que si l'instance exige un second facteur
  const [totp, setTotp] = React.useState(false)
  const [code, setCode] = React.useState('')

  React.useEffect(() => {
    fetch('/totp/status').then(r => r.json()).then(d => setTotp(!!d.enabled)).catch(() => {})
  }, [])

  const [showRecover, setShowRecover] = React.useState(false)
  const [recCode, setRecCode] = React.useState('')
  const [recPass, setRecPass] = React.useState('')
  const [recBusy, setRecBusy] = React.useState(false)
  const [recErr, setRecErr] = React.useState(false)
  const [recOk, setRecOk] = React.useState(false)

  const recover = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!recCode.trim() || recPass.length < 12 || recBusy) return
    setRecBusy(true); setRecErr(false)
    const r = await fetch('/recovery/recover', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: recCode.trim().toUpperCase(), new_password: recPass }),
    })
    setRecBusy(false)
    if (r.ok) { setRecOk(true); setShowRecover(false); setPw(recPass) }
    else setRecErr(true)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!pw || busy) return
    setBusy(true); setErr(false)
    const r = await fetch('/admin/login', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw, totp: code.trim() }),
    })
    setBusy(false)
    if (r.ok) onLogin()
    else setErr(true)
  }

  return (
    <div className="grid place-items-center min-h-screen relative">
      {/* sélecteur de langue + bascule de thème — coin haut droit */}
      <div className="absolute top-4 right-4 flex items-center gap-2">
        <button
          onClick={() => setLang(lang === 'fr' ? 'en' : 'fr')}
          className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-[11px] font-bold cursor-pointer transition-colors border bg-card-2 border-border text-fg-2 hover:text-fg"
          title="FR / EN"
        >
          <Globe size={13} />
          {lang === 'fr' ? 'FR' : 'EN'}
        </button>
        <ThemeToggle className="!w-auto" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
        className="w-[360px] bg-card border border-border rounded-2xl p-8 shadow-2xl"
      >
        {/* bloc marque — logo Kervia officiel intact + nom du produit séparé (règle kit) */}
        <div className="flex flex-col items-center gap-2.5 mb-6">
          <img src={kerviaLogo} alt="Kervia" className="h-12 w-auto" />
          <div className="text-center">
            <div className="text-[12px] font-semibold tracking-[0.1em] text-fg-2">Kervia-vault</div>
            <div className="text-xs text-fg-3 mt-1">{String(t.loginTitle)}</div>
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
          {totp && (
            <Field label={String(t.loginTotp)}>
              <Input
                value={code} inputMode="numeric" maxLength={6} autoComplete="one-time-code"
                onChange={e => { setCode(e.target.value.replace(/\D/g, '')); setErr(false) }}
                placeholder="123456" className="font-mono tracking-[0.25em]"
              />
            </Field>
          )}
          {err && <p className="text-xs text-danger font-medium -mt-2 mb-4">{String(t.loginError)}</p>}
          <Button variant="primary" className="w-full" type="submit" disabled={!pw || busy || (totp && code.length !== 6)}>
            {busy ? <LoaderCircle size={16} className="animate-spin" /> : String(t.loginBtn)}
          </Button>
          <button
            onClick={() => setShowRecover(!showRecover)}
            className="mt-3 text-[11px] text-fg-3 hover:text-fg-2 transition-colors cursor-pointer w-full text-center"
          >
            {String(t.forgotPassword)}
          </button>
        </form>

        {showRecover && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="overflow-hidden">
            {recOk ? (
              <p className="text-xs text-accent font-semibold mt-4 text-center">{String(t.recoverOK)}</p>
            ) : (
              <form onSubmit={recover} className="mt-4 pt-4 border-t border-border">
                <p className="text-xs font-semibold text-fg-2 mb-3">{String(t.recoverTitle)}</p>
                <Field label={String(t.recoverCode)}>
                  <Input value={recCode} onChange={e => { setRecCode(e.target.value); setRecErr(false) }}
                    placeholder="AGV-XXXXX-XXXXX" className="font-mono" />
                </Field>
                <Field label={String(t.recoverNew)} help={String(t.passwordHelp)}>
                  <Input type="password" value={recPass} onChange={e => { setRecPass(e.target.value); setRecErr(false) }} />
                </Field>
                {recErr && <p className="text-xs text-danger font-medium -mt-2 mb-3">{String(t.recoverBad)}</p>}
                <Button variant="primary" className="w-full" type="submit" disabled={!recCode.trim() || recPass.length < 12 || recBusy}>
                  {recBusy ? <LoaderCircle size={15} className="animate-spin" /> : String(t.recoverBtn)}
                </Button>
              </form>
            )}
          </motion.div>
        )}
      </motion.div>

      {/* footer discret — version, kervia.ch, GitHub, AGPL */}
      <div className="absolute bottom-4 flex items-center gap-4 text-[11px] text-fg-3">
        <span>v1.0</span>
        <a href="https://kervia.ch" target="_blank" rel="noreferrer"
           className="hover:text-fg-2 transition-colors">kervia.ch</a>
        <span>by <span className="text-fg-2">kervia</span></span>
        <a href="https://github.com/kerviaHerve/kervia-vault" target="_blank" rel="noreferrer"
           className="hover:text-fg-2 transition-colors" title="GitHub"
           aria-label="GitHub">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/>
          </svg>
        </a>
        <a href="https://www.gnu.org/licenses/agpl-3.0.html" target="_blank" rel="noreferrer"
           className="hover:text-fg-2 transition-colors">AGPL-3.0</a>
      </div>
    </div>
  )
}
