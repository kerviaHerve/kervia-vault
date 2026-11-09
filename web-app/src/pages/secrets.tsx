import * as React from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Plus, Copy, Eye, EyeOff, Trash2, KeyRound, LoaderCircle, Pencil, Search, X, FolderInput, Share2, Archive, Ban } from 'lucide-react'
import { toast } from 'sonner'
import { useLang } from '@/i18n'
import { api, friendly } from '@/lib/api'
import { copyText } from '@/lib/clipboard'
import {
  Button, Badge, Dialog, DialogContent, Input, PasswordInput, Field, Textarea,
  ConfirmDialog, SegmentedControl, Table, Th, Td, SortTh, Alert, Loading,
  SearchInput, PageHeader, EmptyState, RowActions,
} from '@/components/ui'
import TemplatePicker from '@/components/TemplatePicker'
import { fmtDateTime } from '@/lib/utils'
import { useSort } from '@/lib/useSort'

// AgeBadge : âge du secret en jours — rappel de rotation au fil de la liste.
// La couleur suit l'ancienneté : frais < 30 j · à surveiller 30-90 j ·
// à rotationner > 90 j (le seuil n'est qu'un repère, pas une règle).
// v1.8.6 : l'urgence n'est plus portée par la couleur seule — le sens est
// annoncé aux lecteurs d'écran (sr-only) et le texte respecte les 11px mini.
function AgeBadge({ iso }: { iso: string }) {
  const { t } = useLang()
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  const tone = days > 90 ? 'text-danger' : days > 30 ? 'text-warn' : 'text-fg-3'
  return (
    <span className={`ml-1.5 text-2xs font-bold ${tone}`} title={String(t.ageHint)}>
      <span className="sr-only">({String(t.ageHint)}) </span>
      {days}{String(t.dayShort)}
    </span>
  )
}

// SecretNoteView : la note d'un secret en consultation — annotation privée
// (contexte, rotation, contact…), PAS un credential : affichage direct, sans
// masquage ni œil. Jamais dévoilée par les liens de partage (le backend la
// garde hors des partages). Pas de note → rien (pas d'état vide inutile).
function SecretNoteView({ note, t }: { note: string; t: any }) {
  return (
    <div className="rounded-lg border border-border bg-bg p-3">
      <p className="text-2xs uppercase tracking-wide text-fg-3">{String(t.secretNote)}</p>
      <p className="mt-1 text-xs text-fg-2 whitespace-pre-wrap break-words">{note}</p>
    </div>
  )
}

interface Template {
  key: string; name: string; category: string; description?: string
  fields: { name: string; label: string; type: string; required: boolean; placeholder?: string; help?: string }[]
}


