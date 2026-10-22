// Coffre v2 — dialogs secondaires : générateur, import multi-format,
// export multi-format, réglages.
import * as React from 'react'
import { toast } from 'sonner'
import {
  Wand2, Copy, LoaderCircle, Download, Upload, X, KeyRound, Trash2,
  AlertTriangle, ShieldCheck,
} from 'lucide-react'
import { useLang } from '@/i18n'
import { api } from '@/lib/api'
import { Button, Dialog, DialogContent, Input, PasswordInput, Field, Label } from '@/components/ui'
import { cn } from '@/lib/utils'
import * as C from '@/lib/coffre'
import { detectAndParse, itemsToBitwarden, itemsToKervia, type DetectedImport } from '@/lib/coffre-import'
import type { CoffreEnvelope } from '@/lib/coffre'
import type { DecryptedItem } from '@/lib/coffre-schema'

// ================= générateur =================

export function GeneratorDialog({ onClose }: { onClose: () => void }) {
  const { t } = useLang()
  const copy = (v: string) => {
    navigator.clipboard.writeText(v).catch(() => {})
    toast.success(String(t.cofCopied), { description: String(t.cofAutoClear) })
  }
  const [mode, setMode] = React.useState<'chars' | 'phrase'>('chars')
  const [len, setLen] = React.useState(20)
  const [opt, setOpt] = React.useState({ upper: true, lower: true, digits: true, symbols: true })
  const [words, setWords] = React.useState(4)
  const [value, setValue] = React.useState('')

  const regen = React.useCallback(() => {
    setValue(mode === 'chars'
      ? C.generatePassword({ length: len, ...opt })
      : C.generatePassphrase(words))
  }, [mode, len, opt, words])
  React.useEffect(() => { regen() }, [regen])

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent title={t.cofGenTitle}>
        <div className="grid grid-cols-2 gap-2 mb-4">
          {(['chars', 'phrase'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)}
              className={cn('h-9 rounded-lg border text-xs font-medium transition-colors cursor-pointer',
                mode === m ? 'border-accent bg-accent/12 text-accent' : 'border-border text-fg-2 hover:bg-card-2')}>
              {m === 'chars' ? t.cofGenChars : t.cofGenPassphrase}
            </button>
          ))}
        </div>
        <div className="rounded-lg bg-card-2 border border-border p-4 text-center">
          <p className="font-mono text-sm break-all select-all">{value}</p>
          <div className="mt-2 flex justify-center"><CStrength value={value} /></div>
        </div>
        {mode === 'chars' ? (
          <div className="mt-4 space-y-3">
            <Field label={`${t.cofGenLen} : ${len}`}>
              <input type="range" min={8} max={64} value={len} onChange={e => setLen(Number(e.target.value))} className="w-full accent-[var(--color-accent)]" />
            </Field>
            <div className="flex gap-2 flex-wrap">
              {([['upper', 'A-Z'], ['lower', 'a-z'], ['digits', '0-9'], ['symbols', t.cofGenSymbols]] as const).map(([k, lbl]) => (
                <button key={k} onClick={() => setOpt(o => ({ ...o, [k]: !(o as any)[k] }))}
                  className={cn('h-8 px-3 rounded-lg border text-xs transition-colors cursor-pointer',
                    (opt as any)[k] ? 'border-accent bg-accent/12 text-accent' : 'border-border text-fg-3 hover:bg-card-2')}>
                  {lbl}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mt-4">
            <Field label={`${t.cofGenWords} : ${words}`}>
              <input type="range" min={3} max={8} value={words} onChange={e => setWords(Number(e.target.value))} className="w-full accent-[var(--color-accent)]" />
            </Field>
          </div>
        )}
        <div className="flex justify-between mt-5">
          <Button variant="ghost" onClick={regen}><Wand2 size={14} />{t.cofGenRegen}</Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>{t.cofCancel}</Button>
            <Button variant="primary" onClick={() => { copy(value); onClose() }}><Copy size={14} />{t.cofGenCopy}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function CStrength({ value }: { value: string }) {
  const { t } = useLang()
  const st = C.passwordStrength(value)
  const colors: Record<string, string> = {
    weak: 'bg-danger', fair: 'bg-warn', good: 'bg-accent', strong: 'bg-accent', excellent: 'bg-accent',
  }
  const labels: Record<string, string> = {
    weak: t.cofWeak, fair: t.cofFair, good: t.cofGood, strong: t.cofStrong, excellent: t.cofExcellent,
  }
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 rounded-full bg-muted overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', colors[st.label])} style={{ width: `${Math.min(100, st.bits)}%` }} />
      </div>
      <span className="text-[11px] text-fg-3">{labels[st.label]} · {st.bits} bits</span>
    </div>
  )
}

// ================= import multi-format =================

const FMT_LABEL: Record<DetectedImport['format'], string> = {
  bitwarden: 'Bitwarden / Vaultwarden (JSON)',
  csv: 'CSV (Chrome, Firefox, Safari, LastPass, KeePass…)',
  '1pux': '1Password (export .1pux)',
  '1pif': '1Password (1PIF, 1Password 7)',
  kervia: 'Kervia (sauvegarde complète)',
}

export function ImportDialog({ onClose, onImported }: { onClose: () => void; onImported: () => Promise<void> }) {
  const { t } = useLang()
  const [parsed, setParsed] = React.useState<DetectedImport | null>(null)
  const [fname, setFname] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  const pick = async (f: File) => {
    try {
      const bytes = new Uint8Array(await f.arrayBuffer())
      const det = await detectAndParse(bytes, f.name)
      if (det.skippedEncrypted) { toast.error(String(t.cofImportEncrypted)); return }
      if (det.items.length === 0) { toast.error(String(t.cofImportBad)); return }
      setParsed(det)
      setFname(f.name)
    } catch { toast.error(String(t.cofImportBad)) }
  }

  const run = async () => {
    if (!parsed || busy) return
    setBusy(true)
    try {
      // chiffre chaque item localement puis envoie en lots de 500 max
      for (let i = 0; i < parsed.items.length; i += 500) {
        const chunk = parsed.items.slice(i, i + 500)
        const blobs: { blob_b64: string }[] = []
        for (const it of chunk) blobs.push({ blob_b64: await C.encryptItem(it) })
        await api('POST', '/admin/coffre/items/batch', { items: blobs })
      }
      toast.success(String(t.cofImportDone).replace('{n}', String(parsed.items.length)))
      await onImported()
      onClose()
    } catch (e: any) { toast.error(e.message) }
    setBusy(false)
  }

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent title={t.cofImportTitle} className="max-w-md">
        <p className="text-xs text-fg-3 leading-relaxed mb-4">{t.cofImportHint}</p>
        <label className="block border border-dashed border-border rounded-xl p-8 text-center cursor-pointer hover:bg-card-2/50 transition-colors">
          <input type="file" accept=".json,.csv,.1pux,.1pif,.txt" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) void pick(f) }} />
          <Upload size={20} className="mx-auto text-fg-3 mb-2" />
          <span className="text-sm text-fg-2">{fname || t.cofImportPick}</span>
        </label>
        {parsed && (
          <div className="mt-4 space-y-2">
            <div className="rounded-lg bg-accent/8 border border-accent/25 p-3 text-sm text-accent flex items-center gap-2">
              <ShieldCheck size={14} /> {String(t.cofImportCount).replace('{n}', String(parsed.items.length))}
            </div>
            <div className="text-xs text-fg-3">{t.cofImportDetected} : <span className="text-fg-2 font-medium">{FMT_LABEL[parsed.format]}</span></div>
          </div>
        )}
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="ghost" onClick={onClose}>{t.cofCancel}</Button>
          <Button variant="primary" disabled={!parsed || busy} onClick={run}>
            {busy ? <LoaderCircle className="animate-spin" /> : null} {t.cofImportBtn}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ================= export multi-format =================

