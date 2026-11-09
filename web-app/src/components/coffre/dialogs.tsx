// Coffre v2 — dialogs secondaires : générateur, import multi-format
// (+ sauvegarde chiffrée KVCS1, détection de doublons), export
// multi-format (+ scellé .kvc), réglages.
import * as React from 'react'
import { toast } from 'sonner'
import {
  Wand2, Copy, LoaderCircle, Download, Upload, X, KeyRound, Trash2,
  ShieldCheck,
} from 'lucide-react'
import { useLang } from '@/i18n'
import { api, friendly } from '@/lib/api'
import { Button, Badge, Dialog, DialogContent, Input, PasswordInput, Field, Label, Alert, SegmentedControl } from '@/components/ui'
import { cn } from '@/lib/utils'
import * as C from '@/lib/coffre'
import { detectAndParse, findDuplicates, itemsToBitwarden, itemsToKervia, type DetectedImport } from '@/lib/coffre-import'
import { sealVault } from '@/lib/coffre-seal'
// lib pièces jointes (agent 3, contrat §4) : bundles export/import KVCS1
// + relais de la coffreKey (registre mémoire rempli par l'hôte au
// déverrouillage — la clé vit en privé dans lib/coffre.ts, jamais
// persistée ; c'est le canal prévu pour l'UI).
import { attachExportBundle, attachImportBundle, getCoffreKeyForAttachments } from '@/lib/coffre-attachments'
import type { CoffreEnvelope } from '@/lib/coffre'
import type { DecryptedItem } from '@/lib/coffre-schema'
import { useCopy } from './parts'

// ================= générateur =================

