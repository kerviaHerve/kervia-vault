// Coffre v2 — gestionnaire de mots de passe personnel, zero-knowledge.
// Toutes les opérations de chiffrement se passent dans le navigateur
// (lib/coffre) : le serveur ne voit que des blobs. La clé ne vit qu'en
// mémoire — auto-lock après inactivité, reload = reverrouillé.
// Modèles multiples (identifiants, cartes, identités, SSH, serveurs…),
// import Bitwarden/1Password/CSV, export multi-format, multi-TOTP.
import * as React from 'react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import {
  Lock, Plus, Search, Star, Copy, Eye, Trash2, RotateCcw, KeyRound,
  LoaderCircle, Download, Upload, Settings2, Wand2, Clock, ExternalLink,
  ShieldCheck, AlertTriangle,
} from 'lucide-react'
import { useLang } from '@/i18n'
import { api } from '@/lib/api'
import { Button, Badge, Dialog, DialogContent, Input, PasswordInput, Field } from '@/components/ui'
import { cn, fmtDateTime } from '@/lib/utils'
import * as C from '@/lib/coffre'
import {
  CATEGORIES, CATEGORY_ORDER, itemSubtitle, itemSearchText, firstTotp,
  mainPasswordField, newItem, type CoffreItemData, type CategoryId,
} from '@/lib/coffre-schema'
import ItemDialog from '@/components/coffre/ItemDialog'
import { GeneratorDialog, ImportDialog, ExportDialog, SettingsDialog } from '@/components/coffre/dialogs'
import { CAT_ICON, CAT_COLOR, Strength, TotpLive } from '@/components/coffre/parts'

type Phase = 'loading' | 'setup' | 'locked' | 'unlocked'
type DialogState =
  | null
  | { kind: 'picker' }
  | { kind: 'item'; item?: C.DecryptedItem; draft?: CoffreItemData }
  | { kind: 'generator' }
  | { kind: 'import' }
  | { kind: 'export' }
  | { kind: 'settings' }

