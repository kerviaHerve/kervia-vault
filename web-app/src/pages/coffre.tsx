// Coffre — gestionnaire de mot de passe personnel, zero-knowledge.
// Toutes les opérations de chiffrement se passent dans le navigateur
// (lib/coffre) : le serveur ne voit que des blobs. La clé ne vit qu'en
// mémoire — auto-lock après inactivité, reload = reverrouillé.
import * as React from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { toast } from 'sonner'
import {
  Lock, Plus, Search, Star, Copy, Eye, EyeOff, Trash2, RotateCcw, Pencil,
  Globe, FileText, KeyRound, LoaderCircle, X, Download, Upload, Settings2,
  Wand2, Clock, ExternalLink, ShieldCheck, AlertTriangle, History,
} from 'lucide-react'
import { useLang } from '@/i18n'
import { api } from '@/lib/api'
import { Button, Badge, Dialog, DialogContent, Input, PasswordInput, Field, Label } from '@/components/ui'
import { cn, fmtDateTime } from '@/lib/utils'
import * as C from '@/lib/coffre'

const AUTOCKEY = 'kerviavault-coffre-autolock'

type Phase = 'loading' | 'setup' | 'locked' | 'unlocked'
type Dialog =
  | null
  | { kind: 'item'; item?: C.DecryptedItem }   // sans item = création
  | { kind: 'generator' }
  | { kind: 'import' }
  | { kind: 'export' }
  | { kind: 'settings' }

// copie presse-papier + effacement auto best-effort (30 s) — un vrai
// gestionnaire ne laisse pas le mot de passe traîner dans le clipboard.
function useCopy() {
  const { t } = useLang()
  return (v: string) => {
    navigator.clipboard.writeText(v).catch(() => {})
    toast.success(String(t.cofCopied), { description: String(t.cofAutoClear) })
    window.setTimeout(() => { if (document.hasFocus()) navigator.clipboard.writeText('').catch(() => {}) }, 30000)
  }
}

// code TOTP vivant (seconde par seconde) tant que le dialog est ouvert
function TotpCode({ seed }: { seed: string }) {
  const { t } = useLang()
  const [s, setS] = React.useState<{ code: string; remaining: number } | null>(null)
  React.useEffect(() => {
    let alive = true
    const tick = async () => {
      try { const c = await C.totpNow(seed); if (alive) setS(c) } catch { if (alive) setS(null) }
    }
    tick()
    const i = window.setInterval(tick, 1000)
    return () => { alive = false; window.clearInterval(i) }
  }, [seed])
  if (!s) return <Badge variant="warn">{t.cofTotpBad}</Badge>
  return (
    <span className="inline-flex items-center gap-2 font-mono text-sm tracking-wider text-accent">
      {s.code.slice(0, 3)} {s.code.slice(3)}
      <span className="text-[10px] text-fg-3 not-italic">{s.remaining}s</span>
    </span>
  )
}

