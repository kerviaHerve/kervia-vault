import * as React from 'react'
import { motion } from 'framer-motion'
import { KeyRound, ShieldCheck, Clock, LoaderCircle, RotateCcw, Download, AlertTriangle, RefreshCw, ArrowUpCircle, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { useLang } from '@/i18n'
import { Button, Input, Field, Card, CardHeader, CardTitle, CardBody } from '@/components/ui'

export default function Settings() {
  const { t } = useLang()
  const [cur, setCur] = React.useState('')
  const [next, setNext] = React.useState('')
  const [confirm, setConfirm] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [info, setInfo] = React.useState<any>(null)
  const [recStatus, setRecStatus] = React.useState<number | null>(null)
  const [recCurrent, setRecCurrent] = React.useState('')
  const [recBusy, setRecBusy] = React.useState(false)
  const [kit, setKit] = React.useState<any | null>(null)
  const [upd, setUpd] = React.useState<any>(null)
  const [updBusy, setUpdBusy] = React.useState(false)
  const [restarting, setRestarting] = React.useState(false)
  const restartTimer = React.useRef<number | null>(null)

  React.useEffect(() => {
    api('GET', '/admin/settings').then(setInfo).catch(() => {})
    api('GET', '/admin/recovery/status').then((d: any) => setRecStatus(d.remaining)).catch(() => {})
    api('GET', '/admin/update/status?force=1').then(setUpd).catch(() => {})
    return () => { if (restartTimer.current) window.clearInterval(restartTimer.current) }
  }, [])

  // after an update: poll until the server is back and shows the NEW
  // version, then reload the page automatically — the user never stays
  // stuck on "restarting…".
  const watchRestart = (targetVersion: string) => {
    const started = Date.now()
    const check = async () => {
      try {
        const d = await fetch('/setup/info').then(r => r.ok ? r.json() : null)
        if (d && d.version && d.version === targetVersion && Date.now() - started > 4000) {
          window.clearInterval(restartTimer.current!)
          window.location.reload()
        }
      } catch { /* server still down — keep polling */ }
      // safety: stop after 3 minutes no matter what
      if (Date.now() - started > 180000 && restartTimer.current) {
        window.clearInterval(restartTimer.current)
      }
    }
    restartTimer.current = window.setInterval(check, 2000)
  }

  const applyUpdate = async () => {
    if (updBusy) return
    setUpdBusy(true)
    try {
      const d = await api('POST', '/admin/update/apply', {})
      setRestarting(true)
      watchRestart(String(d.to).replace(' (pré-version)', ''))
    } catch (e: any) { toast.error(e.message) }
    setUpdBusy(false)
  }

  const checkUpdate = async () => {
    try { setUpd(await api('GET', '/admin/update/status?force=1')) } catch { }
  }

  const generateRecovery = async () => {
    if (!recCurrent.trim() || recBusy) return
    setRecBusy(true)
    try {
      const d = await api('POST', '/admin/recovery/generate', { current_password: recCurrent })
      setKit(d); setRecCurrent('')
      api('GET', '/admin/recovery/status').then((x: any) => setRecStatus(x.remaining)).catch(() => {})
    } catch (e: any) { toast.error(e.message) }
    setRecBusy(false)
  }

  const downloadKit = () => {
    if (!kit) return
    const mk = localStorage.getItem('kerviavault-mk') || '' // master key NOT stored client-side normally
    const txt = [
      'Kervia-vault — KIT DE RÉCUPÉRATION',
      '================================',
      '',
      'Codes de récupération (usage unique):',
      ...kit.codes.map((c: string, i: number) => `  ${i + 1}. ${c}`),
      '',
      'Chaque code permet de réinitialiser le mot de passe administrateur',
      'sans accès au serveur. Ils ne seront plus jamais affichés.',
    ].join('\n')
    const blob = new Blob([txt], { type: 'text/plain' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'kervia-vault-recovery-kit.txt'
    a.click()
    toast.success(String(t.recoveryDownload) + ' ✓')
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    if (next !== confirm) { toast.error(String(t.passwordMismatch)); return }
    if (next.length < 12) { toast.error(String(t.passwordHelp)); return }
    setBusy(true)
    try {
      await api('POST', '/admin/password', { current_password: cur, new_password: next })
      toast.success(String(t.passwordUpdated))
      setCur(''); setNext(''); setConfirm('')
    } catch (e: any) { toast.error(e.message === 'invalid_credentials' ? String(t.passwordWrong) : e.message) }
    setBusy(false)
  }

  return (
    <div className="max-w-xl">
      <h1 className="text-xl font-bold tracking-tight mb-1">Paramètres</h1>
      <p className="text-sm text-fg-2 mb-6">{String(t.settingsSub)}</p>

      {/* version + mise à jour */}
      <Card className="mb-5">
        <CardHeader>
          <span className="flex items-center gap-2"><RefreshCw size={15} /> {String(t.versionTitle)}</span>
        </CardHeader>
        <CardBody>
          {restarting ? (
            <div className="space-y-2">
              <div className="flex items-center gap-3 text-sm text-accent py-2">
                <LoaderCircle size={18} className="animate-spin" />
                {String(t.updateRestarting)}
              </div>
              <p className="text-[11px] text-fg-3">{String(t.updateRestartHint)}</p>
            </div>
          ) : upd ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm">
                <span className="font-mono font-semibold">{upd.current || 'dev'}</span>
                {upd.update_available ? (
                  <span className="flex items-center gap-1.5 text-accent font-medium">
                    <ArrowUpCircle size={14} /> {String(t.updateTo)} <span className="font-mono">{upd.latest}</span>
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-fg-3">
                    <CheckCircle2 size={14} /> {upd.latest ? String(t.upToDate) : String(t.updateCheckFail)}
                  </span>
                )}
              </div>
              {upd.last_error && <p className="text-[11px] text-danger">{upd.last_error}</p>}
              {upd.mode === 'docker' && <p className="text-[11px] text-warn">{String(t.updateDocker)}</p>}
              <div className="flex gap-2">
                {upd.update_available && upd.mode !== 'docker' && (
                  <Button variant="primary" onClick={applyUpdate} disabled={updBusy}>
                    {updBusy ? <LoaderCircle size={14} className="animate-spin" /> : <><ArrowUpCircle size={14} /> {String(t.updateBtn)}</>}
                  </Button>
                )}
                <Button onClick={checkUpdate} disabled={updBusy}>
                  <RefreshCw size={14} /> {String(t.updateCheck)}
                </Button>
              </div>
              <p className="text-[11px] text-fg-3 leading-relaxed">{String(t.updateHint)}</p>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-fg-3 py-2">
              <LoaderCircle size={15} className="animate-spin" /> {String(t.updateChecking)}
            </div>
          )}
        </CardBody>
      </Card>

      <Card className="mb-5">
        <CardHeader>
          <span className="flex items-center gap-2"><KeyRound size={15} /> {String(t.update)}</span>
        </CardHeader>
        <CardBody>
          <form onSubmit={submit}>
            <Field label={String(t.currentPassword)}>
              <Input type="password" value={cur} onChange={e => setCur(e.target.value)} autoComplete="current-password" />
            </Field>
            <Field label={String(t.newPassword)} help={String(t.passwordHelp)}>
              <Input type="password" value={next} onChange={e => setNext(e.target.value)} autoComplete="new-password" />
            </Field>
            <Field label={String(t.confirmPassword)}>
              <Input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password"
                className={confirm && next !== confirm ? 'border-danger' : ''} />
            </Field>
            {confirm && next !== confirm && <p className="text-xs text-danger font-medium -mt-2 mb-3">{String(t.passwordMismatch)}</p>}
            <Button variant="primary" type="submit" disabled={!cur || !next || next !== confirm || busy}>
              {busy ? <LoaderCircle size={15} className="animate-spin" /> : String(t.update)}
            </Button>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader><span className="flex items-center gap-2"><ShieldCheck size={15} /> Sécurité</span></CardHeader>
        <CardBody className="space-y-3">
          <div className="flex items-center gap-3 text-sm">
            <Clock size={15} className="text-fg-3" />
            <span className="text-fg-2">{String(t.retention)}</span>
            <span className="font-semibold text-accent">{info?.audit_retention_days ?? 90} {String(t.days)}</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <ShieldCheck size={15} className="text-fg-3" />
            <span className="text-fg-2">{String(t.encryption)}</span>
            <span className="font-semibold">AES-256-GCM</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <KeyRound size={15} className="text-fg-3" />
            <span className="text-fg-2">{String(t.minPassword)}</span>
            <span className="font-semibold">{info?.min_password_length ?? 12} {String(t.chars)}</span>
          </div>
        </CardBody>
      </Card>

      <Card className="mt-5">
        <CardHeader>
          <span className="flex items-center gap-2"><RotateCcw size={15} /> {String(t.recoveryTitle)}</span>
          <span className="text-xs text-accent font-semibold">{recStatus ?? '—'} {String(t.recoveryRemaining)}</span>
        </CardHeader>
        <CardBody>
          <p className="text-xs text-fg-2 mb-4">{String(t.recoveryWarning)}</p>
          <Field label={String(t.currentPassword)}>
            <Input type="password" value={recCurrent} onChange={e => setRecCurrent(e.target.value)}
              autoComplete="current-password" className="max-w-xs" />
          </Field>
          <Button variant="primary" onClick={generateRecovery} disabled={!recCurrent.trim() || recBusy}>
            {recBusy ? <LoaderCircle size={15} className="animate-spin" /> : <><RotateCcw size={14} /> {String(t.recoveryGen)}</>}
          </Button>

          {kit && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-5 border border-accent/40 rounded-xl p-4 bg-bg"
            >
              <p className="text-xs font-semibold text-accent mb-2">{String(t.recoveryTitle)}</p>
              <div className="font-mono text-sm space-y-1 mb-3">
                {kit.codes.map((c: string, i: number) => (
                  <div key={i}>{String(i + 1).padStart(2, '0')} · {c}</div>
                ))}
              </div>
              <div className="flex gap-2">
                <Button variant="primary" onClick={downloadKit}><Download size={14} /> {String(t.recoveryDownload)}</Button>
                <Button onClick={() => setKit(null)}>OK</Button>
              </div>
              <div className="mt-3 flex gap-2 items-start bg-warn/10 text-warn rounded-lg px-3 py-2 text-[11px]">
                <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                {String(t.recoveryWarning)}
              </div>
            </motion.div>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