export default function Coffre() {
  const { t, lang } = useLang()
  const [phase, setPhase] = React.useState<Phase>('loading')
  const [header, setHeader] = React.useState<C.CoffreEnvelope | null>(null)
  const [items, setItems] = React.useState<C.DecryptedItem[]>([])
  const [dialog, setDialog] = React.useState<DialogState>(null)
  const [search, setSearch] = React.useState('')
  const [view, setView] = React.useState<'all' | 'fav' | 'trash'>('all')
  const [catF, setCatF] = React.useState<'all' | CategoryId>('all')
  const [folder, setFolder] = React.useState('')
  const [autoLockMin, setAutoLockMin] = React.useState<number>(() => Number(localStorage.getItem('kerviavault-coffre-autolock')) || 5)
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

  // ---- items : décryptage local, items v1 normalisés v2 à la volée ----
  // _search précalculé : filtrer 6554 items = des includes() sur des
  // chaînes prêtes, pas des reconstructions à chaque frappe.
  const [listLoading, setListLoading] = React.useState(false)
  const reload = async () => {
    try {
      setListLoading(true)
      const raw: any[] = await api('GET', '/admin/coffre/items')
      const dec: C.DecryptedItem[] = []
      for (const it of raw) {
        try {
          const data = await C.decryptItem(it.blob_b64)
          dec.push({ ...data, id: it.id, version: it.version, created_at: it.created_at, updated_at: it.updated_at, deleted_at: it.deleted_at || null, _search: itemSearchText(data) })
        } catch {
          dec.push({ ...C.normalizeItem(null), id: it.id, version: it.version, created_at: it.created_at, updated_at: it.updated_at, deleted_at: it.deleted_at || null, _broken: true })
        }
      }
      setItems(dec)
    } catch (e: any) { toast.error(e.message) } finally { setListLoading(false) }
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

  // ---- filtres (mémoïsés : gros coffres) ----
  const folders = React.useMemo(
    () => [...new Set(items.filter(i => !i.deleted_at).map(i => i.folder || '').filter(Boolean))].sort(),
    [items])
  const allTags = React.useMemo(
    () => [...new Set(items.flatMap(i => i.tags || []))],
    [items])
  const shownAll = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter(i => {
      if (view === 'trash') return !!i.deleted_at
      if (i.deleted_at) return false
      if (view === 'fav' && !i.favorite) return false
      if (catF !== 'all' && i.type !== catF) return false
      if (folder && (i.folder || '') !== folder) return false
      if (!q) return true
      return (i._search ?? itemSearchText(i)).includes(q)
    })
  }, [items, search, view, catF, folder])

  // pagination : on rend au plus `limit` lignes — un coffre à 6500 items
  // n'affiche que les premières, « Afficher plus » par paliers.
  const PAGE = 100
  const [limit, setLimit] = React.useState(PAGE)
  React.useEffect(() => { setLimit(PAGE) }, [search, view, catF, folder])
  const shown = React.useMemo(() => shownAll.slice(0, limit), [shownAll, limit])
  const hiddenCount = shownAll.length - shown.length

  // ---- mutations : mise à jour LOCALE de l'item (les données sont déjà
  // déchiffrées côté client) — plus de re-téléchargement + re-décryptage
  // de TOUT le coffre à chaque sauvegarde (6554 items !). ----
  const saveItem = async (data: CoffreItemData, existing?: C.DecryptedItem) => {
    const blob = await C.encryptItem(data)
    if (existing) {
      try {
        const rec: any = await api('PATCH', `/admin/coffre/items/${existing.id}`, { blob_b64: blob, expected_version: existing.version })
        setItems(prev => prev.map(i => i.id === existing.id
          ? { ...data, id: existing.id, version: rec.version, created_at: rec.created_at, updated_at: rec.updated_at, deleted_at: rec.deleted_at || null, _search: itemSearchText(data) }
          : i))
        toast.success(String(t.cofSaved))
      } catch (e: any) {
        if (e.message && String(e.message).includes('HTTP 409')) toast.error(String(t.cofSaveConflict))
        else toast.error(e.message)
        throw e
      }
    } else {
      const rec: any = await api('POST', '/admin/coffre/items', { blob_b64: blob })
      setItems(prev => [{ ...data, id: rec.id, version: rec.version, created_at: rec.created_at, updated_at: rec.updated_at, deleted_at: rec.deleted_at || null, _search: itemSearchText(data) }, ...prev])
      toast.success(String(t.cofSaved))
    }
  }
  const setLocalDeleted = (id: string, deleted_at: string | null) =>
    setItems(prev => prev.map(i => i.id === id ? { ...i, deleted_at } : i))
  const trashItem = async (id: string) => {
    try { await api('DELETE', `/admin/coffre/items/${id}`, undefined); toast.success(String(t.cofDeletedOk)); setLocalDeleted(id, new Date().toISOString()) } catch (e: any) { toast.error(e.message) }
  }
  const restoreItem = async (id: string) => {
    try { await api('POST', `/admin/coffre/items/${id}/restore`); toast.success(String(t.cofRestoredOk)); setLocalDeleted(id, null) } catch (e: any) { toast.error(e.message) }
  }
  const purgeItem = async (id: string) => {
    try { await api('POST', `/admin/coffre/items/${id}/purge`); toast.success(String(t.cofPurgedOk)); setItems(prev => prev.filter(i => i.id !== id)) } catch (e: any) { toast.error(e.message) }
  }
  const purgeTrash = async () => {
    if (!window.confirm(String(t.cofPurgeTrashConfirm))) return
    try { const d = await api('POST', '/admin/coffre/trash/purge'); toast.success(String(t.cofTrashEmptied).replace('{n}', String(d.purged))); setItems(prev => prev.filter(i => !i.deleted_at)) } catch (e: any) { toast.error(e.message) }
  }

  const copy = (v: string) => {
    navigator.clipboard.writeText(v).catch(() => {})
    toast.success(String(t.cofCopied), { description: String(t.cofAutoClear) })
    window.setTimeout(() => { if (document.hasFocus()) navigator.clipboard.writeText('').catch(() => {}) }, 30000)
  }

  // ================= écrans =================

  if (phase === 'loading') {
    return <div className="grid place-items-center py-24"><LoaderCircle className="animate-spin text-fg-3" /></div>
  }

  if (phase === 'setup') return <SetupScreen onDone={() => { void boot() }} />

  if (phase === 'locked') {
    return <LockScreen header={header!} onUnlock={() => { setPhase('unlocked'); void reload() }} />
  }

  // ---- déverrouillé ----
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
          <Button variant="primary" size="sm" onClick={() => setDialog({ kind: 'picker' })}><Plus size={14} />{t.cofNew}</Button>
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
        <select value={catF} onChange={e => setCatF(e.target.value as any)}
          className="h-9 bg-bg border border-border rounded-lg px-2 text-xs text-fg max-w-44">
          <option value="all">{t.cofTypeAll}</option>
          {CATEGORY_ORDER.map(c => <option key={c} value={c}>{String(t['cofCat' + c[0].toUpperCase() + c.slice(1)] as any)}</option>)}
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
        {listLoading ? (
          <div className="py-16 text-center text-sm text-fg-3 flex items-center justify-center gap-2">
            <LoaderCircle size={16} className="animate-spin" /> {t.cofLoading}
          </div>
        ) : shown.length === 0 ? (
          <div className="py-16 text-center text-sm text-fg-3">
            {view === 'trash' ? t.cofEmptyTrash : t.cofEmpty}
          </div>
        ) : shown.map(it => {
          const Icon = CAT_ICON[it.type]
          const pw = mainPasswordField(it)
          const totp = firstTotp(it)
          const user = it.fields.find(x => x.l === 'Identifiant' || x.l === 'Utilisateur')?.v
          const link = it.fields.find(x => x.k === 'link' && x.v)?.v
          return (
            <div key={it.id} className={cn('flex items-center gap-3 px-4 py-3 border-b border-border last:border-b-0 hover:bg-card-2/50 transition-colors', it._broken && 'opacity-60')}>
              <div className={cn('w-9 h-9 rounded-lg grid place-items-center shrink-0', CAT_COLOR[it.type])}>
                {it._broken ? <AlertTriangle size={16} /> : <Icon size={16} />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm truncate">{it.name}</span>
                  {it.favorite && <Star size={12} className="text-warn fill-warn shrink-0" />}
                  {it.folder && <Badge variant="neutral" className="shrink-0">{it.folder}</Badge>}
                  {(it.tags || []).slice(0, 2).map(tg => <Badge key={tg} variant="neutral" className="shrink-0">#{tg}</Badge>)}
                  {it._broken && <Badge variant="danger">{t.cofBroken}</Badge>}
                </div>
                <div className="text-xs text-fg-3 truncate">
                  {it._broken ? '—' : itemSubtitle(it) || (it.notes || '—')}
                </div>
              </div>
              {!it._broken && totp && <div className="hidden md:block"><TotpLive value={totp.v} /></div>}
              <span className="hidden lg:block text-[11px] text-fg-3 w-28 text-right shrink-0">{fmtDateTime(it.updated_at)}</span>
              <div className="flex items-center gap-0.5 shrink-0">
                {!it._broken && user && (
                  <Button variant="ghost" size="icon" title={t.cofCopyUser} onClick={() => copy(user)}><Copy size={14} /></Button>
                )}
                {!it._broken && pw?.v && (
                  <Button variant="ghost" size="icon" title={t.cofCopyPass} onClick={() => copy(pw.v)}><KeyRound size={14} /></Button>
                )}
                {!it._broken && link && (
                  <a href={link} target="_blank" rel="noreferrer"
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
          )
        })}
      </div>

      {hiddenCount > 0 && (
        <div className="mt-3 text-center">
          <Button variant="secondary" size="sm" onClick={() => setLimit(l => l + 500)}>
            {String(t.cofShowMore).replace('{n}', String(Math.min(500, hiddenCount)))}
            <span className="text-fg-3 ml-1.5">({hiddenCount})</span>
          </Button>
        </div>
      )}

      <p className="text-[11px] text-fg-3 mt-4 flex items-center gap-1.5">
        <ShieldCheck size={12} /> {t.cofE2E} <Clock size={12} className="ml-3" /> {t.cofAutolock} : {autoLockMin > 0 ? `${autoLockMin} min` : t.cofAutolockOff}
      </p>

      {dialog?.kind === 'picker' && (
        <CategoryPicker lang={lang} onClose={() => setDialog(null)}
          onPick={cat => setDialog({ kind: 'item', draft: newItem(cat, lang) })} />
      )}
      {dialog?.kind === 'item' && (
        <ItemDialog item={dialog.item} draft={dialog.draft} lang={lang} folders={folders} allTags={allTags}
          onClose={() => setDialog(null)} onSaved={saveItem} onDeleted={trashItem} />
      )}
      {dialog?.kind === 'generator' && <GeneratorDialog onClose={() => setDialog(null)} />}
      {dialog?.kind === 'import' && <ImportDialog onClose={() => setDialog(null)} onImported={reload} />}
      {dialog?.kind === 'export' && <ExportDialog items={items.filter(i => !i._broken)} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'settings' && (
        <SettingsDialog header={header} autoLockMin={autoLockMin} setAutoLockMin={setAutoLockMin}
          onDestroyed={() => { setDialog(null); C.lockCoffre(); setPhase('setup') }}
          onRekeyed={async env => { setHeader(env); toast.success(String(t.cofChangePwDone)) }}
          onClose={() => setDialog(null)} />
      )}
    </div>
  )
}

// ================= picker de modèles =================

function CategoryPicker({ lang, onPick, onClose }: { lang: 'fr' | 'en'; onPick: (c: CategoryId) => void; onClose: () => void }) {
  const { t } = useLang()
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent title={t.cofPickTitle} className="max-w-lg">
        <p className="text-xs text-fg-3 mb-4">{t.cofPickSub}</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {CATEGORY_ORDER.map(c => {
            const def = CATEGORIES[c]
            const Icon = CAT_ICON[c]
            return (
              <button key={c} onClick={() => onPick(c)}
                className="flex items-center gap-2.5 rounded-xl border border-border p-3 text-left transition-colors hover:border-accent hover:bg-accent/6 cursor-pointer group">
                <span className={cn('w-9 h-9 rounded-lg grid place-items-center shrink-0', CAT_COLOR[c])}><Icon size={16} /></span>
                <span className="text-xs font-medium text-fg-2 group-hover:text-fg truncate">
                  {String(lang === 'en' ? def.en : def.fr)}
                </span>
              </button>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
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