export function ExportDialog({ items, onClose }: { items: DecryptedItem[]; onClose: () => void }) {
  const { t } = useLang()
  const [confirm, setConfirm] = React.useState('')
  const [fmt, setFmt] = React.useState<'kervia' | 'bitwarden'>('kervia')

  const exportNow = () => {
    const data = fmt === 'kervia' ? itemsToKervia(items) : JSON.stringify(itemsToBitwarden(items), null, 2)
    const blob = new Blob([data], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `kervia-coffre-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(a.href)
    toast.success(String(t.cofExportDone))
    onClose()
  }

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent title={t.cofExportTitle} className="max-w-md">
        <div className="flex gap-2 text-xs text-fg-3 my-4 rounded-lg bg-card-2 border border-border p-3">
          <AlertTriangle size={14} className="text-warn shrink-0 mt-0.5" />
          <span className="leading-relaxed">{t.cofExportWarning}</span>
        </div>
        <Label className="mb-2 block">{t.cofExportFmt}</Label>
        <div className="space-y-2">
          {([['kervia', t.cofExportKervia], ['bitwarden', t.cofExportBitwarden]] as const).map(([k, lbl]) => (
            <button key={k} onClick={() => setFmt(k)}
              className={cn('w-full text-left rounded-lg border p-3 text-xs leading-relaxed transition-colors cursor-pointer',
                fmt === k ? 'border-accent bg-accent/8 text-fg' : 'border-border text-fg-2 hover:bg-card-2')}>
              <span className="flex items-center gap-2 font-medium">
                <span className={cn('w-2.5 h-2.5 rounded-full', fmt === k ? 'bg-accent' : 'bg-muted')} />
                {String(lbl)}
              </span>
            </button>
          ))}
        </div>
        <Field label={t.cofExportType} className="mt-4">
          <Input value={confirm} onChange={e => setConfirm(e.target.value.toUpperCase())} placeholder="EXPORT" />
        </Field>
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="ghost" onClick={onClose}>{t.cofCancel}</Button>
          <Button variant="destructive" disabled={confirm !== 'EXPORT'} onClick={exportNow}>
            <Download size={14} /> {t.cofExportBtn}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ================= réglages =================

export function SettingsDialog({ header, autoLockMin, setAutoLockMin, onRekeyed, onDestroyed, onClose }: {
  header: CoffreEnvelope | null
  autoLockMin: number; setAutoLockMin: (n: number) => void
  onRekeyed: (env: CoffreEnvelope) => Promise<void>
  onDestroyed: () => void
  onClose: () => void
}) {
  const { t } = useLang()
  const [cur, setCur] = React.useState('')
  const [npw, setNpw] = React.useState('')
  const [npw2, setNpw2] = React.useState('')
  const [pwBusy, setPwBusy] = React.useState(false)
  const [destroy, setDestroy] = React.useState('')
  const [dBusy, setDBusy] = React.useState(false)

  const changePw = async () => {
    if (pwBusy) return
    if (npw.length < 12) { toast.error(String(t.cofPwTooShort)); return }
    if (npw !== npw2) { toast.error(String(t.cofSetupMismatch)); return }
    setPwBusy(true)
    try {
      // vérifie le mot de passe ACTUEL en re-déverrouillant — le serveur
      // ne peut rien vérifier (zero-knowledge), c'est local ou jamais
      if (!header) throw new Error('no header')
      await C.unlockCoffre(header, cur) // throw wrong_password si faux
      const env = await C.rekeyCoffre(npw)
      await api('POST', '/admin/coffre/rekey', env)
      await onRekeyed(env)
      setCur(''); setNpw(''); setNpw2('')
    } catch (e: any) {
      toast.error(e.message === 'wrong_password' ? String(t.cofChangePwWrong) : e.message)
    }
    setPwBusy(false)
  }

  const destroyNow = async () => {
    if (dBusy || destroy !== 'DESTROY') return
    setDBusy(true)
    try {
      await api('DELETE', '/admin/coffre', { confirm: 'DESTROY' })
      onDestroyed()
    } catch (e: any) { toast.error(e.message) }
    setDBusy(false)
  }

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent title={t.cofSettings} className="max-w-md">
        <div className="max-h-[65vh] overflow-auto pr-1 space-y-6">
          <div>
            <Label className="mb-2 block">{t.cofAutolock}</Label>
            <div className="flex gap-2">
              {[1, 5, 15, 60, 0].map(m => (
                <button key={m} onClick={() => { setAutoLockMin(m); localStorage.setItem('kerviavault-coffre-autolock', String(m)) }}
                  className={cn('h-8 px-3 rounded-lg border text-xs transition-colors cursor-pointer',
                    autoLockMin === m ? 'border-accent bg-accent/12 text-accent font-semibold' : 'border-border text-fg-2 hover:bg-card-2')}>
                  {m === 0 ? t.cofAutolockOff : `${m} min`}
                </button>
              ))}
            </div>
          </div>
          <div className="border-t border-border pt-5">
            <Label className="mb-2 block">{t.cofChangePw}</Label>
            <Field label={t.cofCurPw}><PasswordInput value={cur} onChange={e => setCur(e.target.value)} /></Field>
            <Field label={t.cofNewPw} className="mt-3"><PasswordInput value={npw} onChange={e => setNpw(e.target.value)} autoComplete="new-password" /></Field>
            <Field label={t.cofNewPw2} className="mt-3"><PasswordInput value={npw2} onChange={e => setNpw2(e.target.value)} /></Field>
            <Button variant="secondary" className="mt-4" disabled={pwBusy || !cur || !npw} onClick={changePw}>
              {pwBusy ? <LoaderCircle className="animate-spin" /> : <KeyRound size={14} />} {t.cofChangePwBtn}
            </Button>
          </div>
          <div className="border-t border-danger/20 pt-5">
            <Label className="mb-2 block text-danger">{t.cofDestroyTitle}</Label>
            <div className="flex gap-2 text-xs text-fg-3 rounded-lg bg-card-2 border border-danger/20 p-3">
              <AlertTriangle size={14} className="text-danger shrink-0 mt-0.5" />
              <span className="leading-relaxed">{t.cofDestroyWarning}</span>
            </div>
            <Field label={t.cofDestroyType} className="mt-3">
              <Input value={destroy} onChange={e => setDestroy(e.target.value.toUpperCase())} placeholder="DESTROY" />
            </Field>
            <Button variant="destructive" className="mt-3" disabled={destroy !== 'DESTROY' || dBusy} onClick={destroyNow}>
              {dBusy ? <LoaderCircle className="animate-spin" /> : <Trash2 size={14} />} {t.cofDestroyBtn}
            </Button>
          </div>
        </div>
        <div className="flex justify-end mt-5">
          <Button variant="ghost" onClick={onClose}><X size={14} />{t.cofClose}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}