export function GeneratorDialog({ onClose }: { onClose: () => void }) {
  const { t } = useLang()
  const copy = useCopy() // copie fiable (HTTP inclus) + effacement auto 30 s réellement planifié
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
        <SegmentedControl
          className="w-full mb-4"
          ariaLabel={String(t.cofGenTitle)}
          value={mode}
          onChange={setMode}
          options={[
            { value: 'chars' as const, label: String(t.cofGenChars) },
            { value: 'phrase' as const, label: String(t.cofGenPassphrase) },
          ]}
        />
        <div className="rounded-lg bg-card-2 border border-border p-4 text-center">
          <p className="font-mono text-sm break-all select-all">{value}</p>
          <div className="mt-2 flex justify-center"><CStrength value={value} /></div>
        </div>
        {mode === 'chars' ? (
          <div className="mt-4 space-y-3">
            <Field label={`${t.cofGenLen} : ${len}`}>
              <input type="range" min={8} max={64} value={len} onChange={e => setLen(Number(e.target.value))} className="w-full accent-[var(--color-accent)]" />
            </Field>
            {/* jeux de caractères : toggles INDÉPENDANTS (non exclusifs) —
                SegmentedControl est réservé aux choix exclusifs (contrat
                FOUNDATION §3) ; ici chaque chip porte son état aria-pressed */}
            <div className="flex gap-2 flex-wrap">
              {([['upper', 'A-Z'], ['lower', 'a-z'], ['digits', '0-9'], ['symbols', t.cofGenSymbols]] as const).map(([k, lbl]) => (
                <button key={k} onClick={() => setOpt(o => ({ ...o, [k]: !(o as any)[k] }))} aria-pressed={!!(opt as any)[k]}
                  aria-label={String(lbl)}
                  className={cn('h-8 px-3 rounded-lg border text-xs transition-colors cursor-pointer',
                    (opt as any)[k] ? 'border-accent bg-accent/12 text-accent-fg' : 'border-border text-fg-3 hover:bg-card-2')}>
                  {String(lbl)}
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
          <Button variant="ghost" onClick={regen}><Wand2 size={14} aria-hidden="true" />{t.cofGenRegen}</Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>{t.cofCancel}</Button>
            <Button variant="primary" onClick={() => { copy(value); onClose() }}><Copy size={14} aria-hidden="true" />{t.cofGenCopy}</Button>
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
      <span className="text-2xs text-fg-3">{labels[st.label]} · {st.bits} bits</span>
    </div>
  )
}

// ================= import multi-format =================

// Libellés des formats détectés — localisés via les clés d'export (elles
// existent déjà, avant : texte FR codé en dur quel que soit la langue).
// « 1Password (.1pux) / (1PIF) » : nom propre + extension de fichier,
// identiques en FR et EN.
function fmtLabel(f: DetectedImport['format'], t: any): string {
  switch (f) {
    case 'kervia': return String(t.cofExportKervia)
    case 'kervia-sealed': return String(t.cofSealExport)
    case 'bitwarden': return String(t.cofExportBitwarden)
    case 'csv': return String(t.cofExportCsv)
    case '1pux': return '1Password (.1pux)'
    default: return '1Password (1PIF)'
  }
}

export function ImportDialog({ onClose, onImported }: { onClose: () => void; onImported: () => Promise<void> }) {
  const { t } = useLang()
  const [parsed, setParsed] = React.useState<DetectedImport | null>(null)
  const [fname, setFname] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  // K6 : progression du (re)chiffrement par lots — avant : spinner muet
  // pendant de longues secondes sur un gros import.
  const [progress, setProgress] = React.useState<{ done: number; total: number } | null>(null)
  // v1.9.0 — scellé KVCS1 en attente de passphrase + doublons détectés
  const [pending, setPending] = React.useState<{ bytes: Uint8Array; name: string } | null>(null)
  const [pass, setPass] = React.useState('')
  const [dups, setDups] = React.useState<{ dup: number[]; fresh: number[] } | null>(null)
  const [dupMode, setDupMode] = React.useState<'skip' | 'all'>('skip')

  // items actuels du coffre, déchiffrés localement pour le dedupe. La
  // corbeille ne compte pas : un item supprimé n'est pas un « existant ».
  const loadExisting = async (): Promise<any[]> => {
    const raw: any[] = await api('GET', '/admin/coffre/items')
    const out: any[] = []
    for (const it of raw) {
      if (it.deleted_at) continue
      try { out.push(await C.decryptItem(it.blob_b64)) } catch { /* blob illisible : ignoré */ }
    }
    return out
  }

  const pick = async (f: File) => {
    const bytes = new Uint8Array(await f.arrayBuffer())
    try {
      const det = await detectAndParse(bytes, f.name)
      if (det.skippedEncrypted) { toast.error(String(t.cofImportEncrypted)); return }
      if (det.items.length === 0) { toast.error(String(t.cofImportBad)); return }
      setDups(findDuplicates(det.items, await loadExisting()))
      setDupMode('skip')
      setParsed(det)
      setFname(f.name)
      setPending(null); setPass('')
    } catch (e: any) {
      // KVCS1 sans passphrase : pas une erreur — le dialog passe en
      // mode « passphrase requise » (champ + badge), le contenu du
      // fichier reste scellé.
      if (e?.message === 'needs_passphrase') {
        setPending({ bytes, name: f.name }); setPass(''); setParsed(null); setDups(null)
        return
      }
      toast.error(String(t.cofImportBad))
    }
  }

  const run = async () => {
    if (busy) return
    // KVCS1 : premier clic = désceller. Le vrai import attend le clic
    // suivant — les doublons éventuels doivent s'afficher AVANT, avec
    // leur choix, sinon « ignorer les doublons » serait un leurre.
    if (!parsed) {
      if (!pending || !pass) return
      setBusy(true)
      try {
        const det = await detectAndParse(pending.bytes, pending.name, pass)
        if (det.items.length === 0) { toast.error(String(t.cofImportBad)); setBusy(false); return }
        setDups(findDuplicates(det.items, await loadExisting()))
        setDupMode('skip')
        setParsed(det)
        setFname(pending.name)
      } catch (e: any) {
        toast.error(e?.message === 'bad_passphrase' ? String(t.cofSealImportBad) : String(t.cofImportBad))
      }
      setBusy(false)
      return
    }
    setBusy(true)
    // dedupe : « ignorer » (défaut) → seuls les items frais partent
    const idxs = dups && dupMode === 'skip' ? dups.fresh : parsed.items.map((_, i) => i)
    const total = idxs.length
    const skipped = parsed.items.length - total
    setProgress({ done: 0, total })
    let done = 0
    try {
      // (a) items sans pièces jointes → batch existant (500 max)
      const plain = idxs.filter(i => !(parsed.attachments?.[i]?.length))
      for (let i = 0; i < plain.length; i += 500) {
        const chunk = plain.slice(i, i + 500)
        const blobs: { blob_b64: string }[] = []
        for (const k of chunk) blobs.push({ blob_b64: await C.encryptItem(parsed.items[k]) })
        await api('POST', '/admin/coffre/items/batch', { items: blobs })
        done = Math.min(done + chunk.length, total)
        setProgress({ done, total })
      }
      // (b) items AVEC pièces jointes → création unitaire (le batch ne
      // renvoie pas les ids, l'upload en a besoin) puis upload chiffré
      const withFiles = idxs.filter(i => !!(parsed.attachments?.[i]?.length))
      if (withFiles.length > 0) {
        const key = getCoffreKeyForAttachments()
        if (!key) throw new Error('locked')
        let attachFail = false
        for (const i of withFiles) {
          const rec: any = await api('POST', '/admin/coffre/items', { blob_b64: await C.encryptItem(parsed.items[i]) })
          // échec d'UNE pièce ≠ échec de l'import : l'item existe déjà,
          // on continue — mais on le dit à la fin, sans le déguiser
          try {
            const n = await attachImportBundle(key, rec.id, parsed.attachments![i])
            if (n < parsed.attachments![i].length) attachFail = true
          } catch { attachFail = true }
          done++
          setProgress({ done, total })
        }
        if (attachFail) toast.error(String(t.cofAttachFailed))
      }
      if (skipped > 0) toast.success(String(t.cofDupImported(total, skipped)))
      else toast.success(String(t.cofImportDone(total)))
      await onImported()
      onClose()
    } catch (e) { toast.error(friendly(e)) }
    setBusy(false)
  }

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent title={t.cofImportTitle} className="max-w-md">
        <p className="text-xs text-fg-3 leading-relaxed mb-4">{t.cofImportHint}</p>
        <label className="block border border-dashed border-border rounded-xl p-8 text-center cursor-pointer hover:bg-card-2/50 transition-colors">
          <input type="file" accept=".json,.csv,.1pux,.1pif,.txt,.kvc" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) void pick(f) }} />
          <Upload size={20} aria-hidden="true" className="mx-auto text-fg-3 mb-2" />
          <span className="text-sm text-fg-2">{fname || t.cofImportPick}</span>
        </label>
        {pending && !parsed && (
          <div className="mt-4">
            <div className="mb-3">
              <Badge variant="ok"><ShieldCheck size={12} aria-hidden="true" />{String(t.cofSealImportOk)}</Badge>
            </div>
            <Field label={t.cofSealImportPass}>
              <PasswordInput value={pass} onChange={e => setPass(e.target.value)} autoComplete="off"
                onKeyDown={e => { if (e.key === 'Enter') void run() }} />
            </Field>
          </div>
        )}
        {parsed && (
          <div className="mt-4 space-y-2">
            <div className="rounded-lg bg-accent/8 border border-accent/25 p-3 text-sm text-accent-fg flex items-center gap-2">
              <ShieldCheck size={14} aria-hidden="true" /> {String(t.cofImportCount(parsed.items.length))}
            </div>
            <div className="text-xs text-fg-3">{t.cofImportDetected} : <span className="text-fg-2 font-medium">{fmtLabel(parsed.format, t)}</span></div>
          </div>
        )}
        {parsed && dups && dups.dup.length > 0 && (
          <div className="mt-3 space-y-2">
            <Alert tone="warn">
              <p className="font-semibold mb-0.5">{String(t.cofDupDetected(dups.dup.length))}</p>
              {String(t.cofDupHint)}
            </Alert>
            <SegmentedControl
              className="w-full"
              ariaLabel={String(t.cofDupDetected(dups.dup.length))}
              value={dupMode}
              onChange={setDupMode}
              options={[
                { value: 'skip' as const, label: String(t.cofDupSkip) },
                { value: 'all' as const, label: String(t.cofDupAll) },
              ]}
            />
          </div>
        )}
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="ghost" onClick={onClose}>{t.cofCancel}</Button>
          <Button variant="primary" disabled={busy || (!parsed && (!pending || !pass))} onClick={run}>
            {busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null} {t.cofImportBtn}
          </Button>
        </div>
        {busy && progress && (
          <p className="text-xs text-fg-3 mt-3 text-center" role="status">
            {String(t.cofImportProgress(progress.done, progress.total))}
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ================= export multi-format =================

export function ExportDialog({ items, onClose }: { items: DecryptedItem[]; onClose: () => void }) {
  const { t } = useLang()
  const [confirm, setConfirm] = React.useState('')
  const [fmt, setFmt] = React.useState<'kervia' | 'bitwarden'>('kervia')
  // v1.9.0 — carte « sauvegarde chiffrée » : passphrase propre au
  // fichier .kvc (indépendante du mot de passe maître). Elle ne vit que
  // dans cet état local — jamais persistée, effacée à la fermeture.
  const [sPass, setSPass] = React.useState('')
  const [sPass2, setSPass2] = React.useState('')
  const [sBusy, setSBusy] = React.useState(false)

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

  // sealNow : scelle items v2 déchiffrés (reçus par props — le coffre
  // est déverrouillé, l'état vit dans la page) + pièces jointes
  // DÉCHIFFRÉES, puis télécharge le .kvc. Item sans pièces jointes →
  // attachments: null ; pièce illisible → l'export ÉCHOUE (un scellé
  // amputé en silence serait un faux sentiment de sécurité).
  const sealNow = async () => {
    if (sBusy || sPass.length < 12 || sPass !== sPass2) return
    setSBusy(true)
    try {
      // relais de la coffreKey (registre mémoire de la lib pièces
      // jointes, rempli par l'hôte au déverrouillage). Sans clé, PAS de
      // scellé silencieusement amputé : la carte promet « éléments et
      // pièces jointes » — on refuse plutôt que de mentir.
      const key = getCoffreKeyForAttachments()
      if (!key) throw new Error('locked')
      const entries: any[] = []
      for (const it of items) {
        // sans pièces jointes → bundle vide → null. Une pièce illisible
        // fait JETER par la lib (agent 3 : « un backup doit être
        // complet, pas silencieusement partiel ») — l'export échoue
        // avec un toast plutôt que d'amputer le scellé en silence.
        const files = await attachExportBundle(key, it.id)
        const attachments = files.length > 0 ? files : null
        // l'objet v2 du blob SANS id (champs serveur et index de
        // recherche retirés) — le .kvc ne doit rien révéler du coffre
        // au-delà de son contenu
        const { id, version, created_at, updated_at, deleted_at, _search, _broken, ...data } = it
        entries.push({ ...data, attachments })
      }
      const kvc = await sealVault(sPass, { v: 1, exported_at: new Date().toISOString(), items: entries })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(new Blob([kvc], { type: 'application/json' }))
      a.download = `kervia-coffre-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.kvc`
      a.click()
      URL.revokeObjectURL(a.href)
      toast.success(String(t.cofSealDone))
      onClose()
    } catch (e) { toast.error(friendly(e)) }
    setSBusy(false)
  }

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent title={t.cofExportTitle} className="max-w-md">
        <Alert tone="warn" className="my-4">{t.cofExportWarning}</Alert>
        <Label className="mb-2 block">{t.cofExportFmt}</Label>
        <SegmentedControl
          className="w-full"
          ariaLabel={String(t.cofExportFmt)}
          value={fmt}
          onChange={setFmt}
          options={[
            { value: 'kervia' as const, label: String(t.cofExportKervia) },
            { value: 'bitwarden' as const, label: String(t.cofExportBitwarden) },
          ]}
        />
        {/* type-to-confirm conservé (mécanisme validé par l'audit) :
            l'export est en CLAIR, l'irréversibilité est écrite */}
        <Field label={t.cofExportType} className="mt-4">
          <Input value={confirm} onChange={e => setConfirm(e.target.value.toUpperCase())} placeholder="EXPORT" />
        </Field>
        {/* v1.9.0 — sauvegarde chiffrée KVCS1 : s'AJOUTE aux exports en
            clair (qui restent pour l'interopérabilité). Pas de
            type-to-confirm ici : la passphrase EST la protection. */}
        <div className="border-t border-border mt-5 pt-5">
          <Label className="mb-2 block">{t.cofSealExport}</Label>
          <p className="text-xs text-fg-3 leading-relaxed mb-3">{t.cofSealIntro}</p>
          <Alert tone="warn" className="mb-4">{t.cofSealWarning}</Alert>
          <Field label={t.cofSealPass}>
            <PasswordInput value={sPass} onChange={e => setSPass(e.target.value)} autoComplete="new-password" />
          </Field>
          <Field label={t.cofSealPass2} error={sPass2 !== '' && sPass !== sPass2 ? String(t.backupMismatch) : undefined}>
            <PasswordInput value={sPass2} onChange={e => setSPass2(e.target.value)} autoComplete="new-password" />
          </Field>
          <Button variant="primary" disabled={sBusy || sPass.length < 12 || sPass !== sPass2} onClick={sealNow}>
            {sBusy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <ShieldCheck size={14} aria-hidden="true" />} {t.cofSealBtn}
          </Button>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="ghost" onClick={onClose}>{t.cofCancel}</Button>
          <Button variant="destructive" disabled={confirm !== 'EXPORT'} onClick={exportNow}>
            <Download size={14} aria-hidden="true" /> {t.cofExportBtn}
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
      // wrong_password : échec LOCAL de déverrouillage (pas une ApiError)
      toast.error(e?.message === 'wrong_password' ? String(t.cofChangePwWrong) : friendly(e))
    }
    setPwBusy(false)
  }

  const destroyNow = async () => {
    if (dBusy || destroy !== 'DESTROY') return
    setDBusy(true)
    try {
      await api('DELETE', '/admin/coffre', { confirm: 'DESTROY' })
      onDestroyed()
    } catch (e) { toast.error(friendly(e)) }
    setDBusy(false)
  }

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent title={t.cofSettings} className="max-w-md">
        <div className="max-h-[65vh] overflow-auto pr-1 space-y-6">
          <div>
            <Label className="mb-2 block">{t.cofAutolock}</Label>
            <SegmentedControl
              ariaLabel={String(t.cofAutolock)}
              value={autoLockMin}
              onChange={m => { setAutoLockMin(m); localStorage.setItem('kerviavault-coffre-autolock', String(m)) }}
              options={[1, 5, 15, 60, 0].map(m => ({ value: m, label: m === 0 ? String(t.cofAutolockOff) : `${m} min` }))}
            />
          </div>
          <div className="border-t border-border pt-5">
            <Label className="mb-2 block">{t.cofChangePw}</Label>
            <Field label={t.cofCurPw}><PasswordInput value={cur} onChange={e => setCur(e.target.value)} autoComplete="current-password" /></Field>
            <Field label={t.cofNewPw} className="mt-3"><PasswordInput value={npw} onChange={e => setNpw(e.target.value)} autoComplete="new-password" /></Field>
            <Field label={t.cofNewPw2} className="mt-3"><PasswordInput value={npw2} onChange={e => setNpw2(e.target.value)} autoComplete="new-password" /></Field>
            <Button variant="secondary" className="mt-4" disabled={pwBusy || !cur || !npw} onClick={changePw}>
              {pwBusy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <KeyRound size={14} aria-hidden="true" />} {t.cofChangePwBtn}
            </Button>
          </div>
          <div className="border-t border-danger/20 pt-5">
            <Label className="mb-2 block text-danger">{t.cofDestroyTitle}</Label>
            <Alert tone="danger" className="mb-3">{t.cofDestroyWarning}</Alert>
            {/* type-to-confirm conservé (mécanisme validé par l'audit) :
                destruction totale du coffre, irrécupérable par conception */}
            <Field label={t.cofDestroyType} className="mt-3">
              <Input value={destroy} onChange={e => setDestroy(e.target.value.toUpperCase())} placeholder="DESTROY" />
            </Field>
            <Button variant="destructive" className="mt-3" disabled={destroy !== 'DESTROY' || dBusy} onClick={destroyNow}>
              {dBusy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Trash2 size={14} aria-hidden="true" />} {t.cofDestroyBtn}
            </Button>
          </div>
        </div>
        <div className="flex justify-end mt-5">
          <Button variant="ghost" onClick={onClose}><X size={14} aria-hidden="true" />{t.cofClose}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}