// barre de force — entropie estimée par la lib
function Strength({ pw }: { pw: string }) {
  const { t } = useLang()
  const st = C.passwordStrength(pw)
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

export default function Coffre() {
  const { t } = useLang()
  const copy = useCopy()
  const [phase, setPhase] = React.useState<Phase>('loading')
  const [header, setHeader] = React.useState<C.CoffreEnvelope | null>(null)
  const [items, setItems] = React.useState<C.DecryptedItem[]>([])
  const [dialog, setDialog] = React.useState<Dialog>(null)
  const [search, setSearch] = React.useState('')
  const [view, setView] = React.useState<'all' | 'fav' | 'trash'>('all')
  const [typeF, setTypeF] = React.useState<'all' | 'login' | 'note'>('all')
  const [folder, setFolder] = React.useState('')
  const [autoLockMin, setAutoLockMin] = React.useState<number>(() => Number(localStorage.getItem(AUTOCKEY)) || 5)
  const lastActivity = React.useRef(Date.now())

  // ---- chargement initial : le coffre existe-t-il ? ----
  React.useEffect(() => { void boot() }, [])
  const boot = async () => {
    try {
      const h = await api('GET', '/admin/coffre')
      setHeader(h)
      setPhase(C.coffreUnlocked() ? 'unlocked' : 'locked')
      if (C.coffreUnlocked()) void reload()
    } catch {
      setPhase('setup')
    }
  }

  // ---- items ----
  const reload = async () => {
    try {
      const raw: any[] = await api('GET', '/admin/coffre/items')
      const dec: C.DecryptedItem[] = []
      for (const it of raw) {
        try {
          const data = await C.decryptItem(it.blob_b64)
          dec.push({ ...data, id: it.id, version: it.version, created_at: it.created_at, updated_at: it.updated_at, deleted_at: it.deleted_at || null })
        } catch {
          dec.push({ v: 1, type: 'login', name: '?', id: it.id, version: it.version, created_at: it.created_at, updated_at: it.updated_at, deleted_at: it.deleted_at || null, _broken: true })
        }
      }
      setItems(dec)
    } catch (e: any) { toast.error(e.message) }
  }

  const lock = (auto = false) => {
    C.lockCoffre()
    setItems([])
    setDialog(null)
    setPhase('locked')
    if (auto) toast.info(String(t.cofAutoLocked))
  }

  // ---- auto-lock : activité = souris/clavier/tactile ----
  React.useEffect(() => {
    if (phase !== 'unlocked') return
    const bump = () => { lastActivity.current = Date.now() }
    window.addEventListener('mousemove', bump)
    window.addEventListener('keydown', bump)
    window.addEventListener('click', bump)
    window.addEventListener('touchstart', bump)
    const i = window.setInterval(() => {
      if (autoLockMin > 0 && Date.now() - lastActivity.current > autoLockMin * 60_000) lock(true)
    }, 10_000)
    return () => {
      window.removeEventListener('mousemove', bump)
      window.removeEventListener('keydown', bump)
      window.removeEventListener('click', bump)
      window.removeEventListener('touchstart', bump)
      window.clearInterval(i)
    }
  }, [phase, autoLockMin])

  // ---- filtres ----
  const folders = [...new Set(items.filter(i => !i.deleted_at).map(i => i.folder || '').filter(Boolean))].sort()
  const shown = items.filter(i => {
    if (view === 'trash') return !!i.deleted_at
    if (i.deleted_at) return false
    if (view === 'fav' && !i.favorite) return false
    if (typeF !== 'all' && i.type !== typeF) return false
    if (folder && (i.folder || '') !== folder) return false
    const q = search.trim().toLowerCase()
    if (!q) return true
    return [i.name, i.username, (i.uris || []).join(' '), i.notes, i.folder]
      .filter(Boolean).join(' ').toLowerCase().includes(q)
  })

  // ---- mutations (tout passe par l'API + re-chiffrement local) ----
  const saveItem = async (data: C.CoffreItemData, existing?: C.DecryptedItem) => {
    const blob = await C.encryptItem(data)
    if (existing) {
      try {
        await api('PATCH', `/admin/coffre/items/${existing.id}`, { blob_b64: blob, expected_version: existing.version })
        toast.success(String(t.cofSaved))
      } catch (e: any) {
        if (e.message && String(e.message).includes('HTTP 409')) toast.error(String(t.cofSaveConflict))
        else toast.error(e.message)
        throw e
      }
    } else {
      await api('POST', '/admin/coffre/items', { blob_b64: blob })
      toast.success(String(t.cofSaved))
    }
    await reload()
  }
  const trashItem = async (id: string) => {
    try { await api('DELETE', `/admin/coffre/items/${id}`, undefined); toast.success(String(t.cofDeletedOk)); await reload() } catch (e: any) { toast.error(e.message) }
  }
  const restoreItem = async (id: string) => {
    try { await api('POST', `/admin/coffre/items/${id}/restore`); toast.success(String(t.cofRestoredOk)); await reload() } catch (e: any) { toast.error(e.message) }
  }
  const purgeItem = async (id: string) => {
    try { await api('POST', `/admin/coffre/items/${id}/purge`); toast.success(String(t.cofPurgedOk)); await reload() } catch (e: any) { toast.error(e.message) }
  }
  const purgeTrash = async () => {
    if (!window.confirm(String(t.cofPurgeTrashConfirm))) return
    try { const d = await api('POST', '/admin/coffre/trash/purge'); toast.success(String(t.cofTrashEmptied).replace('{n}', String(d.purged))); await reload() } catch (e: any) { toast.error(e.message) }
  }

  // ================= écrans =================

  if (phase === 'loading') {
    return <div className="grid place-items-center py-24"><LoaderCircle className="animate-spin text-fg-3" /></div>
  }

  // ---- écran 1 : création du coffre ----
  if (phase === 'setup') return <SetupScreen onDone={() => { void boot() }} />

  // ---- écran 2 : verrouillé ----
  if (phase === 'locked') {
    return <LockScreen header={header!} onUnlock={() => { setPhase('unlocked'); void reload() }} />
  }

  // ---- écran 3 : déverrouillé ----
  const live = items.filter(i => !i.deleted_at).length
  const trashN = items.filter(i => i.deleted_at).length

  return (
    <div className="max-w-6xl">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
            {t.cofTitle} <Badge variant="ok"><ShieldCheck size={11} />E2E</Badge>
          </h1>
          <p className="text-sm text-fg-3 mt-1">{t.cofSub}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setDialog({ kind: 'import' })}><Upload size={14} />{t.cofImport}</Button>
          <Button variant="ghost" size="sm" onClick={() => setDialog({ kind: 'export' })}><Download size={14} />{t.cofExport}</Button>
          <Button variant="ghost" size="sm" onClick={() => setDialog({ kind: 'generator' })}><Wand2 size={14} />{t.cofGen}</Button>
          <Button variant="ghost" size="sm" onClick={() => setDialog({ kind: 'settings' })}><Settings2 size={14} />{t.cofSettings}</Button>
          <Button variant="primary" size="sm" onClick={() => setDialog({ kind: 'item' })}><Plus size={14} />{t.cofNew}</Button>
          <Button variant="secondary" size="sm" onClick={() => lock()} title={t.cofLock}><Lock size={14} /></Button>
        </div>
      </div>

      {/* barre de filtres */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-3" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder={String(t.cofSearchPh)}
            className="w-64 pl-9" />
        </div>
        <div className="flex rounded-lg border border-border overflow-hidden">
          {([['all', t.cofAll, live], ['fav', t.cofFavorites, items.filter(i => i.favorite && !i.deleted_at).length], ['trash', t.cofTrash, trashN]] as const).map(([id, label, n]) => (
            <button key={id} onClick={() => setView(id as any)}
              className={cn('px-3 h-9 text-xs flex items-center gap-1.5 transition-colors cursor-pointer',
                view === id ? 'bg-accent/12 text-accent font-semibold' : 'text-fg-2 hover:bg-card-2')}>
              {label}{n > 0 && <span className="opacity-60">{n}</span>}
            </button>
          ))}
        </div>
        <select value={typeF} onChange={e => setTypeF(e.target.value as any)}
          className="h-9 bg-bg border border-border rounded-lg px-2 text-xs text-fg">
          <option value="all">{t.cofTypeAll}</option>
          <option value="login">{t.cofTypeLogins}</option>
          <option value="note">{t.cofTypeNotes}</option>
        </select>
        {folders.length > 0 && (
          <select value={folder} onChange={e => setFolder(e.target.value)}
            className="h-9 bg-bg border border-border rounded-lg px-2 text-xs text-fg max-w-40">
            <option value="">{t.cofFolderAll}</option>
            {folders.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        )}
        {view === 'trash' && trashN > 0 && (
          <Button variant="destructive" size="sm" onClick={purgeTrash}><Trash2 size={13} />{t.cofPurgeTrash}</Button>
        )}
      </div>

      {/* liste */}
      <div className="border border-border rounded-xl bg-card overflow-hidden">
        {shown.length === 0 ? (
          <div className="py-16 text-center text-sm text-fg-3">
            {view === 'trash' ? t.cofEmptyTrash : t.cofEmpty}
          </div>
        ) : shown.map(it => (
          <div key={it.id} className={cn('flex items-center gap-3 px-4 py-3 border-b border-border last:border-b-0 hover:bg-card-2/50 transition-colors', it._broken && 'opacity-60')}>
            <div className={cn('w-9 h-9 rounded-lg grid place-items-center shrink-0',
              it.type === 'note' ? 'bg-warn/12 text-warn' : 'bg-accent/12 text-accent')}>
              {it.type === 'note' ? <FileText size={16} /> : <Globe size={16} />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm truncate">{it.name}</span>
                {it.favorite && <Star size={12} className="text-warn fill-warn shrink-0" />}
                {it.folder && <Badge variant="neutral" className="shrink-0">{it.folder}</Badge>}
                {it._broken && <Badge variant="danger">{t.cofBroken}</Badge>}
              </div>
              <div className="text-xs text-fg-3 truncate">
                {it._broken ? '—' : it.type === 'note' ? (it.notes || '—') : (it.username || '—')}
              </div>
            </div>
            {!it._broken && it.totp && <div className="hidden md:block"><TotpCode seed={it.totp} /></div>}
            <span className="hidden lg:block text-[11px] text-fg-3 w-28 text-right shrink-0">{fmtDateTime(it.updated_at)}</span>
            <div className="flex items-center gap-0.5 shrink-0">
              {!it._broken && it.type === 'login' && it.username && (
                <Button variant="ghost" size="icon" title={t.cofCopyUser} onClick={() => copy(it.username!)}><Copy size={14} /></Button>
              )}
              {!it._broken && it.password && (
                <Button variant="ghost" size="icon" title={t.cofCopyPass} onClick={() => copy(it.password!)}><KeyRound size={14} /></Button>
              )}
              {!it._broken && it.type === 'login' && (it.uris || [])[0] && (
                <a href={it.uris![0]} target="_blank" rel="noreferrer"
                  className="h-8 w-8 grid place-items-center rounded-md text-fg-2 hover:text-fg hover:bg-card-2 cursor-pointer" title={t.cofOpenUri}>
                  <ExternalLink size={14} />
                </a>
              )}
              <Button variant="ghost" size="icon" onClick={() => setDialog({ kind: 'item', item: it })}><Eye size={14} /></Button>
              {view === 'trash' ? (
                <>
                  <Button variant="ghost" size="icon" title={t.cofRestore} onClick={() => restoreItem(it.id)}><RotateCcw size={14} /></Button>
                  <Button variant="destructive" size="icon" title={t.cofPurge} onClick={() => purgeItem(it.id)}><Trash2 size={14} /></Button>
                </>
              ) : (
                <Button variant="ghost" size="icon" title={t.cofDelete} onClick={() => trashItem(it.id)}><Trash2 size={14} /></Button>
              )}
            </div>
          </div>
        ))}
      </div>

      <p className="text-[11px] text-fg-3 mt-4 flex items-center gap-1.5">
        <ShieldCheck size={12} /> {t.cofE2E} <Clock size={12} className="ml-3" /> {t.cofAutolock} : {autoLockMin > 0 ? `${autoLockMin} min` : t.cofAutolockOff}
      </p>

      <AnimatePresence>
        {dialog?.kind === 'item' && (
          <ItemDialog key="item" item={dialog.item} items={items} onClose={() => setDialog(null)} onSaved={saveItem} onDeleted={trashItem} />
        )}
        {dialog?.kind === 'generator' && <GeneratorDialog key="gen" onClose={() => setDialog(null)} />}
        {dialog?.kind === 'import' && <ImportDialog key="imp" onClose={() => setDialog(null)} onImported={reload} />}
        {dialog?.kind === 'export' && <ExportDialog key="exp" items={items.filter(i => !i._broken)} onClose={() => setDialog(null)} />}
        {dialog?.kind === 'settings' && (
          <SettingsDialog key="set" header={header} autoLockMin={autoLockMin} setAutoLockMin={setAutoLockMin}
            onDestroyed={() => { setDialog(null); C.lockCoffre(); setPhase('setup') }}
            onRekeyed={async env => { setHeader(env); toast.success(String(t.cofChangePwDone)) }}
            onClose={() => setDialog(null)} />
        )}
      </AnimatePresence>
    </div>
  )
}

// ================= création du coffre =================

function SetupScreen({ onDone }: { onDone: () => void }) {
  const { t } = useLang()
  const [pw, setPw] = React.useState('')
  const [pw2, setPw2] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  const create = async () => {
    if (busy) return
    if (pw.length < 12) { toast.error(String(t.cofPwTooShort)); return }
    if (pw !== pw2) { toast.error(String(t.cofSetupMismatch)); return }
    setBusy(true)
    try {
      const env = await C.createCoffre(pw)
      await api('POST', '/admin/coffre', env)
      toast.success(String(t.cofSetupDone))
      onDone()
    } catch (e: any) { toast.error(e.message) }
    setBusy(false)
  }

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="max-w-md mx-auto py-16">
      <div className="border border-border rounded-2xl bg-card p-8">
        <div className="w-12 h-12 rounded-xl bg-accent/12 text-accent grid place-items-center mb-5"><Lock size={22} /></div>
        <h1 className="text-lg font-bold">{t.cofSetupTitle}</h1>
        <p className="text-sm text-fg-2 mt-2 leading-relaxed">{t.cofSetupIntro}</p>
        <div className="flex gap-2 text-xs text-fg-3 my-4 rounded-lg bg-card-2 border border-border p-3">
          <AlertTriangle size={14} className="text-warn shrink-0 mt-0.5" />
          <span className="leading-relaxed">{t.cofSetupWarning}</span>
        </div>
        <Field label={t.cofMasterPw}>
          <PasswordInput value={pw} onChange={e => setPw(e.target.value)} autoFocus autoComplete="new-password" />
        </Field>
        <div className="mt-1.5">{pw && <Strength pw={pw} />}</div>
        <Field label={t.cofMasterPw2} className="mt-4">
          <PasswordInput value={pw2} onChange={e => setPw2(e.target.value)} onKeyDown={e => e.key === 'Enter' && create()} />
        </Field>
        <Button variant="primary" className="w-full mt-6" disabled={busy || !pw || !pw2} onClick={create}>
          {busy ? <LoaderCircle className="animate-spin" /> : <ShieldCheck size={15} />} {t.cofSetupBtn}
        </Button>
      </div>
    </motion.div>
  )
}

// ================= déverrouillage =================

function LockScreen({ header, onUnlock }: { header: C.CoffreEnvelope; onUnlock: () => void }) {
  const { t } = useLang()
  const [pw, setPw] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [fail, setFail] = React.useState(false)

  const unlock = async () => {
    if (busy || !pw) return
    setBusy(true); setFail(false)
    try {
      await C.unlockCoffre(header, pw)
      setPw('')
      onUnlock()
    } catch {
      setFail(true)
    }
    setBusy(false)
  }

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="max-w-sm mx-auto py-20">
      <div className="border border-border rounded-2xl bg-card p-8 text-center">
        <div className="w-12 h-12 rounded-xl bg-muted text-fg-2 grid place-items-center mx-auto mb-5"><Lock size={22} /></div>
        <h1 className="text-lg font-bold">{t.cofUnlock}</h1>
        <p className="text-xs text-fg-3 mt-1.5">{t.cofE2E}</p>
        <Field label={t.cofMasterPw} className="text-left mt-5">
          <PasswordInput value={pw} onChange={e => setPw(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && unlock()} autoFocus
            className={fail ? 'border-danger' : ''} />
        </Field>
        {fail && <p className="text-xs text-danger mt-2">{t.cofUnlockFail}</p>}
        <Button variant="primary" className="w-full mt-5" disabled={busy || !pw} onClick={unlock}>
          {busy ? <LoaderCircle className="animate-spin" /> : <KeyRound size={15} />} {busy ? t.cofUnlocking : t.cofUnlockBtn}
        </Button>
      </div>
    </motion.div>
  )
}

// ================= dialog item (vue + édition) =================

function ItemDialog({ item, items, onClose, onSaved, onDeleted }: {
  item?: C.DecryptedItem
  items: C.DecryptedItem[]
  onClose: () => void
  onSaved: (data: C.CoffreItemData, existing?: C.DecryptedItem) => Promise<void>
  onDeleted: (id: string) => Promise<void>
}) {
  const { t } = useLang()
  const copy = useCopy()
  const isNew = !item
  const [edit, setEdit] = React.useState(isNew)
  const [busy, setBusy] = React.useState(false)
  const [showPw, setShowPw] = React.useState(false)
  const [d, setD] = React.useState<C.CoffreItemData>(() => ({
    v: 1,
    type: isNew ? 'login' : item!.type,
    name: isNew ? '' : item!.name,
    username: isNew ? '' : item!.username || '',
    password: isNew ? '' : item!.password || '',
    uris: isNew ? [] : item!.uris || [],
    totp: isNew ? '' : item!.totp || '',
    notes: isNew ? '' : item!.notes || '',
    folder: isNew ? '' : item!.folder || '',
    favorite: isNew ? false : !!item!.favorite,
    history: isNew ? [] : item!.history || [],
  }))
  const folders = [...new Set(items.map(i => i.folder || '').filter(Boolean))]
  const st = C.passwordStrength(d.password || '')

  const set = (patch: Partial<C.CoffreItemData>) => setD(prev => ({ ...prev, ...patch }))

  const save = async () => {
    if (busy) return
    if (!d.name.trim()) { toast.error(String(t.cofNameRequired)); return }
    setBusy(true)
    try {
      let out: C.CoffreItemData = { ...d, name: d.name.trim(), folder: (d.folder || '').trim() }
      // historique : l'ancien mot de passe est conservé dans l'item
      if (!isNew && item!.password && item!.password !== out.password) {
        out = { ...out,
          history: [...(item!.history || []), { password: item!.password, changed_at: new Date().toISOString() }].slice(-10),
          password_updated_at: new Date().toISOString(),
        }
      }
      await onSaved(out, item)
      onClose()
    } catch { /* toast déjà affiché */ }
    setBusy(false)
  }

  return (
    <DialogContent className="max-w-lg" title={isNew ? t.cofNew : item!.name}>
      {!edit ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Badge variant="neutral">{d.type === 'note' ? t.cofTypeNotes : t.cofTypeLogins}</Badge>
            {d.favorite && <Star size={13} className="text-warn fill-warn" />}
            {d.folder && <Badge variant="accent">{d.folder}</Badge>}
          </div>
          {d.type === 'login' && (
            <>
              {d.username && <ViewRow label={t.cofUsername} value={d.username} onCopy={() => copy(d.username!)} />}
              {d.password && (
                <div>
                  <ViewRow label={t.cofPassword} mono value={showPw ? d.password : '•'.repeat(Math.min(20, d.password.length))}
                    onCopy={() => copy(d.password!)} />
                  <div className="flex items-center justify-between mt-1.5">
                    <button onClick={() => setShowPw(s => !s)} className="text-[11px] text-fg-3 hover:text-fg inline-flex items-center gap-1 cursor-pointer">
                      {showPw ? <EyeOff size={11} /> : <Eye size={11} />} {showPw ? t.cofHide : t.cofShow}
                    </button>
                    <Strength pw={d.password} />
                  </div>
                </div>
              )}
              {(d.uris || []).filter(Boolean).map((u, i) => (
                <ViewRow key={i} label={i === 0 ? t.cofUris : ''} value={u} onOpen={u} onCopy={() => copy(u)} />
              ))}
              {d.totp && (
                <div className="flex items-center justify-between border-b border-border pb-2">
                  <Label className="text-fg-2">TOTP</Label>
                  <TotpCode seed={d.totp} />
                </div>
              )}
            </>
          )}
          {d.notes && (
            <div>
              <Label>{t.cofNotes}</Label>
              <p className="text-sm text-fg-2 whitespace-pre-wrap rounded-lg bg-card-2 border border-border p-3 max-h-40 overflow-auto">{d.notes}</p>
            </div>
          )}
          {(d.history || []).length > 0 && (
            <details className="text-sm">
              <summary className="text-xs text-fg-3 cursor-pointer inline-flex items-center gap-1.5 select-none"><History size={12} />{t.cofHistory} ({d.history!.length})</summary>
              <div className="mt-2 space-y-1.5">
                {d.history!.slice().reverse().map((h, i) => (
                  <div key={i} className="flex items-center justify-between text-xs text-fg-3">
                    <span className="font-mono truncate max-w-56">{h.password}</span>
                    <span className="flex items-center gap-2">
                      {fmtDateTime(h.changed_at)}
                      <button onClick={() => copy(h.password)} className="hover:text-fg cursor-pointer"><Copy size={12} /></button>
                    </span>
                  </div>
                ))}
              </div>
            </details>
          )}
          <div className="flex items-center justify-between pt-3">
            <span className="text-[11px] text-fg-3">{t.cofPwUpdated} : {fmtDateTime((item as any).password_updated_at) || '—'}</span>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => onDeleted(item!.id).then(onClose)}><Trash2 size={13} />{t.cofDelete}</Button>
              <Button variant="primary" size="sm" onClick={() => setEdit(true)}><Pencil size={13} />{t.cofEdit}</Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-3.5 max-h-[65vh] overflow-auto pr-1">
          <div className="grid grid-cols-2 gap-2">
            {(['login', 'note'] as const).map(tp => (
              <button key={tp} onClick={() => set({ type: tp })}
                className={cn('h-9 rounded-lg border text-xs font-medium transition-colors cursor-pointer',
                  d.type === tp ? 'border-accent bg-accent/12 text-accent' : 'border-border text-fg-2 hover:bg-card-2')}>
                {tp === 'login' ? t.cofTypeLogins : t.cofTypeNotes}
              </button>
            ))}
          </div>
          <Field label={t.cofName}><Input value={d.name} onChange={e => set({ name: e.target.value })} autoFocus /></Field>
          {d.type === 'login' && (
            <>
              <Field label={t.cofUsername}><Input value={d.username} onChange={e => set({ username: e.target.value })} /></Field>
              <div>
                <Field label={t.cofPassword}>
                  <div className="flex gap-1.5">
                    <PasswordInput value={d.password} onChange={e => set({ password: e.target.value })}
                      className={st.label === 'weak' && d.password ? 'border-danger/50' : ''} />
                    <Button variant="secondary" size="icon" title={t.cofGenerate}
                      onClick={() => set({ password: C.generatePassword({ length: 20, upper: true, lower: true, digits: true, symbols: true }), password_updated_at: new Date().toISOString() })}>
                      <Wand2 size={14} />
                    </Button>
                  </div>
                </Field>
                {d.password && <div className="mt-1.5"><Strength pw={d.password} /></div>}
              </div>
              <Field label={t.cofUris}>
                <Input value={(d.uris || []).join('\n')} onChange={e => set({ uris: e.target.value.split('\n').map(s => s.trim()).filter(Boolean) })}
                  placeholder="https://…" />
              </Field>
              <Field label="TOTP" help="otpauth://… ou seed base32">
                <Input value={d.totp} onChange={e => set({ totp: e.target.value })} className="font-mono" />
              </Field>
            </>
          )}
          <Field label={t.cofNotes}>
            <textarea value={d.notes} onChange={e => set({ notes: e.target.value })}
              className="w-full min-h-20 bg-bg border border-border rounded-lg p-3 text-sm text-fg placeholder:text-fg-3 focus:border-accent focus:ring-2 focus:ring-accent/20 outline-none" />
          </Field>
          <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
            <Field label={t.cofFolder}>
              <input list="coffre-folders" value={d.folder} onChange={e => set({ folder: e.target.value })} maxLength={64}
                className="w-full h-9 bg-bg border border-border rounded-lg px-3 text-sm text-fg focus:border-accent focus:ring-2 focus:ring-accent/20 outline-none" />
              <datalist id="coffre-folders">{folders.map(f => <option key={f} value={f} />)}</datalist>
            </Field>
            <Button variant={d.favorite ? 'secondary' : 'ghost'} size="icon" onClick={() => set({ favorite: !d.favorite })} title={t.cofFavorite}>
              <Star size={15} className={d.favorite ? 'text-warn fill-warn' : ''} />
            </Button>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose}>{t.cofCancel}</Button>
            <Button variant="primary" disabled={busy} onClick={save}>
              {busy ? <LoaderCircle className="animate-spin" /> : null} {t.cofSave}
            </Button>
          </div>
        </div>
      )}
    </DialogContent>
  )
}

