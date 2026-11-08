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
  Lock, Plus, Star, Copy, Eye, Trash2, RotateCcw, KeyRound,
  LoaderCircle, Download, Upload, Settings2, Wand2, Clock, ExternalLink,
  ShieldCheck, AlertTriangle,
} from 'lucide-react'
import { useLang } from '@/i18n'
import { api, friendly, ApiError } from '@/lib/api'
import {
  Button, Badge, Dialog, DialogContent, PasswordInput, Field, Alert,
  Loading, SearchInput, SegmentedControl, Select, ConfirmDialog, RowActions,
} from '@/components/ui'
import { cn, fmtDateTime } from '@/lib/utils'
import * as C from '@/lib/coffre'
import {
  CATEGORIES, CATEGORY_ORDER, itemSubtitle, itemSearchText, firstTotp,
  mainPasswordField, newItem, type CoffreItemData, type CategoryId,
} from '@/lib/coffre-schema'
import ItemDialog from '@/components/coffre/ItemDialog'
import { GeneratorDialog, ImportDialog, ExportDialog, SettingsDialog } from '@/components/coffre/dialogs'
import { CAT_ICON, CAT_COLOR, Strength, TotpLive, useCopy, openExternalLink } from '@/components/coffre/parts'

type Phase = 'loading' | 'error' | 'setup' | 'locked' | 'unlocked'
type DialogState =
  | null
  | { kind: 'picker' }
  | { kind: 'item'; item?: C.DecryptedItem; draft?: CoffreItemData }
  | { kind: 'generator' }
  | { kind: 'import' }
  | { kind: 'export' }
  | { kind: 'settings' }

