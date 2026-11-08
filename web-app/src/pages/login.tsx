import * as React from 'react'
import { motion } from 'framer-motion'
import { LoaderCircle } from 'lucide-react'
import { Button, Input, Field, PasswordInput, BrandBlock } from '@/components/ui'
import { useLang } from '@/i18n'
import { LangSwitch } from '@/i18n/LangSwitch'
import { ThemeToggle } from '@/components/ThemeToggle'

export default function Login({ onLogin }: { onLogin: () => void }) {
  const { t } = useLang()
  const [pw, setPw] = React.useState('')
  // Message d'erreur localisé (null = pas d'erreur). C2 : le statut HTTP
  // décide du message — un lockout 429 ou un serveur injoignable n'ont rien
  // à voir avec des « identifiants invalides ».
  const [err, setErr] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  // Caps Lock actif sur le champ mot de passe → hint discret lié au champ.
  const [caps, setCaps] = React.useState(false)
  // 2FA tri-state (C3) : 'on' = l'instance exige un code, 'off' = non,
  // 'unknown' = /totp/status injoignable. Avant, un échec de statut masquait
  // le champ pour toujours : l'utilisateur ne comprenait pas pourquoi son
  // mot de passe correct était refusé.
  const [totp, setTotp] = React.useState<'on' | 'off' | 'unknown'>('unknown')
  const [code, setCode] = React.useState('')

  React.useEffect(() => {
    fetch('/totp/status')
      .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json() })
      .then(d => setTotp(d?.enabled ? 'on' : 'off'))
      .catch(() => setTotp('unknown'))
  }, [])

  const showTotp = totp !== 'off'
  // 2FA exigée → code complet obligatoire ; statut inconnu → vide (2FA
  // absente) ou 6 chiffres — jamais un code tronqué envoyé au serveur.
  const codeOk = totp === 'on' ? code.length === 6 : code.length === 0 || code.length === 6

  const [showRecover, setShowRecover] = React.useState(false)
  const [recCode, setRecCode] = React.useState('')
  const [recPass, setRecPass] = React.useState('')
  // C1 : confirmation obligatoire du nouveau mot de passe — le flux brûle
  // le code à usage unique, une faute de frappe = lockout définitif.
  const [recPass2, setRecPass2] = React.useState('')
  const [recBusy, setRecBusy] = React.useState(false)
  const [recErr, setRecErr] = React.useState<string | null>(null)
  const [recOk, setRecOk] = React.useState(false)
  const recMismatch = recPass2 !== '' && recPass !== recPass2

  const recover = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!recCode.trim() || recPass.length < 12 || recPass !== recPass2 || recBusy) return
    setRecBusy(true); setRecErr(null)
    try {
      const r = await fetch('/recovery/recover', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: recCode.trim().toUpperCase(), new_password: recPass }),
      })
      // C1 : le panneau reste ouvert pour AFFICHER la confirmation — avant,
      // il se refermait avant que recOk ne soit visible (code mort).
      if (r.ok) { setRecOk(true); setPw(recPass) }
      else setRecErr(String(t.recoverBad))
    } catch {
      setRecErr(String(t.loginServerErr))
    } finally {
      setRecBusy(false)
    }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!pw || busy) return
    setBusy(true); setErr(null)
    try {
      const r = await fetch('/admin/login', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw, totp: code.trim() }),
      })
      if (r.ok) { onLogin(); return }
      // C2 : message par statut — 401/4xx identifiants, 429 lockout,
      // 5xx/réseau serveur injoignable.
      if (r.status === 429) setErr(String(t.loginRateLimited))
      else if (r.status >= 500) setErr(String(t.loginServerErr))
      else setErr(String(t.loginError))
    } catch {
      setErr(String(t.loginServerErr))
    } finally {
      setBusy(false)
    }
  }

  return (
    // app.tsx rend le mode login HORS du shell (pas de <main>) — la page
    // fournit elle-même son landmark principal.
    <main className="grid place-items-center min-h-screen relative">
      {/* sélecteur de langue + bascule de thème — coin haut droit */}
      <div className="absolute top-4 right-4 flex items-center gap-2">
        <LangSwitch className="!w-auto" />
        <ThemeToggle className="!w-auto" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
        className="w-[360px] bg-card border border-border rounded-2xl p-8 shadow-2xl"
      >
        {/* bloc marque — BrandBlock (v1.8.6) : une seule implémentation
            (la tagline EST le h1 unique de la page — C4) */}
        <BrandBlock
          size="md"
          centered
          className="mb-6"
          tagline={String(t.loginTitle)}
          taglineAs="h1"
        />
        <form onSubmit={submit}>
          {/* Erreur et hint Caps Lock passent par le pattern Field (aria-invalid
              + aria-describedby + role="alert") — la bordure rouge seule restait
              une pure information de couleur pour les lecteurs d'écran. */}
          <Field
            label={String(t.loginLabel)}
            help={caps ? String(t.capsLock) : undefined}
            error={err ?? undefined}
          >
            <PasswordInput
              value={pw} autoFocus autoComplete="current-password"
              onChange={e => { setPw(e.target.value); setErr(null) }}
              onKeyDown={e => setCaps(e.getModifierState('CapsLock'))}
              onKeyUp={e => setCaps(e.getModifierState('CapsLock'))}
              onBlur={() => setCaps(false)}
              className={err ? 'border-danger' : ''}
            />
          </Field>
          {showTotp && (
            <Field
              label={String(t.loginTotp)}
              help={totp === 'unknown' ? String(t.totpOptional) : undefined}
            >
              <Input
                value={code} inputMode="numeric" maxLength={6} autoComplete="one-time-code"
                onChange={e => { setCode(e.target.value.replace(/\D/g, '')); setErr(null) }}
                placeholder="123456" className="font-mono tracking-[0.25em]"
              />
            </Field>
          )}
          <Button variant="primary" size="lg" className="w-full" type="submit"
            disabled={!pw || busy || !codeOk} aria-busy={busy}>
            {busy ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> : String(t.loginBtn)}
          </Button>
          <button
            onClick={() => setShowRecover(!showRecover)}
            aria-expanded={showRecover}
            aria-controls="recover-panel"
            className="mt-3 text-2xs text-fg-3 hover:text-fg-2 transition-colors cursor-pointer w-full text-center"
          >
            {String(t.forgotPassword)}
          </button>
        </form>

        {showRecover && (
          <motion.div id="recover-panel" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="overflow-hidden">
            {recOk ? (
              <p className="text-xs text-accent-fg font-semibold mt-4 text-center" role="status">{String(t.recoverOK)}</p>
            ) : (
              <form onSubmit={recover} className="mt-4 pt-4 border-t border-border">
                <p className="text-xs font-semibold text-fg-2 mb-3">{String(t.recoverTitle)}</p>
                <Field label={String(t.recoverCode)} error={recErr ?? undefined}>
                  <Input value={recCode} onChange={e => { setRecCode(e.target.value); setRecErr(null) }}
                    placeholder="AGV-XXXXX-XXXXX" className="font-mono" />
                </Field>
                <Field label={String(t.recoverNew)} help={String(t.passwordHelp)}>
                  <PasswordInput value={recPass} autoComplete="new-password"
                    onChange={e => { setRecPass(e.target.value); setRecErr(null) }} />
                </Field>
                <Field label={String(t.confirmPassword)} error={recMismatch ? String(t.passwordMismatch) : undefined}>
                  <PasswordInput value={recPass2} autoComplete="new-password"
                    onChange={e => { setRecPass2(e.target.value); setRecErr(null) }} />
                </Field>
                <Button variant="primary" size="lg" className="w-full" type="submit"
                  disabled={!recCode.trim() || recPass.length < 12 || recPass !== recPass2 || recBusy} aria-busy={recBusy}>
                  {recBusy ? <LoaderCircle size={15} className="animate-spin" aria-hidden="true" /> : String(t.recoverBtn)}
                </Button>
              </form>
            )}
          </motion.div>
        )}
      </motion.div>

      {/* footer discret — version, kervia.ch, GitHub, AGPL */}
      <div className="absolute bottom-4 flex items-center gap-4 text-2xs text-fg-3">
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
    </main>
  )
}
