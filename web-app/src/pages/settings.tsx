import * as React from 'react'
import { motion } from 'framer-motion'
import { KeyRound, ShieldCheck, Clock, LoaderCircle, RotateCcw, Download, RefreshCw, ArrowUpCircle, CheckCircle2, Smartphone, Copy, History, Puzzle } from 'lucide-react'
import { toast } from 'sonner'
import { api, friendly, ApiError } from '@/lib/api'
import { useLang } from '@/i18n'
import { copyText } from '@/lib/clipboard'
import { Button, Input, Field, Card, CardHeader, CardTitle, CardBody, ConfirmDialog, Alert, QRCode, Tip, PageHeader, Loading } from '@/components/ui'
import { fmtDate, fmtDateTime } from '@/lib/utils'

// ReleaseNotes : mini-rendu du markdown des notes de release (format CHANGELOG
// du projet : titres ##, listes à deux niveaux, **gras**). Pas de lib markdown
// complète pour trois constructions — le webui reste sans dépendance lourde.
function ReleaseNotes({ notes }: { notes: string }) {
  const lines = notes.split('\n').filter(l => l.trim() !== '')
  const renderLine = (line: string, key: number) => {
    const bolded = (s: string) => s.split(/\*\*(.+?)\*\*/g).map((part, i) =>
      i % 2 === 1 ? <strong key={i}>{part}</strong> : <span key={i}>{part}</span>)
    const m = line.match(/^(\s*)-\s(.*)$/)
    if (m) {
      const depth = Math.min(m[1].length, 4)
      return (
        <li key={key} className="ml-4 list-disc text-fg-2" style={{ marginLeft: 16 + depth * 8 }}>
          {bolded(m[2])}
        </li>
      )
    }
    if (line.startsWith('## ')) {
      return <p key={key} className="font-semibold text-fg mt-3 first:mt-0">{line.replace(/^##\s+/, '')}</p>
    }
    return <p key={key} className="text-fg-3">{bolded(line)}</p>
  }
  return <div className="text-xs leading-relaxed space-y-1">{lines.map(renderLine)}</div>
}

export default function Settings() {
  const { t, lang } = useLang()
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
  const [updAsk, setUpdAsk] = React.useState(false)
  const [restarting, setRestarting] = React.useState(false)
  const restartTimer = React.useRef<number | null>(null)
  const [ready, setReady] = React.useState(false)
  const [loadErr, setLoadErr] = React.useState(false)

  // 2FA (TOTP) : state serveur + enrôlement en cours (seed affiché UNE fois)
  const [faState, setFaState] = React.useState('none')
  const [faSeed, setFaSeed] = React.useState('')
  const [faUri, setFaUri] = React.useState('')
  const [faConfirm, setFaConfirm] = React.useState('')
  const [faPass, setFaPass] = React.useState('')
  const [faCode, setFaCode] = React.useState('')
  const [faBusy, setFaBusy] = React.useState(false)

  // ---- extension Firefox : token d'accès au coffre (v1.8.0) ----
  const [extTok, setExtTok] = React.useState<any>(null)   // {present, created_at, last_used_at}
  const [extFresh, setExtFresh] = React.useState('')      // token affiché UNE fois après création
  const [extBusy, setExtBusy] = React.useState(false)
  const [extAsk, setExtAsk] = React.useState<'create' | 'revoke' | null>(null)

  // chargement initial : tout l'état arrive en un tour (plus de .catch
  // silencieux par endpoint). Erreur ≠ vide (contrat v1.8.6) : un échec de
  // /admin/settings → bannière danger + réessayer, pas des valeurs muettes.
  const loadAll = async () => {
    setLoadErr(false)
    const [rInfo, rRec, rUpd, rFa, rExt] = await Promise.allSettled([
      api('GET', '/admin/settings'),
      api('GET', '/admin/recovery/status'),
      api('GET', '/admin/update/status?force=1'),
      api('GET', '/admin/2fa/state'),
      api('GET', '/admin/extension/token'),
    ])
    if (rInfo.status === 'fulfilled') setInfo(rInfo.value); else setLoadErr(true)
    if (rRec.status === 'fulfilled') setRecStatus(rRec.value.remaining)
    if (rUpd.status === 'fulfilled') setUpd(rUpd.value)
    if (rFa.status === 'fulfilled') setFaState(rFa.value.state)
    if (rExt.status === 'fulfilled') setExtTok(rExt.value)
    setReady(true)
  }

  React.useEffect(() => {
    loadAll()
    return () => { if (restartTimer.current) window.clearInterval(restartTimer.current) }
  }, [])

  const doExtCreate = async () => {
    if (extBusy) return
    setExtBusy(true)
    try {
      const d = await api('POST', '/admin/extension/token', {})
      setExtFresh(d.token)
      const st = await api('GET', '/admin/extension/token')
      setExtTok(st)
      toast.success(String(t.extCreated))
    } catch (e) { toast.error(friendly(e)) }
    setExtBusy(false)
  }
  const doExtRevoke = async () => {
    if (extBusy) return
    setExtBusy(true)
    try {
      await api('DELETE', '/admin/extension/token')
      setExtFresh(''); setExtTok({ present: false })
      toast.success(String(t.extRevoked))
    } catch (e) { toast.error(friendly(e)) }
    setExtBusy(false)
  }
  // copie via copyText (fallback execCommand en HTTP — cf. lib/clipboard) :
  // plus de navigator.clipboard muet ni de succès toasté sur un échec.
  const extCopy = async (v: string) => {
    if (await copyText(v)) toast.success(String(t.extCopied))
    else toast.error(String(t.copyFailed))
  }

  const faEnroll = async () => {
    if (faBusy) return
    setFaBusy(true)
    try {
      const d = await api('POST', '/admin/2fa/enroll')
      setFaSeed(d.seed); setFaUri(d.uri); setFaConfirm(''); setFaState('pending')
    } catch (e) { toast.error(friendly(e)) }
    setFaBusy(false)
  }

  // J3 : enrôlement sans recopie — QR de l'URI otpauth standard ; le seed et
  // l'URI renvoyés par le serveur restent affichés en secours.
  const faQrUri = `otpauth://totp/Kervia-vault:admin?secret=${faSeed}&issuer=Kervia-vault`

  const faConfirmSubmit = async () => {
    if (faBusy || faConfirm.length !== 6) return
    setFaBusy(true)
    try {
      await api('POST', '/admin/2fa/confirm', { code: faConfirm })
      setFaState('active'); setFaSeed(''); setFaUri(''); setFaConfirm('')
      toast.success(String(t.faActive))
    } catch (e) {
      // 400 = code faux ; 5xx/réseau = le serveur est en cause (J2)
      if (e instanceof ApiError && e.status >= 500) toast.error(friendly(e))
      else toast.error(String(t.faBadCode))
    }
    setFaBusy(false)
  }

  const faDisable = async () => {
    if (faBusy || !faPass || faCode.length !== 6) return
    setFaBusy(true)
    try {
      await api('POST', '/admin/2fa/disable', { password: faPass, code: faCode })
      setFaState('none'); setFaPass(''); setFaCode('')
      toast.success(String(t.faDisabled))
    } catch (e) {
      if (e instanceof ApiError && e.status >= 500) toast.error(friendly(e))
      else toast.error(String(t.loginError))
    }
    setFaBusy(false)
  }

  // copies seed/URI via copyText (fallback HTTP)
  const copy = async (v: string) => {
    if (await copyText(v)) toast.success(String(t.copied))
    else toast.error(String(t.copyFailed))
  }

  // export DR : bundle KVX1 scellé par passphrase — confirmation exigée,
  // une typo rendrait le bundle inutilisable
  const [expPass, setExpPass] = React.useState('')
  const [expPass2, setExpPass2] = React.useState('')
  const [expBusy, setExpBusy] = React.useState(false)
  const downloadExport = async () => {
    if (expBusy || expPass.length < 12 || expPass !== expPass2) return
    setExpBusy(true)
    try {
      const res = await fetch('/admin/export', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passphrase: expPass }),
      })
      // J5 : le corps d'erreur est lu (avant : « HTTP 500 » cru au toast)
      if (!res.ok) {
        let d: any = {}
        try { d = await res.json() } catch { /* corps non-JSON : le statut suffit */ }
        throw new ApiError(res.status, String(d?.error || d?.code || ''), '')
      }
      const blob = await res.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = 'kervia-vault-export-' + new Date().toISOString().slice(0, 10) + '.kvx'
      a.click()
      URL.revokeObjectURL(a.href)
      setExpPass(''); setExpPass2('')
      toast.success(String(t.exportDone))
    } catch (e) { toast.error(friendly(e)) }
    setExpBusy(false)
  }

  // restore : dry-run (inventaire sans écriture) puis import des vaults
  // MANQUANTS seulement — jamais d'écrasement
  const [resFile, setResFile] = React.useState<File | null>(null)
  const [resPass, setResPass] = React.useState('')
  const [resBusy, setResBusy] = React.useState(false)
  const [resReport, setResReport] = React.useState<any | null>(null)
  const [resDone, setResDone] = React.useState<any | null>(null)

  const restorePost = async (dryRun: boolean) => {
    if (resBusy || !resFile || resPass.length < 12) return
    setResBusy(true)
    try {
      const fd = new FormData()
      fd.append('bundle', resFile)
      fd.append('pass', resPass)
      const res = await fetch('/admin/restore' + (dryRun ? '?dry_run=1' : ''), {
        method: 'POST', credentials: 'same-origin', body: fd,
      })
      // réponses non-JSON tolérées (proxy, crash) — avant, res.json() jetait
      // une SyntaxError qui masquait le vrai statut
      let d: any = null
      try { d = await res.json() } catch { /* corps non-JSON */ }
      if (!res.ok) throw new ApiError(res.status, String(d?.error || d?.code || ''), '')
      if (dryRun) { setResReport(d); setResDone(null) }
      else { setResDone(d); setResReport(null); setResFile(null); setResPass('') }
    } catch (e) { toast.error(friendly(e)) }
    setResBusy(false)
  }

  // after an update: poll until the server is BACK, then reload the page
  // automatically — the user never stays stuck on "restarting…".
  //
  // GOTCHA (corrigé en 1.6) : la version n'est PAS révélée par /setup/info
  // une fois l'installation faite (hardening recon v1.0.12) — l'ancienne
  // détection « version === cible » ne matchait jamais. Le signal fiable,
  // c'est la FENÊTRE DOWN : l'apply quitte proprement, systemd met ~3 s à
  // relancer — on sonde toutes les secondes, et la première réponse APRÈS
  // un échec = le nouveau binaire est en ligne.
  const watchRestart = () => {
    const started = Date.now()
    let sawDown = false
    const check = async () => {
      try {
        await fetch('/setup/info', { cache: 'no-store' })
        if (sawDown) {
          window.clearInterval(restartTimer.current!)
          window.location.reload()
        }
      } catch {
        sawDown = true // le serveur est en bas : c'est le restart
      }
      // fallback 15 s : un restart si rapide qu'aucune sonde n'a vu le down —
      // le swap est atomique AVANT l'exit, servir = c'est déjà le nouveau
      if (Date.now() - started > 15000 && restartTimer.current) {
        window.clearInterval(restartTimer.current)
        window.location.reload()
      }
    }
    restartTimer.current = window.setInterval(check, 1000)
  }

  const applyUpdate = async () => {
    if (updBusy) return
    setUpdBusy(true)
    try {
      await api('POST', '/admin/update/apply', {})
      setRestarting(true)
      watchRestart()
    } catch (e) { toast.error(friendly(e)) }
    setUpdBusy(false)
  }

  const checkUpdate = async () => {
    try { setUpd(await api('GET', '/admin/update/status?force=1')) }
    catch (e) { toast.error(friendly(e)) }
  }

  const generateRecovery = async () => {
    if (!recCurrent.trim() || recBusy) return
    setRecBusy(true)
    try {
      const d = await api('POST', '/admin/recovery/generate', { current_password: recCurrent })
      setKit(d); setRecCurrent('')
      setRecStatus((await api('GET', '/admin/recovery/status')).remaining)
    } catch (e) { toast.error(friendly(e)) }
    setRecBusy(false)
  }

  // le kit .txt est bilingue (pattern K du wizard) — avant : FR codé dur
  const RK = {
    fr: {
      title: 'Kervia-vault — KIT DE RÉCUPÉRATION',
      intro: 'Codes de récupération (usage unique) :',
      note: 'Chaque code permet de réinitialiser le mot de passe administrateur sans accès au serveur. Ils ne seront plus jamais affichés.',
    },
    en: {
      title: 'Kervia-vault — RECOVERY KIT',
      intro: 'Recovery codes (single use):',
      note: 'Each code can reset the administrator password without server access. They will never be shown again.',
    },
  }
  const downloadKit = () => {
    if (!kit) return
    const rk = RK[lang] || RK.fr
    const txt = [
      rk.title,
      '================================',
      '',
      rk.intro,
      ...kit.codes.map((c: string, i: number) => `  ${i + 1}. ${c}`),
      '',
      rk.note,
    ].join('\n')
    const blob = new Blob([txt], { type: 'text/plain' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'kervia-vault-recovery-kit.txt'
    a.click()
    URL.revokeObjectURL(a.href)
    toast.success(String(t.kitDownloaded))
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
    } catch (e) { toast.error(friendly(e)) }
    setBusy(false)
  }

  if (!ready) return (
    <div>
      <PageHeader title={String(t.settingsTitle)} sub={String(t.settingsSub)} />
      <Loading label={String(t.loading)} rows={6} />
    </div>
  )

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,36rem)_19rem] gap-6 items-start">
      <div className="min-w-0 w-full">
      <PageHeader title={String(t.settingsTitle)} sub={String(t.settingsSub)} />

      {loadErr && (
        <Alert tone="danger" className="mb-5">
          <div className="flex items-center justify-between gap-3">
            <span>{String(t.loadFailed)}</span>
            <Button size="sm" onClick={loadAll}>{String(t.retry)}</Button>
          </div>
        </Alert>
      )}

      {/* version + mise à jour */}
      <Card className="mb-5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><RefreshCw size={15} aria-hidden="true" /> {String(t.versionTitle)}</CardTitle>
        </CardHeader>
        <CardBody>
          {restarting ? (
            <div className="space-y-2">
              <div className="flex items-center gap-3 text-sm text-accent-fg py-2">
                <LoaderCircle size={18} className="animate-spin" aria-hidden="true" />
                {String(t.updateRestarting)}
              </div>
              <p className="text-2xs text-fg-3">{String(t.updateRestartHint)}</p>
            </div>
          ) : upd ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm">
                <span className="font-mono font-semibold">{upd.current || 'dev'}</span>
                {upd.update_available ? (
                  <span className="flex items-center gap-1.5 text-accent-fg font-medium">
                    <ArrowUpCircle size={14} aria-hidden="true" /> {String(t.updateTo)} <span className="font-mono">{upd.latest}</span>
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-fg-3">
                    <CheckCircle2 size={14} aria-hidden="true" /> {upd.latest ? String(t.upToDate) : String(t.updateCheckFail)}
                  </span>
                )}
              </div>
              {upd.last_error && <p className="text-2xs text-danger">{upd.last_error}</p>}
              {upd.mode === 'docker' && <p className="text-2xs text-warn">{String(t.updateDocker)}</p>}
              {/* ce que la mise à jour apporte — notes de la release (CHANGELOG) */}
              {upd.notes && (
                <details className="group rounded-lg border border-border bg-card-2 px-4 py-2.5">
                  <summary className="text-xs font-semibold cursor-pointer select-none text-fg-2 group-open:text-fg">
                    {String(t.updateWhatsNew)}
                  </summary>
                  <div className="mt-3 max-h-72 overflow-y-auto pr-1">
                    <ReleaseNotes notes={String(upd.notes)} />
                  </div>
                </details>
              )}
              <div className="flex gap-2">
                {upd.update_available && upd.mode !== 'docker' && (
                  <Button variant="primary" onClick={() => setUpdAsk(true)} disabled={updBusy}>
                    {updBusy ? <LoaderCircle size={14} className="animate-spin" aria-hidden="true" /> : <><ArrowUpCircle size={14} aria-hidden="true" /> {String(t.updateBtn)}</>}
                  </Button>
                )}
                <Button onClick={checkUpdate} disabled={updBusy}>
                  <RefreshCw size={14} aria-hidden="true" /> {String(t.updateCheck)}
                </Button>
              </div>
              <p className="text-2xs text-fg-3 leading-relaxed">{String(t.updateHint)}</p>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-fg-3 py-2">
              <LoaderCircle size={15} className="animate-spin" aria-hidden="true" /> {String(t.updateChecking)}
            </div>
          )}
        </CardBody>
      </Card>

      <Card className="mb-5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><KeyRound size={15} aria-hidden="true" /> {String(t.passwordTitle)}</CardTitle>
        </CardHeader>
        <CardBody>
          <form onSubmit={submit}>
            <Field label={String(t.currentPassword)}>
              <Input type="password" value={cur} onChange={e => setCur(e.target.value)} autoComplete="current-password" />
            </Field>
            <Field label={String(t.newPassword)} help={String(t.passwordHelp)}>
              <Input type="password" value={next} onChange={e => setNext(e.target.value)} autoComplete="new-password" />
            </Field>
            <Field label={String(t.confirmPassword)} error={confirm && next !== confirm ? String(t.passwordMismatch) : undefined}>
              <Input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password"
                className={confirm && next !== confirm ? 'border-danger' : ''} />
            </Field>
            <Button variant="primary" type="submit" disabled={!cur || !next || next !== confirm || busy}>
              {busy ? <LoaderCircle size={15} className="animate-spin" aria-hidden="true" /> : String(t.changePasswordBtn)}
            </Button>
          </form>
        </CardBody>
      </Card>

      {/* extension Firefox : remplissage web depuis le coffre (v1.8.0) */}
      <Card className="mb-5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Puzzle size={15} aria-hidden="true" /> {String(t.extTitle)}</CardTitle>
        </CardHeader>
        <CardBody>
          <p className="text-xs text-fg-3 leading-relaxed mb-4">{String(t.extIntro)}</p>
          <ol className="text-xs text-fg-2 space-y-1.5 list-decimal list-inside mb-4">
            <li>{String(t.extStep1)}</li>
            <li>{String(t.extStep2)}</li>
            <li>{String(t.extStep3)}</li>
          </ol>
          {extFresh ? (
            <div className="rounded-lg border border-accent/30 bg-accent/8 p-3 mb-4">
              <p className="text-2xs text-accent-fg font-semibold mb-2">{String(t.extShownOnce)}</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 font-mono text-2xs break-all text-fg">{extFresh}</code>
                <Button variant="secondary" size="sm" onClick={() => extCopy(extFresh)}><Copy size={13} aria-hidden="true" />{String(t.extCopy)}</Button>
              </div>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <a href="/ui/extension-firefox.xpi" download
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-card-2 border border-border text-xs font-medium hover:border-accent transition-colors">
              <Download size={13} aria-hidden="true" /> {String(t.extDownload)}
            </a>
            <Button variant={extTok?.present ? 'secondary' : 'primary'} size="sm"
              onClick={() => extTok?.present ? setExtAsk('create') : doExtCreate()} disabled={extBusy}>
              {extBusy ? <LoaderCircle size={13} className="animate-spin" aria-hidden="true" /> : <KeyRound size={13} aria-hidden="true" />}
              {extTok?.present ? String(t.extReplace) : String(t.extCreate)}
            </Button>
            {extTok?.present && (
              <Button variant="destructive" size="sm" onClick={() => setExtAsk('revoke')} disabled={extBusy}>
                {String(t.extRevoke)}
              </Button>
            )}
          </div>
          {extTok?.present && (
            <p className="text-2xs text-fg-3 mt-3">
              {String(t.extLastUsed)}{'\u00A0: '}{extTok.last_used_at ? fmtDateTime(extTok.last_used_at) : String(t.extNever)}
            </p>
          )}
          <p className="text-2xs text-fg-3 mt-3 leading-relaxed">{String(t.extSecurity)}</p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ShieldCheck size={15} aria-hidden="true" /> {String(t.security)}</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          <div className="flex items-center gap-3 text-sm">
            <Clock size={15} className="text-fg-3" aria-hidden="true" />
            <span className="text-fg-2">{String(t.retention)}</span>
            <span className="font-semibold text-accent-fg">{info?.audit_retention_days ?? 90} {String(t.days)}</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <ShieldCheck size={15} className="text-fg-3" aria-hidden="true" />
            <span className="text-fg-2">{String(t.encryption)}</span>
            <span className="font-semibold">AES-256-GCM</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <KeyRound size={15} className="text-fg-3" aria-hidden="true" />
            <span className="text-fg-2">{String(t.minPassword)}</span>
            <span className="font-semibold">{info?.min_password_length ?? 12} {String(t.chars)}</span>
          </div>
        </CardBody>
      </Card>

      <Card className="mt-5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Smartphone size={15} aria-hidden="true" /> {String(t.faTitle)}</CardTitle>
          <span className={`text-xs font-semibold ${faState === 'active' ? 'text-success' : faState === 'pending' ? 'text-warn' : 'text-fg-3'}`}>
            {faState === 'active' ? String(t.faStateActive) : faState === 'pending' ? String(t.faStatePending) : String(t.faStateNone)}
          </span>
        </CardHeader>
        <CardBody>
          {faState === 'none' && (
            <>
              <p className="text-xs text-fg-2 mb-4">{String(t.faIntro)}</p>
              <Button variant="primary" onClick={faEnroll} disabled={faBusy}>
                {faBusy ? <LoaderCircle size={15} className="animate-spin" aria-hidden="true" /> : <Smartphone size={15} aria-hidden="true" />}
                {String(t.faStart)}
              </Button>
            </>
          )}
          {faState === 'pending' && !faSeed && (
            <>
              <p className="text-xs text-warn mb-4">{String(t.faPending)}</p>
              <Button onClick={faEnroll} disabled={faBusy}>{String(t.faRegenerate)}</Button>
            </>
          )}
          {faState === 'pending' && faSeed && (
            <>
              <p className="text-xs text-fg-2 mb-3">{String(t.faScan)}</p>
              <div className="mb-4"><QRCode data={faQrUri} /></div>
              <p className="text-xs text-fg-2 mb-3">{String(t.faSeedTitle)}</p>
              <div className="flex items-center gap-2 mb-1">
                <code className="flex-1 text-xs font-mono bg-card-2 border border-border rounded-lg px-3 py-2 select-all break-all">{faSeed}</code>
                <Tip label={String(t.copy)}>
                  <Button size="sm" aria-label={String(t.copy)} onClick={() => copy(faSeed)}><Copy size={13} aria-hidden="true" /></Button>
                </Tip>
              </div>
              <div className="flex items-center gap-2 mb-4">
                <Tip label={faUri}>
                  <code className="flex-1 text-2xs font-mono text-fg-3 truncate">{faUri}</code>
                </Tip>
                <Tip label={String(t.copy)}>
                  <Button size="sm" aria-label={String(t.copy)} onClick={() => copy(faUri)}><Copy size={13} aria-hidden="true" /></Button>
                </Tip>
              </div>
              <p className="text-xs text-fg-3 mb-4">{String(t.faSeedOnce)}</p>
              <Field label={String(t.faConfirmTitle)}>
                <Input value={faConfirm} inputMode="numeric" maxLength={6} className="font-mono tracking-[0.25em]"
                  autoComplete="one-time-code"
                  onChange={e => setFaConfirm(e.target.value.replace(/\D/g, ''))} placeholder="123456" />
              </Field>
              <Button variant="primary" onClick={faConfirmSubmit} disabled={faBusy || faConfirm.length !== 6}>
                {String(t.faConfirmBtn)}
              </Button>
            </>
          )}
          {faState === 'active' && (
            <>
              <p className="text-xs text-fg-2 mb-4">{String(t.faActiveNote)}</p>
              <div className="grid grid-cols-2 gap-2">
                <Field label={String(t.currentPassword)}>
                  <Input type="password" value={faPass} onChange={e => setFaPass(e.target.value)} autoComplete="current-password" />
                </Field>
                <Field label={String(t.faCodeLabel)}>
                  <Input value={faCode} inputMode="numeric" maxLength={6} className="font-mono tracking-[0.25em]"
                    autoComplete="one-time-code"
                    onChange={e => setFaCode(e.target.value.replace(/\D/g, ''))} placeholder="123456" />
                </Field>
              </div>
              <Button variant="destructive" onClick={faDisable} disabled={faBusy || !faPass || faCode.length !== 6}>
                {String(t.faDisableBtn)}
              </Button>
            </>
          )}
        </CardBody>
      </Card>

      <Card className="mt-5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><RotateCcw size={15} aria-hidden="true" /> {String(t.recoveryTitle)}</CardTitle>
          <span className="text-xs text-accent-fg font-semibold">{recStatus ?? '—'} {String(t.recoveryRemaining)}</span>
        </CardHeader>
        <CardBody>
          <p className="text-xs text-fg-2 mb-4">{String(t.recoveryWarning)}</p>
          <Field label={String(t.currentPassword)}>
            <Input type="password" value={recCurrent} onChange={e => setRecCurrent(e.target.value)}
              autoComplete="current-password" className="max-w-xs" />
          </Field>
          <Button variant="primary" onClick={generateRecovery} disabled={!recCurrent.trim() || recBusy}>
            {recBusy ? <LoaderCircle size={15} className="animate-spin" aria-hidden="true" /> : <><RotateCcw size={14} aria-hidden="true" /> {String(t.recoveryGen)}</>}
          </Button>

          {kit && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-5 border border-accent/40 rounded-xl p-4 bg-bg"
            >
              <p className="text-xs font-semibold text-accent-fg mb-2">{String(t.recoveryTitle)}</p>
              <div className="font-mono text-sm space-y-1 mb-3">
                {kit.codes.map((c: string, i: number) => (
                  <div key={i}>{String(i + 1).padStart(2, '0')} · {c}</div>
                ))}
              </div>
              <div className="flex gap-2">
                <Button variant="primary" onClick={downloadKit}><Download size={14} aria-hidden="true" /> {String(t.recoveryDownload)}</Button>
                <Button onClick={() => setKit(null)}>{String(t.kitConfirmBtn)}</Button>
              </div>
              {/* le warning « affiché une seule fois » est déjà en tête de
                  carte — ici, l'info utile est l'invalidation des anciens */}
              <Alert tone="warn" className="mt-3">{String(t.kitInvalidate)}</Alert>
            </motion.div>
          )}
        </CardBody>
      </Card>

      <Card className="mt-5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Download size={15} aria-hidden="true" /> {String(t.backupTitle)}</CardTitle>
        </CardHeader>
        <CardBody>
          <p className="text-xs text-fg-2 mb-4">{String(t.backupIntro)}</p>
          <div className="grid grid-cols-2 gap-2">
            <Field label={String(t.backupPass)}>
              <Input type="password" value={expPass} onChange={e => setExpPass(e.target.value)} autoComplete="new-password" />
            </Field>
            <Field label={String(t.backupConfirm)} error={expPass.length > 0 && expPass !== expPass2 ? String(t.backupMismatch) : undefined}>
              <Input type="password" value={expPass2} onChange={e => setExpPass2(e.target.value)} autoComplete="new-password"
                className={expPass.length > 0 && expPass !== expPass2 ? 'border-danger' : ''} />
            </Field>
          </div>
          <Button variant="primary" onClick={downloadExport} disabled={expBusy || expPass.length < 12 || expPass !== expPass2}>
            {expBusy ? <LoaderCircle size={15} className="animate-spin" aria-hidden="true" /> : <Download size={15} aria-hidden="true" />}
            {String(t.backupBtn)}
          </Button>
          <p className="text-2xs text-fg-3 mt-3">{String(t.backupRestore)}</p>

          <div className="mt-5 pt-5 border-t border-border">
            <p className="text-xs font-semibold text-fg-2 mb-3">{String(t.restoreTitle)}</p>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <Field label={String(t.restoreFile)}>
                <input
                  type="file" accept=".kvx"
                  onChange={e => { setResFile(e.target.files?.[0] || null); setResReport(null); setResDone(null) }}
                  className="block w-full text-xs text-fg-3 file:mr-2 file:cursor-pointer file:rounded-lg file:border-0 file:bg-card-2 file:px-3 file:py-1.5 file:text-xs file:text-fg-2 hover:file:text-fg cursor-pointer"
                />
              </Field>
              <Field label={String(t.backupPass)}>
                <Input type="password" value={resPass} onChange={e => setResPass(e.target.value)} autoComplete="current-password" />
              </Field>
            </div>
            <Button onClick={() => restorePost(true)} disabled={resBusy || !resFile || resPass.length < 12}>
              {resBusy ? <LoaderCircle size={15} className="animate-spin" aria-hidden="true" /> : <ShieldCheck size={15} aria-hidden="true" />}
              {String(t.restoreVerifyBtn)}
            </Button>
            {resReport && (
              <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="mt-3">
                <p className="text-2xs text-fg-3 mb-2">{String(t.restoreExported)} {fmtDateTime(resReport.exported_at)}{'\u00A0:'}</p>
                <div className="space-y-1 mb-3">
                  {resReport.vaults.map((v: any, i: number) => (
                    <div key={i} className="flex items-center justify-between text-xs bg-card-2 border border-border rounded-lg px-3 py-2">
                      <span className="font-semibold">{v.name} · {v.secrets} {String(t.restoreSecrets)}</span>
                      <span className={v.status === 'skipped' ? 'text-warn font-semibold' : 'text-accent-fg font-semibold'}>
                        {v.status === 'skipped' ? String(t.restoreSkipped) : String(t.restoreWillImport)}
                      </span>
                    </div>
                  ))}
                </div>
                <Button variant="primary" onClick={() => restorePost(false)} disabled={resBusy}>
                  {String(t.restoreImportBtn)}
                </Button>
              </motion.div>
            )}
            {resDone && (
              <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="mt-3 text-xs text-accent-fg font-semibold">
                {String(t.restoreDone)}{'\u00A0: '}{resDone.imported_vaults} {String(t.restoreVaultsWord)}, {resDone.imported_secrets} {String(t.restoreSecrets)}
              </motion.div>
            )}
          </div>
        </CardBody>
      </Card>
      </div>

      {/* panneau journal des versions — à droite sur grand écran
          (le contenu est dupliqué dans le <details> des notes de release,
          dont le <summary> porte le texte accessible t.updateWhatsNew) */}
      {upd?.recent?.length > 0 && (
        <aside className="hidden lg:block">
          <Card className="sticky top-8">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><History size={15} aria-hidden="true" /> {String(t.changelogTitle)}</CardTitle>
            </CardHeader>
            <CardBody className="max-h-[calc(100vh-8rem)] overflow-y-auto">
              {upd.recent.map((rel: any, i: number) => (
                <div key={i} className={i > 0 ? 'pt-4 mt-4 border-t border-border' : ''}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-mono text-xs font-semibold text-accent-fg">{rel.tag}</span>
                    <span className="text-2xs text-fg-3">{rel.date ? fmtDate(rel.date) : ''}</span>
                    {i === 0 && upd.update_available && rel.tag === upd.latest && (
                      <span className="ml-auto flex items-center gap-1 text-2xs font-bold text-accent-fg">
                        <ArrowUpCircle size={11} aria-hidden="true" /> {String(t.updateBadge)}
                      </span>
                    )}
                  </div>
                  <ReleaseNotes notes={String(rel.notes || '')} />
                </div>
              ))}
            </CardBody>
          </Card>
        </aside>
      )}

      {/* J1 : l'apply redémarre le service — confirmation écrite avant le geste */}
      <ConfirmDialog
        open={updAsk}
        onOpenChange={setUpdAsk}
        title={String(t.updateBtn)}
        message={String(t.updateConfirm)}
        confirmLabel={String(t.updateBtn)}
        tone="default"
        onConfirm={applyUpdate}
      />

      {/* extension : régénération/révocation du token — rituel ConfirmDialog */}
      <ConfirmDialog
        open={extAsk !== null}
        onOpenChange={o => { if (!o) setExtAsk(null) }}
        title={String(extAsk === 'create' ? t.extReplace : t.extRevoke)}
        message={String(extAsk === 'create' ? t.extReplaceConfirm : t.extRevokeConfirm)}
        confirmLabel={String(extAsk === 'create' ? t.extReplace : t.extRevoke)}
        onConfirm={async () => {
          if (extAsk === 'create') await doExtCreate()
          else if (extAsk === 'revoke') await doExtRevoke()
        }}
      />
    </div>
  )
}