// ligne vue : label + valeur + copy/open
function ViewRow({ label, value, mono, onCopy, onOpen }: {
  label: string; value: string; mono?: boolean; onCopy?: () => void; onOpen?: string
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border pb-2">
      <Label className="text-fg-3 shrink-0 w-24">{label}</Label>
      <span className={cn('text-sm truncate flex-1 text-right', mono && 'font-mono')}>{value}</span>
      <span className="flex gap-1 shrink-0">
        {onOpen && (
          <a href={onOpen} target="_blank" rel="noreferrer" className="h-7 w-7 grid place-items-center rounded-md text-fg-3 hover:text-fg hover:bg-card-2 cursor-pointer"><ExternalLink size={13} /></a>
        )}
        {onCopy && (
          <Button variant="ghost" size="icon" onClick={onCopy}><Copy size={13} /></Button>
        )}
      </span>
    </div>
  )
}

// ================= générateur =================

function GeneratorDialog({ onClose }: { onClose: () => void }) {
  const { t } = useLang()
  const copy = useCopy()
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

  const st = C.passwordStrength(value)
  return (
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
        <div className="mt-2 flex justify-center"><Strength pw={value} /></div>
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
  )
}

// ================= import / export =================

function ImportDialog({ onClose, onImported }: { onClose: () => void; onImported: () => Promise<void> }) {
  const { t } = useLang()
  const [parsed, setParsed] = React.useState<C.CoffreItemData[] | null>(null)
  const [fname, setFname] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  const pick = async (f: File) => {
    try {
      const json = JSON.parse(await f.text())
      const its = C.bitwardenToItems(json)
      if (json.encrypted && its.length === 0) { toast.error(String(t.cofImportEncrypted)); return }
      if (its.length === 0) { toast.error(String(t.cofImportBad)); return }
      setParsed(its)
      setFname(f.name)
    } catch { toast.error(String(t.cofImportBad)) }
  }

  const run = async () => {
    if (!parsed || busy) return
    setBusy(true)
    try {
      // chiffre chaque item localement puis envoie en lot
      const blobs = [] as { blob_b64: string }[]
      for (const it of parsed) blobs.push({ blob_b64: await C.encryptItem(it) })
      const d = await api('POST', '/admin/coffre/items/batch', { items: blobs })
      toast.success(String(t.cofImportDone).replace('{n}', String(d.created)))
      await onImported()
      onClose()
    } catch (e: any) { toast.error(e.message) }
    setBusy(false)
  }

  return (
    <DialogContent title={t.cofImportTitle}>
      <p className="text-xs text-fg-3 leading-relaxed mb-4">{t.cofImportHint}</p>
      <label className="block border border-dashed border-border rounded-xl p-8 text-center cursor-pointer hover:bg-card-2/50 transition-colors">
        <input type="file" accept="application/json,.json" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) void pick(f) }} />
        <Upload size={20} className="mx-auto text-fg-3 mb-2" />
        <span className="text-sm text-fg-2">{fname || t.cofImportPick}</span>
      </label>
      {parsed && (
        <div className="mt-4 rounded-lg bg-accent/8 border border-accent/25 p-3 text-sm text-accent flex items-center gap-2">
          <ShieldCheck size={14} /> {String(t.cofImportCount).replace('{n}', String(parsed.length))}
        </div>
      )}
      <div className="flex justify-end gap-2 mt-5">
        <Button variant="ghost" onClick={onClose}>{t.cofCancel}</Button>
        <Button variant="primary" disabled={!parsed || busy} onClick={run}>
          {busy ? <LoaderCircle className="animate-spin" /> : null} {t.cofImportBtn}
        </Button>
      </div>
    </DialogContent>
  )
}