// K8 : libellés « identifiant » par langue (FR+EN, casse ignorée). Un item
// créé en interface EN (« Username ») doit garder son bouton copier-identifiant
// — même approche que les pwLabels de mainPasswordField.
const USER_LABELS = ['identifiant', 'utilisateur', 'username', 'user', 'login', 'email']

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
  const [bootErr, setBootErr] = React.useState('')
  // confirmations K2 : purge d'un item / purge de toute la corbeille
  const [confirmPurge, setConfirmPurge] = React.useState<C.DecryptedItem | null>(null)
  const [confirmPurgeAll, setConfirmPurgeAll] = React.useState(false)
  const [purgeBusy, setPurgeBusy] = React.useState(false)
  const [trashBusy, setTrashBusy] = React.useState(false)

  // ---- chargement initial : le coffre existe-t-il ? ----
  React.useEffect(() => { void boot() }, [])
  const boot = async () => {
    try {
      const h = await api('GET', '/admin/coffre')
      setHeader(h)
      setPhase(C.coffreUnlocked() ? 'unlocked' : 'locked')
      if (C.coffreUnlocked()) void reload()
    } catch (e) {
      // K1 : seul un 404 « coffre_not_created » signifie « pas encore de
      // coffre » → écran de création. Tout autre échec (réseau, session,
      // 5xx) est une ERREUR — jamais déguisée en état vide.
      if (e instanceof ApiError && e.status === 404) { setPhase('setup'); return }
      setBootErr(friendly(e))
      setPhase('error')
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
    } catch (e) { toast.error(friendly(e)) } finally { setListLoading(false) }
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
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) toast.error(String(t.cofSaveConflict))
        else toast.error(friendly(e))
        throw e
      }
    } else {
      try {
        const rec: any = await api('POST', '/admin/coffre/items', { blob_b64: blob })
        setItems(prev => [{ ...data, id: rec.id, version: rec.version, created_at: rec.created_at, updated_at: rec.updated_at, deleted_at: rec.deleted_at || null, _search: itemSearchText(data) }, ...prev])
        toast.success(String(t.cofSaved))
      } catch (e) {
        toast.error(friendly(e))
        throw e
      }
    }
  }
  const setLocalDeleted = (id: string, deleted_at: string | null) =>
    setItems(prev => prev.map(i => i.id === id ? { ...i, deleted_at } : i))
  const trashItem = async (id: string) => {
    try { await api('DELETE', `/admin/coffre/items/${id}`, undefined); toast.success(String(t.cofDeletedOk)); setLocalDeleted(id, new Date().toISOString()) } catch (e) { toast.error(friendly(e)) }
  }
  const restoreItem = async (id: string) => {
    try { await api('POST', `/admin/coffre/items/${id}/restore`); toast.success(String(t.cofRestoredOk)); setLocalDeleted(id, null) } catch (e) { toast.error(friendly(e)) }
  }
  const purgeItem = async (id: string) => {
    try { await api('POST', `/admin/coffre/items/${id}/purge`); toast.success(String(t.cofPurgedOk)); setItems(prev => prev.filter(i => i.id !== id)) } catch (e) { toast.error(friendly(e)) }
  }
  const purgeTrash = async () => {
    try { const d: any = await api('POST', '/admin/coffre/trash/purge'); toast.success(String(t.cofTrashEmptied(Number(d.purged)))); setItems(prev => prev.filter(i => !i.deleted_at)) } catch (e) { toast.error(friendly(e)) }
  }

  // copie + effacement auto 30 s (helper partagé, mécanisme corrigé K4)
  const copy = useCopy()

  // ================= écrans =================

  if (phase === 'loading') {
    return <div className="py-6"><Loading label={String(t.cofLoading)} /></div>
  }

  // K1 : échec de chargement ≠ coffre inexistant — bannière + réessayer.
  if (phase === 'error') {
    return (
      <div className="max-w-md mx-auto py-16">
        <Alert tone="danger">
          <p className="font-semibold">{String(t.loadFailed)}</p>
          {bootErr && <p className="mt-1">{bootErr}</p>}
        </Alert>
        <div className="mt-4 flex justify-center">
          <Button variant="secondary" size="sm" onClick={() => { setPhase('loading'); void boot() }}>
            <RotateCcw size={14} aria-hidden="true" />{String(t.retry)}
          </Button>
        </div>
      </div>
    )
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
            {t.cofTitle} <Badge variant="ok"><ShieldCheck size={11} aria-hidden="true" />E2E</Badge>
          </h1>
          <p className="text-sm text-fg-3 mt-1">{t.cofSub}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setDialog({ kind: 'import' })}><Upload size={14} aria-hidden="true" />{t.cofImport}</Button>
          <Button variant="ghost" size="sm" onClick={() => setDialog({ kind: 'export' })}><Download size={14} aria-hidden="true" />{t.cofExport}</Button>
          <Button variant="ghost" size="sm" onClick={() => setDialog({ kind: 'generator' })}><Wand2 size={14} aria-hidden="true" />{t.cofGen}</Button>
          <Button variant="ghost" size="sm" onClick={() => setDialog({ kind: 'settings' })}><Settings2 size={14} aria-hidden="true" />{t.cofSettings}</Button>
          <Button variant="primary" size="sm" onClick={() => setDialog({ kind: 'picker' })}><Plus size={14} aria-hidden="true" />{t.cofNew}</Button>
          <Button variant="secondary" size="sm" onClick={() => lock()} title={String(t.cofLock)} aria-label={String(t.cofLock)}><Lock size={14} aria-hidden="true" /></Button>
        </div>
      </div>

      {/* barre de filtres */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <SearchInput value={search} onChange={setSearch} placeholder={String(t.cofSearchPh)} className="w-64" />
        <SegmentedControl
          ariaLabel={String(t.viewMode)}
          value={view}
          onChange={v => setView(v)}
          options={[
            { value: 'all' as const, label: <>{String(t.cofAll)}{live > 0 && <span className="opacity-60 ml-1">{live}</span>}</> },
            { value: 'fav' as const, label: <>{String(t.cofFavorites)}{items.filter(i => i.favorite && !i.deleted_at).length > 0 && <span className="opacity-60 ml-1">{items.filter(i => i.favorite && !i.deleted_at).length}</span>}</> },
            { value: 'trash' as const, label: <>{String(t.cofTrash)}{trashN > 0 && <span className="opacity-60 ml-1">{trashN}</span>}</> },
          ]}
        />
        <Select value={catF} onChange={e => setCatF(e.target.value as any)} aria-label={String(t.cofTypeAll)}
          className="w-auto h-9 text-xs max-w-44">
          <option value="all">{t.cofTypeAll}</option>
          {CATEGORY_ORDER.map(c => <option key={c} value={c}>{String(t['cofCat' + c[0].toUpperCase() + c.slice(1)] as any)}</option>)}
        </Select>
        {folders.length > 0 && (
          <Select value={folder} onChange={e => setFolder(e.target.value)} aria-label={String(t.cofFolderAll)}
            className="w-auto h-9 text-xs max-w-40">
            <option value="">{t.cofFolderAll}</option>
            {folders.map(f => <option key={f} value={f}>{f}</option>)}
          </Select>
        )}
        {view === 'trash' && trashN > 0 && (
          <Button variant="destructive" size="sm" onClick={() => setConfirmPurgeAll(true)}><Trash2 size={13} aria-hidden="true" />{t.cofPurgeTrash}</Button>
        )}
      </div>

      {/* liste — ul/li : la « div-soup » était une liste muette pour les
          lecteurs d'écran (audit a11y) */}
      <div className="border border-border rounded-xl bg-card overflow-hidden">
        {listLoading ? (
          <div className="p-4"><Loading label={String(t.cofLoading)} /></div>
        ) : shown.length === 0 ? (
          <div className="py-16 text-center text-sm text-fg-3">
            {view === 'trash' ? t.cofEmptyTrash : t.cofEmpty}
          </div>
        ) : (
          <ul>
            {shown.map(it => {
              const Icon = CAT_ICON[it.type]
              const pw = mainPasswordField(it)
              const totp = firstTotp(it)
              const user = it.fields.find(x => USER_LABELS.includes((x.l || '').trim().toLowerCase()))?.v
              const link = it.fields.find(x => x.k === 'link' && x.v)?.v
              return (
                <li key={it.id} className={cn('flex items-center gap-3 px-4 py-3 border-b border-border last:border-b-0 hover:bg-card-2/50 transition-colors', it._broken && 'opacity-60')}>
                  <div className={cn('w-9 h-9 rounded-lg grid place-items-center shrink-0', CAT_COLOR[it.type])}>
                    {it._broken ? <AlertTriangle size={16} aria-hidden="true" /> : <Icon size={16} aria-hidden="true" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm truncate">{it.name}</span>
                      {/* favori : l'état ne doit pas être porté par la couleur seule */}
                      {it.favorite && (
                        <span role="img" aria-label={String(t.cofFavorite)} className="shrink-0 inline-flex text-warn">
                          <Star size={12} aria-hidden="true" className="fill-warn" />
                        </span>
                      )}
                      {it.folder && <Badge variant="neutral" className="shrink-0">{it.folder}</Badge>}
                      {(it.tags || []).slice(0, 2).map(tg => <Badge key={tg} variant="neutral" className="shrink-0">#{tg}</Badge>)}
                      {it._broken && <Badge variant="danger">{t.cofBroken}</Badge>}
                    </div>
                    <div className="text-xs text-fg-3 truncate">
                      {it._broken ? '—' : itemSubtitle(it) || (it.notes || '—')}
                    </div>
                  </div>
                  {!it._broken && totp && <div className="hidden md:block"><TotpLive value={totp.v} /></div>}
                  <span className="hidden lg:block text-2xs text-fg-3 w-28 text-right shrink-0">{fmtDateTime(it.updated_at)}</span>
                  {/* v1.8.6 responsive : inline (md+) avec tooltips, kebab
                      accessible sous md — 6-7 actions ne tiennent pas à 320px */}
                  <RowActions actions={[
                    ...(!it._broken && user ? [{ icon: Copy, label: String(t.cofCopyUser), onClick: () => copy(user) }] : []),
                    ...(!it._broken && pw?.v ? [{ icon: KeyRound, label: String(t.cofCopyPass), onClick: () => copy(pw.v) }] : []),
                    ...(!it._broken && link ? [{ icon: ExternalLink, label: String(t.cofOpenUri), onClick: () => { if (!openExternalLink(link)) toast.error(String(t.cofUriBlocked)) } }] : []),
                    { icon: Eye, label: String(t.viewMode), onClick: () => setDialog({ kind: 'item', item: it }) },
                    ...(view === 'trash'
                      ? [
                          { icon: RotateCcw, label: String(t.cofRestore), onClick: () => restoreItem(it.id) },
                          { icon: Trash2, label: String(t.cofPurge), onClick: () => setConfirmPurge(it), destructive: true },
                        ]
                      : [{ icon: Trash2, label: String(t.cofDelete), onClick: () => trashItem(it.id) }]),
                  ]} />
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {hiddenCount > 0 && (
        <div className="mt-3 text-center">
          <Button variant="secondary" size="sm" onClick={() => setLimit(l => l + 500)}>
            {String(t.cofShowMore(Math.min(500, hiddenCount)))}
            <span className="text-fg-3 ml-1.5">({hiddenCount})</span>
          </Button>
        </div>
      )}

      <p className="text-2xs text-fg-3 mt-4 flex items-center gap-1.5">
        <ShieldCheck size={12} aria-hidden="true" /> {t.cofE2E} <Clock size={12} aria-hidden="true" className="ml-3" /> {t.cofAutolock} : {autoLockMin > 0 ? `${autoLockMin} min` : t.cofAutolockOff}
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

      {/* K2 : purge d'un élément de corbeille — irréversible, le rituel
          ConfirmDialog est obligatoire (avant : suppression à sec) */}
      <ConfirmDialog
        open={!!confirmPurge}
        onOpenChange={o => { if (!o) setConfirmPurge(null) }}
        title={String(t.cofPurge)}
        message={String(t.cofPurgeItemConfirm(confirmPurge?.name ?? ''))}
        confirmLabel={String(t.cofPurge)}
        busy={purgeBusy}
        onConfirm={async () => {
          if (!confirmPurge) return
          setPurgeBusy(true)
          await purgeItem(confirmPurge.id)
          setPurgeBusy(false)
          setConfirmPurge(null)
        }}
      />
      {/* K2 : vider toute la corbeille — le confirm() natif devient un
          ConfirmDialog dans la charte (focus Annuler, conséquence écrite) */}
      <ConfirmDialog
        open={confirmPurgeAll}
        onOpenChange={setConfirmPurgeAll}
        title={String(t.cofPurgeTrash)}
        message={String(t.cofPurgeTrashConfirm)}
        confirmLabel={String(t.cofPurgeTrash)}
        busy={trashBusy}
        onConfirm={async () => {
          setTrashBusy(true)
          await purgeTrash()
          setTrashBusy(false)
        }}
      />
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
                <span className={cn('w-9 h-9 rounded-lg grid place-items-center shrink-0', CAT_COLOR[c])}><Icon size={16} aria-hidden="true" /></span>
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
    } catch (e) { toast.error(friendly(e)) }
    setBusy(false)
  }

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="max-w-md mx-auto py-16">
      <div className="border border-border rounded-2xl bg-card p-8">
        <div className="w-12 h-12 rounded-xl bg-accent/12 text-accent-fg grid place-items-center mb-5"><Lock size={22} aria-hidden="true" /></div>
        <h1 className="text-lg font-bold">{t.cofSetupTitle}</h1>
        <p className="text-sm text-fg-2 mt-2 leading-relaxed">{t.cofSetupIntro}</p>
        <Alert tone="warn" className="my-4">{t.cofSetupWarning}</Alert>
        <Field label={t.cofMasterPw}>
          <PasswordInput value={pw} onChange={e => setPw(e.target.value)} autoFocus autoComplete="new-password" />
        </Field>
        <div className="mt-1.5">{pw && <Strength pw={pw} />}</div>
        <Field label={t.cofMasterPw2} className="mt-4">
          <PasswordInput value={pw2} onChange={e => setPw2(e.target.value)} onKeyDown={e => e.key === 'Enter' && create()} />
        </Field>
        <Button variant="primary" className="w-full mt-6" disabled={busy || !pw || !pw2} onClick={create}>
          {busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <ShieldCheck size={15} aria-hidden="true" />} {t.cofSetupBtn}
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
        <div className="w-12 h-12 rounded-xl bg-muted text-fg-2 grid place-items-center mx-auto mb-5"><Lock size={22} aria-hidden="true" /></div>
        <h1 className="text-lg font-bold">{t.cofUnlock}</h1>
        <p className="text-xs text-fg-3 mt-1.5">{t.cofE2E}</p>
        {/* échec de déverrouillage : pattern Field error (aria-invalid +
            message lié role=alert) — avant : bordure rouge seule */}
        <Field label={t.cofMasterPw} className="text-left mt-5" error={fail ? String(t.cofUnlockFail) : undefined}>
          <PasswordInput value={pw} onChange={e => setPw(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && unlock()} autoFocus
            className={fail ? 'border-danger' : ''} />
        </Field>
        <Button variant="primary" className="w-full mt-5" disabled={busy || !pw} onClick={unlock}>
          {busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <KeyRound size={15} aria-hidden="true" />} {busy ? t.cofUnlocking : t.cofUnlockBtn}
        </Button>
      </div>
    </motion.div>
  )
}