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
  ShieldCheck, AlertTriangle, HeartPulse, Repeat, ShieldAlert,
} from 'lucide-react'
import { useLang } from '@/i18n'
import { api, friendly, ApiError } from '@/lib/api'
import {
  Button, Badge, Dialog, DialogContent, PasswordInput, Field, Alert,
  Loading, SearchInput, SegmentedControl, Select, ConfirmDialog, RowActions, Card,
} from '@/components/ui'
import { cn, fmtDate, fmtDateTime } from '@/lib/utils'
import * as C from '@/lib/coffre'
import { setCoffreKeyForAttachments } from '@/lib/coffre-attachments'
import {
  CATEGORIES, CATEGORY_ORDER, itemSubtitle, itemSearchText, firstTotp,
  mainPasswordField, newItem, type CoffreItemData, type CategoryId,
} from '@/lib/coffre-schema'
import ItemDialog from '@/components/coffre/ItemDialog'
import { GeneratorDialog, ImportDialog, ExportDialog, SettingsDialog } from '@/components/coffre/dialogs'
import { CAT_ICON, CAT_COLOR, Strength, TotpLive, useCopy, openExternalLink, StrengthBadge } from '@/components/coffre/parts'
import { computeHealth, checkHibp } from '@/lib/coffre-health'

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
  const [view, setView] = React.useState<'all' | 'fav' | 'trash' | 'health'>('all')
  const [catF, setCatF] = React.useState<'all' | CategoryId>('all')
  const [folder, setFolder] = React.useState('')
  // tri de la liste (v1.9.0) : appliqué à `shown` AVANT pagination —
  // défaut « modifiés » = l'ordre naturel du serveur (updated_at desc).
  const [sort, setSort] = React.useState<'name' | 'updated' | 'strength'>('updated')
  // raccourci « / » : focus la recherche — SearchInput n'expose pas de ref,
  // on vise l'<input> dans le wrapper (display:contents = zéro impact layout)
  const searchBoxRef = React.useRef<HTMLDivElement | null>(null)
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
    setCoffreKeyForAttachments(null) // v1.9.0 : le relais pièces jointes suit le verrou — pas de clé fantôme
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

  // ---- raccourcis clavier (v1.9.0) : n = nouvel item, / = recherche ----
  // On ignore les frappes dans les champs (sauf Échap, qui rend la main) et
  // tout ce qui arrive modifié (Ctrl/Cmd/Alt) ; un dialog ouvert gère son
  // propre clavier — les raccourcis se taisent.
  React.useEffect(() => {
    if (phase !== 'unlocked') return
    const onKey = (e: KeyboardEvent) => {
      if (dialog) return
      const tgt = e.target as HTMLElement | null
      const inField = !!tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT' || tgt.isContentEditable)
      if (e.key === 'Escape') { if (inField) tgt?.blur(); return }
      if (inField || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); setDialog({ kind: 'picker' }) }
      else if (e.key === '/') { e.preventDefault(); searchBoxRef.current?.querySelector('input')?.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, dialog])

  // ---- filtres (mémoïsés : gros coffres) ----
  const folders = React.useMemo(
    () => [...new Set(items.filter(i => !i.deleted_at).map(i => i.folder || '').filter(Boolean))].sort(),
    [items])
  const allTags = React.useMemo(
    () => [...new Set(items.flatMap(i => i.tags || []))],
    [items])
  // bits de force par item (mémoïsé : passwordStrength sur 6554 items à
  // chaque rendu, c'est non) — alimente le badge des rangées et le tri.
  const strengthById = React.useMemo(() => {
    const m = new Map<string, { bits: number; label: string }>()
    for (const it of items) {
      const pw = mainPasswordField(it)?.v
      if (pw) m.set(it.id, C.passwordStrength(pw))
    }
    return m
  }, [items])
  // compteur par dossier pour le Select (« Dossier (N) » — items vivants)
  const folderCounts = React.useMemo(() => {
    const m = new Map<string, number>()
    for (const i of items) {
      if (i.deleted_at) continue
      const f = i.folder || ''
      if (f) m.set(f, (m.get(f) || 0) + 1)
    }
    return m
  }, [items])
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
  // tri AVANT pagination : la page 1 suit toujours le critère choisi. Nom =
  // alpha insensible à la casse ; modifiés = updated_at desc (ordre naturel
  // du serveur) ; force = bits desc, items sans mot de passe en fin.
  const sortedAll = React.useMemo(() => {
    const arr = [...shownAll]
    if (sort === 'name') {
      arr.sort((a, b) => (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase()))
    } else if (sort === 'strength') {
      arr.sort((a, b) => (strengthById.get(b.id)?.bits ?? -1) - (strengthById.get(a.id)?.bits ?? -1))
    } else {
      arr.sort((a, b) => (new Date(b.updated_at).getTime() || 0) - (new Date(a.updated_at).getTime() || 0))
    }
    return arr
  }, [shownAll, sort, strengthById])
  const shown = React.useMemo(() => sortedAll.slice(0, limit), [sortedAll, limit])
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
    return <LockScreen header={header!} onUnlock={() => { setCoffreKeyForAttachments(C.coffreKey()); setPhase('unlocked'); void reload() }} />
  }

  // ---- déverrouillé ----
  const live = items.filter(i => !i.deleted_at).length
  const trashN = items.filter(i => i.deleted_at).length

  return (
    <div className="max-w-6xl" aria-keyshortcuts="n /">
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
          <Button variant="primary" size="sm" aria-keyshortcuts="n" onClick={() => setDialog({ kind: 'picker' })}><Plus size={14} aria-hidden="true" />{t.cofNew}</Button>
          <Button variant="secondary" size="sm" onClick={() => lock()} title={String(t.cofLock)} aria-label={String(t.cofLock)}><Lock size={14} aria-hidden="true" /></Button>
        </div>
      </div>

      {/* barre de filtres */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div ref={searchBoxRef} className="contents">
          <SearchInput value={search} onChange={setSearch} placeholder={String(t.cofSearchPh)} className="w-64" />
        </div>
        <SegmentedControl
          ariaLabel={String(t.viewMode)}
          value={view}
          onChange={v => setView(v)}
          options={[
            { value: 'all' as const, label: <>{String(t.cofAll)}{live > 0 && <span className="opacity-60 ml-1">{live}</span>}</> },
            { value: 'fav' as const, label: <>{String(t.cofFavorites)}{items.filter(i => i.favorite && !i.deleted_at).length > 0 && <span className="opacity-60 ml-1">{items.filter(i => i.favorite && !i.deleted_at).length}</span>}</> },
            { value: 'health' as const, label: <span className="inline-flex items-center gap-1.5"><HeartPulse size={13} aria-hidden="true" />{String(t.cofHealth)}</span> },
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
            {folders.map(f => <option key={f} value={f}>{f} ({folderCounts.get(f) ?? 0})</option>)}
          </Select>
        )}
        {/* tri (v1.9.0) — sans objet en vue Santé (elle trie elle-même) */}
        {view !== 'health' && (
          <SegmentedControl
            size="sm"
            ariaLabel={String(t.cofSortLabel)}
            value={sort}
            onChange={v => setSort(v)}
            options={[
              { value: 'name' as const, label: String(t.name) },
              { value: 'updated' as const, label: String(t.cofSortUpdated) },
              { value: 'strength' as const, label: String(t.cofSortStrength) },
            ]}
          />
        )}
        {view === 'trash' && trashN > 0 && (
          <Button variant="destructive" size="sm" onClick={() => setConfirmPurgeAll(true)}><Trash2 size={13} aria-hidden="true" />{t.cofPurgeTrash}</Button>
        )}
      </div>

      {/* rétention corbeille : le sweep serveur purge au-delà de 30 jours */}
      {view === 'trash' && <Alert tone="info" className="mb-4">{String(t.cofTrashRetention)}</Alert>}

      {view === 'health' ? (
        <HealthPanel items={items} onOpen={it => setDialog({ kind: 'item', item: it })} />
      ) : (
        <>
          {/* liste — ul/li : la « div-soup » était une liste muette pour les
              lecteurs d'écran (audit a11y) */}
          <div className="border border-border rounded-xl bg-card overflow-hidden">
            {listLoading ? (
              <div className="p-4"><Loading label={String(t.cofLoading)} /></div>
            ) : shown.length === 0 ? (
              <div className="py-16 text-center text-sm text-fg-3">
                {view === 'trash' ? t.cofEmptyTrash : t.cofEmpty}
                {view !== 'trash' && <p className="text-2xs mt-2 opacity-70">{String(t.cofShortcutsHint)}</p>}
              </div>
            ) : (
              <ul>
                {shown.map(it => {
                  const Icon = CAT_ICON[it.type]
                  const pw = mainPasswordField(it)
                  const st = strengthById.get(it.id)
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
                          {/* badge de force (v1.9.0) : pastille + title traduit,
                              bits mémoïsés par item — la couleur seule ne dit
                              rien (WCAG 1.4.1) */}
                          {st && <StrengthBadge bits={st.bits} label={st.label} />}
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
        </>
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
          onDestroyed={() => { setDialog(null); C.lockCoffre(); setCoffreKeyForAttachments(null); setPhase('setup') }}
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

// ================= vue santé (v1.9.0) =================

// une ligne d'item dans les sections santé : même langage visuel que les
// rangées du coffre, cliquable → ItemDialog (setDialog kind:'item')
function HealthRow({ it, onOpen, right }: { it: C.DecryptedItem; onOpen: (it: C.DecryptedItem) => void; right?: React.ReactNode }) {
  const Icon = CAT_ICON[it.type]
  return (
    <button type="button" onClick={() => onOpen(it)}
      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left hover:bg-card-2/60 transition-colors cursor-pointer">
      <span className={cn('w-7 h-7 rounded-lg grid place-items-center shrink-0', CAT_COLOR[it.type])}>
        {it._broken ? <AlertTriangle size={13} aria-hidden="true" /> : <Icon size={13} aria-hidden="true" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium truncate">{it.name}</span>
        <span className="block text-2xs text-fg-3 truncate">{it._broken ? '—' : itemSubtitle(it) || it.notes || '—'}</span>
      </span>
      {right !== undefined && <span className="shrink-0 text-2xs text-fg-3">{right}</span>}
    </button>
  )
}

// une section du rapport (faibles / réutilisés / anciens) : carte chapeau
// (icône + titre + compteur) puis la liste des items concernés
function HealthSection({ icon: Icon, iconCls, title, hint, count, children }: {
  icon: React.ComponentType<{ size?: number | string; className?: string }>
  iconCls: string
  title: string
  hint: string
  count: string
  children: React.ReactNode
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Icon size={14} className={iconCls} aria-hidden="true" />
        <span className="text-sm font-semibold">{title}</span>
        <Badge variant="neutral">{count}</Badge>
      </div>
      <p className="text-xs text-fg-3 mt-1">{hint}</p>
      <div className="mt-2 flex flex-col gap-0.5">{children}</div>
    </Card>
  )
}

function HealthPanel({ items, onOpen }: { items: C.DecryptedItem[]; onOpen: (it: C.DecryptedItem) => void }) {
  const { t } = useLang()
  // rapport complet — les idx référencent `items` (périmètre filtré dedans)
  const report = React.useMemo(() => computeHealth(items), [items])
  const clean = report.score === 100
  // le ton est un simple rappel : le chiffre porte l'information (WCAG)
  const tone = report.score >= 80 ? 'text-success' : report.score >= 50 ? 'text-warn' : 'text-danger'
  const barTone = report.score >= 80 ? 'bg-success' : report.score >= 50 ? 'bg-warn' : 'bg-danger'

  // ---- HIBP opt-in : état de compromission EXTERNE, jamais persisté ----
  const [hibpOn, setHibpOn] = React.useState(() => localStorage.getItem('kerviavault-hibp') === 'on')
  const [hibpRes, setHibpRes] = React.useState<Map<string, number> | null>(null)
  const [hibpBusy, setHibpBusy] = React.useState(false)
  const [hibpProg, setHibpProg] = React.useState({ done: 0, total: 0 })
  const [hibpErr, setHibpErr] = React.useState(false)
  const runHibp = async () => {
    if (hibpBusy) return
    setHibpBusy(true); setHibpErr(false); setHibpRes(null); setHibpProg({ done: 0, total: 0 })
    try {
      const m = await checkHibp(items,
        (done, total) => setHibpProg({ done, total }),
        () => { setHibpErr(true); toast.error(String(t.cofHibpError)) }) // partiel OK
      setHibpRes(m)
    } catch {
      setHibpErr(true) // panne totale : rien à montrer
    } finally {
      setHibpBusy(false)
    }
  }
  // items compromis = mot de passe principal avec count HIBP > 0
  const compromised = React.useMemo(() => {
    const rows: { item: C.DecryptedItem; count: number }[] = []
    if (!hibpRes) return { rows, pwCount: 0 }
    const pws = new Set<string>()
    for (const it of items) {
      if (it.deleted_at) continue
      const pw = mainPasswordField(it)?.v
      if (!pw) continue
      const count = hibpRes.get(pw) || 0
      if (count > 0) { rows.push({ item: it, count }); pws.add(pw) }
    }
    return { rows, pwCount: pws.size }
  }, [items, hibpRes])

  return (
    <div className="flex flex-col gap-4">
      {/* en-tête : score XL + barre de progression */}
      <Card className="p-5">
        <div className="flex items-center gap-5 flex-wrap">
          <div className={cn('text-4xl font-bold tabular-nums leading-none', tone)}>{report.score}</div>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-fg-3">{String(t.cofHealthScore)}</p>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden mt-2 max-w-64">
              <div className={cn('h-full rounded-full transition-all', barTone)} style={{ width: `${report.score}%` }} />
            </div>
          </div>
        </div>
      </Card>
      {clean && <Alert tone="success">{String(t.cofHealthOk)}</Alert>}

      {report.weak.length > 0 && (
        <HealthSection icon={AlertTriangle} iconCls="text-danger" title={String(t.cofHealthWeakTitle)}
          hint={String(t.cofHealthWeakHint)} count={String(t.cofHealthItems(report.weak.length))}>
          {report.weak.map(w => (
            <HealthRow key={items[w.idx].id} it={items[w.idx]} onOpen={onOpen} right={<>{w.bits} bits</>} />
          ))}
        </HealthSection>
      )}

      {report.reused.length > 0 && (
        <HealthSection icon={Repeat} iconCls="text-warn" title={String(t.cofHealthReusedTitle)}
          hint={String(t.cofHealthReusedHint)}
          count={String(t.cofHealthItems(report.reused.reduce((s, g) => s + g.count, 0)))}>
          {report.reused.map((g, i) => (
            <div key={i} className="flex flex-col gap-0.5">
              <p className="px-3"><Badge variant="warn">{String(t.cofHealthItems(g.count))}</Badge></p>
              {g.idxs.map(idx => <HealthRow key={items[idx].id} it={items[idx]} onOpen={onOpen} />)}
            </div>
          ))}
        </HealthSection>
      )}

      {report.old.length > 0 && (
        <HealthSection icon={Clock} iconCls="text-info" title={String(t.cofHealthOldTitle)}
          hint={String(t.cofHealthOldHint(180))} count={String(t.cofHealthItems(report.old.length))}>
          {report.old.map(o => (
            <HealthRow key={items[o.idx].id} it={items[o.idx]} onOpen={onOpen}
              right={fmtDate(items[o.idx].password_updated_at || items[o.idx].updated_at)} />
          ))}
        </HealthSection>
      )}

      {/* HIBP : opt-in explicite — l'état de compromission est externe au
          coffre, il n'entre PAS dans le score (contrat §1) */}
      <Card className="p-4">
        <div className="flex items-center gap-2">
          <ShieldAlert size={14} className="text-danger" aria-hidden="true" />
          <span className="text-sm font-semibold">{String(t.cofHibpTitle)}</span>
        </div>
        <p className="text-xs text-fg-3 mt-1">{String(t.cofHibpHint)}</p>
        <label className="flex items-start gap-2.5 cursor-pointer select-none mt-3">
          <input type="checkbox" checked={hibpOn}
            onChange={e => {
              const v = e.target.checked
              localStorage.setItem('kerviavault-hibp', v ? 'on' : 'off')
              setHibpOn(v)
              if (!v) { setHibpRes(null); setHibpErr(false) }
            }}
            className="mt-0.5 accent-[var(--color-accent)] w-4 h-4 cursor-pointer" />
          <span className="text-xs font-medium">{String(t.cofHibpOptIn)}</span>
        </label>
        <p className="text-2xs text-fg-3 mt-1.5">{String(t.cofHibpPrivacy)}</p>
        {hibpOn && (
          <div className="mt-3 flex items-center gap-3 flex-wrap">
            <Button variant="secondary" size="sm" disabled={hibpBusy} onClick={() => { void runHibp() }}>
              {hibpBusy && <LoaderCircle size={13} className="animate-spin" aria-hidden="true" />}
              {String(t.cofHibpCheck)}
            </Button>
            {hibpBusy && <p role="status" className="text-2xs text-fg-3">{hibpProg.done}/{hibpProg.total}</p>}
          </div>
        )}
        {!hibpBusy && hibpRes && (
          compromised.rows.length > 0 ? (
            <>
              <p className="text-xs font-semibold text-danger mt-3">{String(t.cofHibpCompromised(compromised.pwCount))}</p>
              <div className="mt-1 flex flex-col gap-0.5">
                {compromised.rows.map(c => (
                  <HealthRow key={c.item.id} it={c.item} onOpen={onOpen} right={<Badge variant="danger">{c.count}</Badge>} />
                ))}
              </div>
            </>
          ) : hibpErr
            ? <p className="text-xs text-danger mt-3">{String(t.cofHibpError)}</p>
            : <p className="text-xs text-success mt-3">{String(t.cofHibpClean)}</p>
        )}
        {!hibpBusy && !hibpRes && hibpErr && <p className="text-xs text-danger mt-3">{String(t.cofHibpError)}</p>}
      </Card>
    </div>
  )
}