function ExportDialog({ items, onClose }: { items: C.DecryptedItem[]; onClose: () => void }) {
  const { t } = useLang()
  const [confirm, setConfirm] = React.useState('')
  const exportNow = () => {
    const data = C.itemsToBitwarden(items)
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `kervia-coffre-export-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(a.href)
    toast.success(String(t.cofExportDone))
    onClose()
  }
  return (
    <DialogContent title={t.cofExportTitle}>
      <div className="flex gap-2 text-xs text-fg-3 my-4 rounded-lg bg-card-2 border border-border p-3">
        <AlertTriangle size={14} className="text-warn shrink-0 mt-0.5" />
        <span className="leading-relaxed">{t.cofExportWarning}</span>
      </div>
      <Field label={t.cofExportType}>
        <Input value={confirm} onChange={e => setConfirm(e.target.value.toUpperCase())} placeholder="EXPORT" />
      </Field>
      <div className="flex justify-end gap-2 mt-5">
        <Button variant="ghost" onClick={onClose}>{t.cofCancel}</Button>
        <Button variant="destructive" disabled={confirm !== 'EXPORT'} onClick={exportNow}>
          <Download size={14} /> {t.cofExportBtn}
        </Button>
      </div>
    </DialogContent>
  )
}

// ================= réglages du coffre =================

function SettingsDialog({ header, autoLockMin, setAutoLockMin, onRekeyed, onDestroyed, onClose }: {
  header: C.CoffreEnvelope | null
  autoLockMin: number; setAutoLockMin: (n: number) => void
  onRekeyed: (env: C.CoffreEnvelope) => Promise<void>
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
    <DialogContent title={t.cofSettings}>
      <div className="max-h-[65vh] overflow-auto pr-1 space-y-6">
        <div>
          <Label className="mb-2 block">{t.cofAutolock}</Label>
          <div className="flex gap-2">
            {[1, 5, 15, 60, 0].map(m => (
              <button key={m} onClick={() => { setAutoLockMin(m); localStorage.setItem(AUTOCKEY, String(m)) }}
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
  )
}