// SecretDialog: reveal ET edition d'un secret, en dialog (pas dans la
// cellule du tableau). mode='reveal': carte de champs labellisés avec
// masquage des champs sensibles. mode='edit': un Input par champ du
// template, pré-rempli — le JSON est reconstitué à la sauvegarde.
function SecretDialog({ secret, mode, onClose, onSaved, t, templates }: {
  secret: any; mode: 'reveal' | 'edit'; onClose: () => void;
  onSaved?: () => void; t: any; templates: any[]
}) {
  const [data, setData] = React.useState<any>(null)   // {fields, value, template, note}
  const [edits, setEdits] = React.useState<Record<string, string>>({})
  const [snapshot, setSnapshot] = React.useState<Record<string, string>>({}) // état initial — garde dirty
  const [showMap, setShowMap] = React.useState<Record<string, boolean>>({})
  const [busy, setBusy] = React.useState(false)
  const [loadErr, setLoadErr] = React.useState(false) // échec du reveal ≠ secret vide
  const [editMode, setEditMode] = React.useState(mode === 'edit')
  const [keyName, setKeyName] = React.useState(secret.key)
  const [askDirty, setAskDirty] = React.useState(false)

  const fetchReveal = () => {
    setLoadErr(false)
    api('GET', `/admin/secrets/reveal?id=${secret.id}`).then(d => {
      setData(d)
      const e: Record<string, string> = {}
      if (d.fields?.length) { for (const f of (d.fields || [])) e[f.label] = f.value }
      else { e['__raw__'] = d.value ?? '' }
      e['__note__'] = d.note ?? ''   // dans edits ET snapshot → la garde dirty la couvre
      setEdits(e)
      setSnapshot(e)
    }).catch(() => setLoadErr(true))   // bannière + retry dans le dialog, jamais un faux « vide »
  }

  React.useEffect(() => { fetchReveal() }, [secret.id])

  const sensitive = (f: any) => f.type === 'password' || /secret|password|token|key|private/i.test(f.label)
  const copy = async (v: string) => {
    const ok = await copyText(v)
    if (ok) { toast.success(String(t.copied)) } else { toast.error(String(t.copyFailed)) }
  }

  // Garde dirty : Escape / clic dehors / croix ne ferment un formulaire
  // modifié qu'après confirmation (comparaison à l'instantané initial).
  const dirty = editMode && (
    keyName.trim() !== secret.key ||
    Object.keys(edits).some(k => (edits[k] ?? '') !== (snapshot[k] ?? ''))
  )

  const save = async () => {
    if (busy) return
    setBusy(true)
    try {
      const body: any = {}
      if (keyName.trim() !== secret.key) body.key = keyName.trim()
      // templated: reconstruit l'objet {field_name: value} via le template
      if (data?.fields?.length) {
        const tpl = templates.find((x: any) => x.key === data.template)
        const values: Record<string, string> = {}
        for (const f of (tpl?.fields || [])) {
          const v = edits[f.label]
          if (v !== undefined && v !== '') values[f.name] = v
        }
        if (Object.keys(values).length) body.values = values
      } else {
        const raw = edits['__raw__'] ?? data?.value ?? ''
        if (raw !== '') body.value = raw
      }
      // note : TOUJOURS envoyée en édition (le backend distingue via un ptr
      // Go : absent = préservé, vide = effacée — ne l'envoyer que changée
      // rendrait une note impossible à vider). Garde data : un save pendant
      // le chargement ne doit rien envoyer du tout.
      if (data) body.note = edits['__note__'] ?? ''
      if (Object.keys(body).length === 0) { onClose(); setBusy(false); return }
      await api('PATCH', `/admin/secrets/${secret.id}`, body)
      toast.success(String(t.secretUpdated))
      onClose(); onSaved?.()
    } catch (e: any) { toast.error(friendly(e)) }
    setBusy(false)
  }

  return (
    <>
      <Dialog open onOpenChange={o => { if (!o) { if (dirty) setAskDirty(true); else onClose() } }}>
        <DialogContent
          title={secret.key}
          className="max-w-xl max-h-[85vh] overflow-y-auto"
          onEscapeKeyDown={e => { if (dirty) { e.preventDefault(); setAskDirty(true) } }}
          onInteractOutside={e => { if (dirty) { e.preventDefault(); setAskDirty(true) } }}
        >
          {loadErr ? (
            // échec du reveal ≠ valeur vide : bannière + retry, édition bloquée
            <Alert tone="danger">
              <p>{String(t.revealFailed)}</p>
              <Button size="sm" className="mt-2" onClick={fetchReveal}>{String(t.retry)}</Button>
            </Alert>
          ) : data === null ? (
            <Loading label={String(t.loading)} rows={3} />
          ) : data.fields?.length ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge variant="accent">{data.template}</Badge>
                <span className="text-2xs text-fg-3">v{secret.version}</span>
                <div className="flex-1" />
                <Button size="sm" variant={editMode ? 'primary' : 'ghost'} onClick={() => setEditMode(!editMode)} disabled={loadErr}>
                  <Pencil size={13} /> {editMode ? String(t.viewMode) : String(t.editBtn)}
                </Button>
              </div>
              {editMode && (
                <Field label={String(t.secretKey)}>
                  <Input value={keyName} onChange={(e: any) => setKeyName(e.target.value)} className="font-mono" />
                </Field>
              )}
              <div className="space-y-2">
                {(data.fields || []).map((f: any, i: number) => (
                  <div key={i} className="group">
                    <div className="flex items-center gap-2 text-2xs text-fg-3 mb-1">
                      <span className="uppercase tracking-wide">{f.label}</span>
                      {editMode ? null : (
                        <button type="button" onClick={() => copy(f.value)} aria-label={String(t.copy)}
                          className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 cursor-pointer hover:text-fg transition-opacity">
                          <Copy size={11} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                    {editMode ? (
                      sensitive(f) ? (
                        <PasswordInput
                          value={edits[f.label] ?? ''}
                          onChange={(e: any) => setEdits((x: any) => ({ ...x, [f.label]: e.target.value }))}
                          autoComplete="off"
                        />
                      ) : (
                        <Input
                          value={edits[f.label] ?? ''}
                          onChange={(e: any) => setEdits((x: any) => ({ ...x, [f.label]: e.target.value }))}
                          className="font-mono"
                          autoComplete="off"
                        />
                      )
                    ) : sensitive(f) ? (
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-accent-fg break-all">
                          {showMap[f.label] ? f.value : '•'.repeat(Math.min(f.value.length, 20))}
                        </span>
                        <button type="button"
                          onClick={() => setShowMap((x: any) => ({ ...x, [f.label]: !x[f.label] }))}
                          aria-label={String(showMap[f.label] ? t.hide : t.show)}
                          aria-pressed={!!showMap[f.label]}
                          className="cursor-pointer text-fg-3 hover:text-fg">
                          {showMap[f.label]
                            ? <EyeOff size={12} aria-hidden="true" />
                            : <Eye size={12} aria-hidden="true" />}
                        </button>
                        <button type="button" onClick={() => copy(f.value)} aria-label={String(t.copy)} className="cursor-pointer text-fg-3 hover:text-fg"><Copy size={12} aria-hidden="true" /></button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-fg break-all">{f.value || '—'}</span>
                        <button type="button" onClick={() => copy(f.value)} aria-label={String(t.copy)} className="cursor-pointer text-fg-3 hover:text-fg"><Copy size={12} aria-hidden="true" /></button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {editMode && (
                <div>
                  <p className="text-2xs text-fg-3">{String(t.editFieldHint)}</p>
                  <p className="text-2xs text-fg-3 mt-1">{String(t.fieldKeepNote)}</p>
                </div>
              )}
            </div>
          ) : (
            // free-form
            <div className="space-y-3">
              <Badge variant="neutral">{String(t.free)}</Badge>
              {editMode ? (
                <Textarea
                  value={edits['__raw__'] ?? data.value ?? ''}
                  onChange={(e: any) => setEdits((x: any) => ({ ...x, __raw__: e.target.value }))}
                  className="h-40 resize-y"
                />
              ) : (
                <div className="flex items-start gap-2">
                  {/* security UX : la valeur libre est masquée par défaut, œil pour révéler */}
                  <pre className="flex-1 font-mono text-xs text-fg whitespace-pre-wrap break-all bg-bg border border-border rounded-lg p-3">
                    {showMap['__raw__']
                      ? (data.value || '—')
                      : (data.value ? '•'.repeat(Math.min(data.value.length, 20)) : '—')}
                  </pre>
                  <button type="button"
                    onClick={() => setShowMap((x: any) => ({ ...x, __raw__: !x['__raw__'] }))}
                    aria-label={String(showMap['__raw__'] ? t.hide : t.show)}
                    aria-pressed={!!showMap['__raw__']}
                    className="cursor-pointer text-fg-3 hover:text-fg">
                    {showMap['__raw__']
                      ? <EyeOff size={14} aria-hidden="true" />
                      : <Eye size={14} aria-hidden="true" />}
                  </button>
                </div>
              )}
            </div>
          )}
          {/* note : sous la valeur, dans les DEUX modes. Édition → Textarea
              (toujours envoyée, vide = effacée côté backend). Consultation →
              bloc discret sans masquage (annotation, pas un credential) ;
              absente → rien. mt-3 : DialogContent n'applique aucun gap
              vertical entre ses enfants. */}
          {data && (editMode ? (
            <Field label={String(t.secretNote)} help={String(t.secretNoteHelp)} className="mt-3">
              <Textarea
                value={edits['__note__'] ?? ''}
                onChange={(e: any) => setEdits((x: any) => ({ ...x, __note__: e.target.value }))}
                className="h-24 resize-y"
              />
            </Field>
          ) : data.note ? (
            <div className="mt-3">
              <SecretNoteView note={data.note} t={t} />
            </div>
          ) : null)}
          <div className="flex justify-end gap-2 pt-2">
            <Button onClick={() => { if (dirty) setAskDirty(true); else onClose() }}>{String(t.close)}</Button>
            {editMode && !loadErr && (
              <Button variant="primary" onClick={save} disabled={busy}>
                {busy ? <LoaderCircle size={15} className="animate-spin" /> : String(t.save)}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
      {/* garde dirty : confirmation avant d'abandonner des modifications */}
      <ConfirmDialog
        open={askDirty}
        onOpenChange={setAskDirty}
        title={String(t.dirtyTitle)}
        message={String(t.dirtyMsg)}
        confirmLabel={String(t.discard)}
        onConfirm={onClose}
      />
    </>
  )
}

export default function Secrets() {
  const { t } = useLang()
  const [vaults, setVaults] = React.useState<any[] | null>(null)  // null = chargement
  const [vaultsErr, setVaultsErr] = React.useState(false)
  const [vault, setVault] = React.useState('')
  const [secrets, setSecrets] = React.useState<any[] | null>(null)
  const [listErr, setListErr] = React.useState(false)
  const [templates, setTemplates] = React.useState<Template[]>([])
  const [open, setOpen] = React.useState(false)
  const [dialogSecret, setDialogSecret] = React.useState<any | null>(null)
  const [dialogMode, setDialogMode] = React.useState<'reveal' | 'edit'>('reveal')

  const loadVaults = () => {
    setVaultsErr(false)
    api('GET', '/admin/vaults').then((v: any[]) => { setVaults(v); if (v.length) setVault(v[0].name) })
      .catch(() => setVaultsErr(true))   // échec ≠ « aucun vault » : bannière + retry
  }
  React.useEffect(() => { loadVaults() }, [])
  React.useEffect(() => { api('GET', '/admin/templates').then(setTemplates).catch(e => toast.error(friendly(e))) }, [])
  React.useEffect(() => { if (vault) load() }, [vault])

  const load = () => {
    setListErr(false)
    api('GET', `/admin/secrets?vault=${vault}`).then(setSecrets).catch(() => setListErr(true))
  }
  const reveal = (s: any) => { setDialogMode('reveal'); setDialogSecret(s) }
  const revealSearch = (sr: any) => { setDialogMode('reveal'); setDialogSecret(sr) }

  // quickCopy: copie RAPIDE depuis la liste sans ouvrir le dialog.
  // templated → le champ principal (premier password/token/key/secret);
  // free-form → la valeur. Le toast nomme le champ copié, et la copie passe
  // par copyText (fallback HTTP — jamais de faux succès silencieux).
  const quickCopy = async (s: any) => {
    try {
      const d = await api('GET', `/admin/secrets/reveal?id=${s.id}`)
      let v = d.value
      let field = s.key                      // free-form : le nom du secret
      if (d.fields?.length) {
        const main = d.fields.find((f: any) => /secret|password|token|key|private/i.test(f.label))
        v = main ? main.value : d.fields[0].value
        field = (main ?? d.fields[0]).label
      }
      if (!v) { toast.error(String(t.nothingToCopy)); return }
      const ok = await copyText(v)
      if (ok) { toast.success(`${String(t.copied)} — ${field}`) } else { toast.error(String(t.copyFailed)) }
    } catch (e: any) { toast.error(friendly(e)) }
  }

  // suppression : ConfirmDialog (focus Annuler, conséquence écrite) + toast friendly
  const [confirmDel, setConfirmDel] = React.useState<{ id: string; key: string } | null>(null)
  const [delBusy, setDelBusy] = React.useState(false)
  const del = async () => {
    if (!confirmDel || delBusy) return
    setDelBusy(true)
    try {
      await api('POST', `/admin/secrets/${confirmDel.id}/delete`)
      toast.success(String(t.secretDeleted))
      setConfirmDel(null)
      load()
    } catch (e: any) { toast.error(friendly(e)) }
    setDelBusy(false)
  }

  const [query, setQuery] = React.useState('')
  const [searchResults, setSearchResults] = React.useState<any[] | null>(null)
  const [searchErr, setSearchErr] = React.useState(false)
  const searchTimer = React.useRef<any>(null)

  // Tri des secrets du vault actif (client-side, liste déjà chargée)
  const { sorted: sortedSecrets, sortKey, sortDir, toggle } = useSort<any>(secrets, 'key', 'asc')
  const { sorted: sortedSearch, sortKey: sKey, sortDir: sDir, toggle: sToggle } = useSort<any>(searchResults, 'key', 'asc')

  // sélection multiple (vue vault uniquement — les actions bulk opèrent par id)
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = React.useState(false)
  const [confirmBulk, setConfirmBulk] = React.useState(false)
  const [moveOpen, setMoveOpen] = React.useState(false)
  const [shareSecret, setShareSecret] = React.useState<any | null>(null)

  const toggleSel = (id: string) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  const allSelected = (sortedSecrets?.length ?? 0) > 0 && (sortedSecrets ?? []).every((s: any) => selected.has(s.id))
  const toggleAll = () => setSelected(prev =>
    allSelected ? new Set() : new Set((sortedSecrets ?? []).map((s: any) => s.id)))

  // vide la sélection quand on change de vault ou qu'on recharge
  React.useEffect(() => { setSelected(new Set()) }, [vault])

  const bulkDelete = async () => {
    if (!selected.size || bulkBusy) return
    setBulkBusy(true)
    try {
      const r = await api('POST', '/admin/secrets/bulk-delete', { ids: [...selected] })
      const ok = (r.results || []).filter((x: any) => x.ok).length
      if (ok < selected.size) {
        toast.error(String(t.bulkPartial(ok, selected.size, String(t.verbDeleted))))
      } else {
        toast.success(String(t.bulkDeleted(ok)))
      }
      setSelected(new Set()); load()
    } catch (e: any) { toast.error(friendly(e)) }
    setBulkBusy(false)
  }

  const bulkMove = async (target: string) => {
    if (!selected.size || bulkBusy || !target) return
    if (target === vault) { toast.error(String(t.bulkSameVault)); return }
    setBulkBusy(true)
    try {
      const r = await api('POST', '/admin/secrets/bulk-move', { ids: [...selected], target_vault: target })
      const ok = (r.results || []).filter((x: any) => x.ok).length
      if (ok < selected.size) {
        toast.error(String(t.bulkPartial(ok, selected.size, String(t.verbMoved))))
      } else {
        toast.success(String(t.bulkMoved(ok)))
      }
      setSelected(new Set()); setMoveOpen(false); load()
    } catch (e: any) { toast.error(friendly(e)) }
    setBulkBusy(false)
  }

  const runSearch = (q: string) => {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    if (!q.trim()) { setSearchResults(null); setSearchErr(false); return }
    searchTimer.current = setTimeout(async () => {
      try {
        const r = await api('GET', `/admin/secrets/search?q=${encodeURIComponent(q.trim())}`)
        setSearchResults(Array.isArray(r) ? r : [])
        setSearchErr(false)
      } catch {
        // erreur ≠ « aucun résultat » : bandeau dédié au-dessus de la table
        setSearchErr(true)
        setSearchResults([])
      }
    }, 200)
  }
  React.useEffect(() => { runSearch(query) }, [query])
  const searching = query.trim() !== ''

  const openEdit = (s: any) => { setDialogMode('edit'); setDialogSecret(s) }

  // échec du chargement ≠ « aucun vault » : bannière + retry
  if (vaultsErr) return (
    <div>
      <PageHeader title={String(t.secretsTitle)} sub={String(t.secretsSub)} />
      <Alert tone="danger">
        <p>{String(t.loadFailed)}</p>
        <Button size="sm" className="mt-2" onClick={loadVaults}>{String(t.retry)}</Button>
      </Alert>
    </div>
  )

  if (vaults === null) return (
    <div>
      <PageHeader title={String(t.secretsTitle)} sub={String(t.secretsSub)} />
      <Loading label={String(t.loading)} />
    </div>
  )

  // aucun vault : on guide vers la page vaults (même hash que la nav)
  if (!vaults.length) return (
    <div>
      <PageHeader title={String(t.secretsTitle)} sub={String(t.secretsSub)} />
      <EmptyState
        icon={<Archive size={24} aria-hidden="true" />}
        title={String(t.noVaults)}
        action={<Button variant="primary" onClick={() => { window.location.hash = 'vaults' }}>{String(t.vaults)}</Button>}
      />
    </div>
  )

  return (
    <div>
      <PageHeader
        title={String(t.secretsTitle)}
        sub={String(t.secretsSub)}
        actions={<>
          <SearchInput value={query} onChange={setQuery} placeholder={String(t.search)} className="w-48" />
          <SegmentedControl
            size="sm"
            options={vaults.map(v => ({ value: v.name, label: v.name }))}
            value={vault}
            onChange={setVault}
            ariaLabel={String(t.vault)}
          />
          <Button variant="primary" onClick={() => setOpen(true)}><Plus size={16} /> {String(t.newSecret)}</Button>
        </>}
      />

      {/* barre d'actions groupées — visible dès qu'au moins un secret est sélectionné */}
      <AnimatePresence>
        {selected.size > 0 && !searching && (
          <motion.div
            role="status"
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
            className="mb-3 flex items-center gap-3 rounded-xl border border-accent/40 bg-accent/10 px-4 py-2.5"
          >
            <span className="text-sm font-semibold text-accent-fg">{String(t.selected(selected.size))}</span>
            <div className="flex-1" />
            <Button variant="ghost" size="sm" onClick={toggleAll}>
              {allSelected ? String(t.clearSelection) : String(t.selectAll)}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())} aria-label={String(t.clearSelection)}>
              <X size={13} aria-hidden="true" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setMoveOpen(true)}>
              <FolderInput size={14} aria-hidden="true" /> {String(t.bulkMove)}
            </Button>
            <Button variant="ghost" size="sm" className="text-danger hover:bg-danger/10" onClick={() => setConfirmBulk(true)} disabled={bulkBusy}>
              <Trash2 size={14} aria-hidden="true" /> {String(t.bulkDelete)}
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      {searching ? (
      <div>
        {/* erreur de recherche ≠ aucun résultat : bandeau dédié au-dessus de la table */}
        {searchErr && <Alert tone="danger" className="mb-3">{String(t.searchFailed)}</Alert>}
        <p className="mb-3 text-xs text-fg-2" role="status">
          {String(t.resultsFor(searchResults?.length ?? 0, query.trim()))}
        </p>
        <Table>
          <thead>
            <tr>
              <SortTh active={sKey === 'key'} dir={sDir} onSort={() => sToggle('key')}>{String(t.key)}</SortTh>
              <SortTh active={sKey === 'vault_name'} dir={sDir} onSort={() => sToggle('vault_name')}>{String(t.vault)}</SortTh>
              <SortTh active={sKey === 'template'} dir={sDir} onSort={() => sToggle('template')}>{String(t.type)}</SortTh>
              <Th>{String(t.value)}</Th>
              <SortTh active={sKey === 'version'} dir={sDir} onSort={() => sToggle('version')}>{String(t.version)}</SortTh>
              <SortTh active={sKey === 'updated_at'} dir={sDir} onSort={() => sToggle('updated_at')}>{String(t.updated)}</SortTh>
              <Th className="sr-only">{String(t.actions)}</Th>
            </tr>
          </thead>
          <tbody>
            {(sortedSearch ?? []).map((sr: any) => (
              <tr key={sr.id} className="hover:bg-card-2/50 transition-colors">
                <Td><span className="font-semibold">{sr.key}</span></Td>
                <Td><Badge variant="accent">{sr.vault_name}</Badge></Td>
                <Td><Badge variant="neutral">{sr.template || String(t.free)}</Badge></Td>
                <Td>
                  <Button variant="ghost" size="sm" onClick={() => revealSearch(sr)}>
                    <Eye size={13} aria-hidden="true" /> {String(t.reveal)}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => quickCopy(sr)} title={String(t.copy)} aria-label={String(t.copy)}>
                    <Copy size={13} aria-hidden="true" />
                  </Button>
                </Td>
                <Td className="text-xs text-fg-2">v{sr.version}</Td>
                <Td className="text-xs text-fg-2 whitespace-nowrap">
                  {fmtDateTime(sr.updated_at)} <AgeBadge iso={sr.updated_at} />
                </Td>
                <Td></Td>
              </tr>
            ))}
            {!searchErr && sortedSearch?.length === 0 && (
              <tr><Td colSpan={7} className="py-14 text-center text-fg-3">
                <Search className="mx-auto mb-3 opacity-50" size={32} aria-hidden="true" />{String(t.noResults)}</Td></tr>
            )}
          </tbody>
        </Table>
      </div>
      ) : listErr ? (
        // échec du chargement ≠ vault vide : bannière + retry
        <Alert tone="danger">
          <p>{String(t.loadFailed)}</p>
          <Button size="sm" className="mt-2" onClick={load}>{String(t.retry)}</Button>
        </Alert>
      ) : secrets === null ? (
        <Loading label={String(t.loading)} />
      ) : (
      <Table>
        <thead>
          <tr>
            <Th className="w-10">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                className="h-4 w-4 cursor-pointer accent-[var(--color-accent)]"
                title={String(t.selectAll)}
                aria-label={String(t.selectAll)}
              />
            </Th>
            <SortTh active={sortKey === 'key'} dir={sortDir} onSort={() => toggle('key')}>{String(t.key)}</SortTh>
            <SortTh active={sortKey === 'template'} dir={sortDir} onSort={() => toggle('template')}>{String(t.type)}</SortTh>
            <Th>{String(t.value)}</Th>
            <SortTh active={sortKey === 'version'} dir={sortDir} onSort={() => toggle('version')}>{String(t.version)}</SortTh>
            <SortTh active={sortKey === 'updated_at'} dir={sortDir} onSort={() => toggle('updated_at')}>{String(t.updated)}</SortTh>
            <Th className="sr-only">{String(t.actions)}</Th>
          </tr>
        </thead>
        <tbody>
          <AnimatePresence>
            {(sortedSecrets ?? []).map(s => (
              <motion.tr
                key={s.id}
                layout
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="hover:bg-card-2/50 transition-colors"
              >
                <Td>
                  <input
                    type="checkbox"
                    checked={selected.has(s.id)}
                    onChange={() => toggleSel(s.id)}
                    className="h-4 w-4 cursor-pointer accent-[var(--color-accent)]"
                    aria-label={String(t.selectRow(s.key))}
                  />
                </Td>
                <Td><span className="font-semibold">{s.key}</span></Td>
                <Td>
                  <Badge variant={s.template ? 'accent' : 'neutral'}>{s.template || String(t.free)}</Badge>
                </Td>
                <Td>
                  <span className="font-mono text-fg-3">••••••••••••</span>
                </Td>
                <Td className="text-xs text-fg-2">v{s.version}</Td>
                <Td className="text-xs text-fg-2 whitespace-nowrap">
                  {fmtDateTime(s.updated_at)} <AgeBadge iso={s.updated_at} />
                </Td>
                <Td className="text-right whitespace-nowrap">
                  {/* v1.8.6 responsive : boutons inline (md+) avec tooltips,
                      kebab accessible sous md — 5 actions ne tiennent pas à 320px */}
                  <RowActions actions={[
                    { icon: Eye, label: String(t.reveal), onClick: () => reveal(s) },
                    { icon: Copy, label: String(t.copy), onClick: () => quickCopy(s) },
                    { icon: Share2, label: String(t.shareTitle), onClick: () => setShareSecret(s) },
                    { icon: Pencil, label: String(t.editBtn), onClick: () => openEdit(s) },
                    { icon: Trash2, label: String(t.delete), onClick: () => setConfirmDel({ id: s.id, key: s.key }), destructive: true },
                  ]} />
                </Td>
              </motion.tr>
            ))}
          </AnimatePresence>
          {secrets?.length === 0 && (
            <tr><Td colSpan={7} className="py-14 text-center text-fg-3">
              <KeyRound className="mx-auto mb-3 opacity-50" size={32} aria-hidden="true" />
              {String(t.emptyVault)}</Td></tr>
          )}
        </tbody>
      </Table>
      )}

      {/* secret dialog: reveal + edit (templated = champs, jamais de JSON) */}
      {dialogSecret && (
        <SecretDialog
          secret={dialogSecret} mode={dialogMode} t={t} templates={templates}
          onClose={() => setDialogSecret(null)}
          onSaved={load}
        />
      )}

      {/* partage one-time : TTL, URL affichée une seule fois */}
      {shareSecret && (
        <ShareDialog secret={shareSecret} t={t} onClose={() => setShareSecret(null)} />
      )}

      {/* suppressions : ConfirmDialog — focus Annuler, conséquence écrite */}
      <ConfirmDialog
        open={!!confirmDel}
        onOpenChange={o => setConfirmDel(o ? confirmDel : null)}
        title={String(t.delete)}
        message={String(t.deleteConfirm(confirmDel?.key ?? ''))}
        confirmLabel={String(t.delete)}
        busy={delBusy}
        onConfirm={del}
      />
      <ConfirmDialog
        open={confirmBulk}
        onOpenChange={setConfirmBulk}
        title={String(t.bulkDelete)}
        message={String(t.bulkDeleteConfirm(selected.size))}
        confirmLabel={String(t.bulkDelete)}
        busy={bulkBusy}
        onConfirm={bulkDelete}
      />

      <CreateDialog
        open={open} setOpen={setOpen} vault={vault} templates={templates}
        onCreated={() => { setOpen(false); load() }}
      />

      {/* bulk move: choisir le vault cible */}
      <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
        {moveOpen && (
          <DialogContent title={String(t.bulkMoveTitle)} className="max-w-sm">
            <p className="text-sm text-fg-2 mb-3">{String(t.selected(selected.size))}</p>
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {vaults.filter(v => v.name !== vault).map(v => (
                <button
                  key={v.id}
                  onClick={() => bulkMove(v.name)}
                  disabled={bulkBusy}
                  className="w-full flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm text-fg hover:border-accent hover:text-accent-fg transition-colors cursor-pointer disabled:opacity-50"
                >
                  <FolderInput size={14} />
                  <span className="font-medium">{v.name}</span>
                </button>
              ))}
              {vaults.filter(v => v.name !== vault).length === 0 && (
                <p className="text-sm text-fg-3 py-4 text-center">{String(t.noVaults)}</p>
              )}
            </div>
            <div className="flex justify-end mt-3">
              <Button onClick={() => setMoveOpen(false)}>{String(t.cancel)}</Button>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  )
}

// ShareDialog : lien de partage one-time. L'URL est affichée UNE fois —
// fermer sans copier = lien perdu (re-créer en moulira un nouveau).
function ShareDialog({ secret, t, onClose }: { secret: any; t: any; onClose: () => void }) {
  const [ttl, setTtl] = React.useState(30)
  const [busy, setBusy] = React.useState(false)
  const [result, setResult] = React.useState<any | null>(null)
  // liens vivants du secret — id + dates uniquement, JAMAIS le token
  const [links, setLinks] = React.useState<any[] | null>(null)  // null = chargement
  const [linksErr, setLinksErr] = React.useState('')
  const [revokeId, setRevokeId] = React.useState<string | null>(null)
  const [revokeBusy, setRevokeBusy] = React.useState(false)

  const loadLinks = () => {
    setLinksErr('')
    api('GET', `/admin/shares?secret_id=${secret.id}`)
      .then((r: any[]) => setLinks(Array.isArray(r) ? r : []))
      .catch(e => setLinksErr(friendly(e)))   // erreur ≠ liste vide : bannière + retry
  }
  React.useEffect(() => { loadLinks() }, [secret.id])

  const revoke = async () => {
    if (!revokeId || revokeBusy) return
    setRevokeBusy(true)
    try {
      await api('DELETE', `/admin/shares/${revokeId}`)
      toast.success(String(t.shareRevoked))
      setRevokeId(null)
      loadLinks()
    } catch (e: any) { toast.error(friendly(e)) }
    setRevokeBusy(false)
  }

  const share = async () => {
    if (busy) return
    setBusy(true)
    try {
      const d = await api('POST', `/admin/secrets/${secret.id}/share`, { ttl_minutes: ttl })
      setResult({ url: window.location.origin + d.url, expires_at: d.expires_at })
      loadLinks()   // le nouveau lien apparaît aussitôt dans les liens actifs
    } catch (e: any) { toast.error(friendly(e)) }
    setBusy(false)
  }
  return (
    // onOpenChange bloqué : tant que l'URL UNE-FOIS est affichée, Escape ou un
    // clic overlay ne doivent pas fermer le dialog — le lien serait perdu sans
    // copie. La fermeture passe uniquement par le bouton explicite, et elle ne
    // révoque rien : les liens actifs restent valides.
    <Dialog open onOpenChange={() => {}}>
      <DialogContent title={String(t.shareTitle)} className="max-w-sm max-h-[85vh] overflow-y-auto">
        <p className="text-xs text-fg-2 mb-4">{String(t.shareIntro)}</p>
        <div className="mb-4">
          <p className="text-2xs font-semibold text-fg-3 uppercase tracking-wider mb-2">{String(t.shareTTL)}</p>
          <SegmentedControl
            options={[15, 30, 60, 240].map(m => ({ value: m, label: m < 60 ? `${m} min` : m === 60 ? '1 h' : '4 h' }))}
            value={ttl}
            onChange={setTtl}
            ariaLabel={String(t.shareTTL)}
          />
        </div>
        {result ? (
          <>
            <p className="text-2xs font-semibold text-warn mb-2">{String(t.shareOnce)}</p>
            <div className="flex items-center gap-2 mb-3">
              <code className="flex-1 text-2xs font-mono bg-card-2 border border-border rounded-lg px-3 py-2 select-all break-all">{result.url}</code>
              {/* lien affiché UNE fois : la copie doit être fiable (fallback HTTP) */}
              <Button size="sm" aria-label={String(t.copy)} onClick={async () => {
                const ok = await copyText(result.url)
                if (ok) { toast.success(String(t.copied)) } else { toast.error(String(t.copyFailed)) }
              }}><Copy size={13} aria-hidden="true" /></Button>
            </div>
            <p className="text-2xs text-fg-3">{String(t.shareExpiresAt)} {fmtDateTime(result.expires_at)}</p>
          </>
        ) : (
          <Button variant="primary" onClick={share} disabled={busy}>
            {busy ? <LoaderCircle size={15} className="animate-spin" /> : <Share2 size={15} aria-hidden="true" />}
            {String(t.shareBtn)}
          </Button>
        )}
          {/* liens actifs du secret — révocables avant expiration */}
          <div className="mt-5 border-t border-border pt-4">
            <p className="text-2xs font-semibold text-fg-3 uppercase tracking-wider mb-2">{String(t.shareActiveTitle)}</p>
            {linksErr ? (
              <Alert tone="danger">
                <p>{linksErr}</p>
                <Button size="sm" className="mt-2" onClick={loadLinks}>{String(t.retry)}</Button>
              </Alert>
            ) : links === null ? (
              <Loading label={String(t.loading)} rows={2} />
            ) : links.length === 0 ? (
              <p className="text-xs text-fg-3">{String(t.shareNone)}</p>
            ) : (
              <div className="space-y-1.5">
                {links.map(l => (
                  <div key={l.id} className="flex items-center gap-2 text-xs">
                    <span className="flex-1 text-fg-2 min-w-0 truncate">
                      {String(t.shareExpiresAt)} {fmtDateTime(l.expires_at)}
                    </span>
                    <Button variant="destructive" size="sm" onClick={() => setRevokeId(String(l.id))} disabled={revokeBusy}>
                      <Ban size={13} aria-hidden="true" /> {String(t.shareRevoke)}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* fermer ne révoque rien : les liens actifs restent valides */}
          <div className="mt-4 flex justify-end">
            <Button onClick={onClose}>{String(t.close)}</Button>
          </div>
        </DialogContent>
        {/* révocation : confirmation légère — le lien meurt pour son détenteur */}
        <ConfirmDialog
          open={!!revokeId}
          onOpenChange={o => setRevokeId(o ? revokeId : null)}
          title={String(t.grantRemoveTitle)}
          message={String(t.shareRevoke)}
          confirmLabel={String(t.shareRevoke)}
          busy={revokeBusy}
          onConfirm={revoke}
        />
      </Dialog>
  )
}

function CreateDialog({ open, setOpen, vault, templates, onCreated }: {
  open: boolean; setOpen: (b: boolean) => void; vault: string
  templates: Template[]; onCreated: () => void
}) {
  const { t } = useLang()
  const [tplKey, setTplKey] = React.useState('')
  const [pickerOpen, setPickerOpen] = React.useState(false)
  const [key, setKey] = React.useState('')
  const [value, setValue] = React.useState('')
  const [note, setNote] = React.useState('')
  const [vals, setVals] = React.useState<Record<string, string>>({})
  const [busy, setBusy] = React.useState(false)
  const [valueErr, setValueErr] = React.useState(false)
  const [askDirty, setAskDirty] = React.useState(false)
  const tpl = templates.find(t => t.key === tplKey)

  // garde dirty : tout champ entamé (type, nom, valeur, note) retient la fermeture
  const dirty = key.trim() !== '' || value !== '' || note.trim() !== '' || tplKey !== '' || Object.values(vals).some(v => v !== '')

  const submit = async () => {
    if (!key.trim() || busy) return
    const body: any = { vault, key: key.trim() }
    if (tpl) {
      body.template = tplKey
      body.values = Object.fromEntries(Object.entries(vals).filter(([, v]) => v !== ''))
      const missing = tpl.fields.filter(f => f.required && !body.values[f.name])
      if (missing.length) { toast.error(String(t.missingFields) + missing.map(f => f.label).join(', ')); return }
    } else {
      if (!value) { toast.error(String(t.valueRequired)); setValueErr(true); return }
      body.value = value
    }
    if (note.trim()) body.note = note.trim()   // optionnelle : envoyée seulement si non vide
    setBusy(true)
    try { await api('POST', '/admin/secrets', body); toast.success(String(t.secretCreated)); onCreated(); setKey(''); setValue(''); setVals({}); setTplKey(''); setNote('') }
    catch (e: any) { toast.error(friendly(e)) }
    setBusy(false)
  }

  return (
    <>
      <Dialog open={open} onOpenChange={o => { if (!o) { if (dirty) setAskDirty(true); else setOpen(false) } }}>
        {open && (
          <DialogContent
            title={String(t.newSecretIn(vault))}
            className="max-w-lg max-h-[85vh] overflow-y-auto"
            onEscapeKeyDown={e => {
              // Escape ferme le picker D'ABORD — le dialog ne se ferme que
              // quand le picker est déjà fermé. Radix écoute document en
              // capture : c'est le seul endroit où preventDefault empêche
              // le dismiss (perdre tout le formulaire en fermant un menu
              // serait l'ergonomie inverse).
              if (pickerOpen) { e.preventDefault(); setPickerOpen(false); return }
              // garde dirty : formulaire entamé → confirmation avant fermeture
              if (dirty) { e.preventDefault(); setAskDirty(true) }
            }}
            onInteractOutside={e => { if (dirty) { e.preventDefault(); setAskDirty(true) } }}
          >
          <Field label={String(t.credentialType)} help={String(t.templateHelp)}>
            <TemplatePicker
              value={tplKey}
              open={pickerOpen}
              onOpenChange={setPickerOpen}
              onChange={k => {
                setTplKey(k); setVals({})
                // Ergonomie : suggère le nom du secret depuis le template
                // (openai → OPENAI, smtp → SMTP…) — uniquement si
                // l'utilisateur n'a encore rien tapé, jamais destructif.
                if (k && !key.trim()) setKey(k.toUpperCase())
              }}
              templates={templates}
            />
          </Field>

          <AnimatePresence mode="wait">
            {tpl && (
              <motion.div
                key={tplKey}
                initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                {tpl.fields.map(f => (
                  <Field key={f.name} label={<>{f.label}{f.required && <span className="text-danger"> *</span>}</> as any} help={f.help}>
                    {f.type === 'password' ? (
                      <PasswordInput
                        placeholder={f.placeholder}
                        value={vals[f.name] ?? ''}
                        onChange={e => setVals(v => ({ ...v, [f.name]: e.target.value }))}
                      />
                    ) : (
                      <Input
                        type="text"
                        placeholder={f.placeholder}
                        value={vals[f.name] ?? ''}
                        onChange={e => setVals(v => ({ ...v, [f.name]: e.target.value }))}
                        className="font-mono"
                      />
                    )}
                  </Field>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          <Field label={String(t.secretKey)}>
            <Input value={key} onChange={e => setKey(e.target.value)} className="font-mono"
              placeholder="PROD_DB, OPENAI_KEY…" onKeyDown={e => e.key === 'Enter' && submit()} />
          </Field>

          {!tpl && (
            <Field label={String(t.value)} error={valueErr ? String(t.valueRequired) : undefined}>
              <PasswordInput value={value}
                onChange={e => { setValue(e.target.value); setValueErr(false) }}
                placeholder={String(t.freeValuePh)}
                aria-invalid={valueErr}
                onKeyDown={e => e.key === 'Enter' && submit()} />
            </Field>
          )}

          {/* note optionnelle : annotation privée, jamais dévoilée par les partages */}
          <Field label={String(t.secretNote)} help={String(t.secretNoteHelp)}>
            <Textarea value={note} onChange={e => setNote(e.target.value)} className="h-24 resize-y" />
          </Field>

          <div className="flex justify-end gap-2 mt-2">
            <Button onClick={() => { if (dirty) setAskDirty(true); else setOpen(false) }}>{String(t.cancel)}</Button>
            <Button variant="primary" onClick={submit} disabled={!key.trim() || busy}>
              {busy ? <LoaderCircle size={15} className="animate-spin" /> : String(t.create)}
            </Button>
          </div>
        </DialogContent>
      )}
      </Dialog>
      {/* garde dirty : confirmation avant d'abandonner le formulaire */}
      <ConfirmDialog
        open={askDirty}
        onOpenChange={setAskDirty}
        title={String(t.dirtyTitle)}
        message={String(t.dirtyMsg)}
        confirmLabel={String(t.discard)}
        onConfirm={() => setOpen(false)}
      />
    </>
  )
}
