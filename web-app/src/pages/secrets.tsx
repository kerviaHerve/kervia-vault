import * as React from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Plus, Copy, Eye, EyeOff, Trash2, KeyRound, LoaderCircle, Pencil, Search, X } from 'lucide-react'
import { toast } from 'sonner'
import { useLang } from '@/i18n'
import { api } from '@/lib/api'
import { Button, Badge, Dialog, DialogContent, Input, PasswordInput, Field } from '@/components/ui'
import { cn, fmtDateTime } from '@/lib/utils'

interface Template {
  key: string; name: string; category: string
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
  const [data, setData] = React.useState<any>(null)   // {fields, value, template}
  const [edits, setEdits] = React.useState<Record<string, string>>({})
  const [showMap, setShowMap] = React.useState<Record<string, boolean>>({})
  const [busy, setBusy] = React.useState(false)
  const [editMode, setEditMode] = React.useState(mode === 'edit')
  const [keyName, setKeyName] = React.useState(secret.key)

  React.useEffect(() => {
    api('GET', `/admin/secrets/reveal?id=${secret.id}`).then(d => {
      setData(d)
      const e: Record<string, string> = {}
      for (const f of (d.fields || [])) e[f.label] = f.value
      setEdits(e)
    }).catch(() => setData({ value: '' }))
  }, [secret.id])

  const sensitive = (f: any) => f.type === 'password' || /secret|password|token|key|private/i.test(f.label)
  const copy = (v: string) => { navigator.clipboard.writeText(v); toast.success(String(t.copied)) }

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
      if (Object.keys(body).length === 0) { onClose(); setBusy(false); return }
      await api('PATCH', `/admin/secrets/${secret.id}`, body)
      toast.success(String(t.secretUpdated))
      onClose(); onSaved?.()
    } catch (e: any) { toast.error(e.message) }
    setBusy(false)
  }

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent
        title={secret.key}
        className="max-w-xl max-h-[85vh] overflow-y-auto"
      >
        {data === null ? (
          <div className="grid place-items-center py-10"><LoaderCircle className="animate-spin text-accent" size={22} /></div>
        ) : data.fields?.length ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="accent">{data.template}</Badge>
              <span className="text-[11px] text-fg-3">v{secret.version}</span>
              <div className="flex-1" />
              <Button size="sm" variant={editMode ? 'primary' : 'ghost'} onClick={() => setEditMode(!editMode)}>
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
                <div key={i}>
                  <div className="flex items-center gap-2 text-[11px] text-fg-3 mb-1">
                    <span className="uppercase tracking-wide">{f.label}</span>
                    {editMode ? null : (
                      <button onClick={() => copy(f.value)} className="opacity-0 group-hover:opacity-100 cursor-pointer hover:text-fg transition-opacity">
                        <Copy size={11} />
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
                      <span className="font-mono text-xs text-accent break-all cursor-pointer"
                        onClick={() => setShowMap((x: any) => ({ ...x, [f.label]: !x[f.label] }))}>
                        {showMap[f.label] ? f.value : '•'.repeat(Math.min(f.value.length, 20))}
                      </span>
                      <button onClick={() => copy(f.value)} className="cursor-pointer text-fg-3 hover:text-fg"><Copy size={12} /></button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-fg break-all">{f.value || '—'}</span>
                      <button onClick={() => copy(f.value)} className="cursor-pointer text-fg-3 hover:text-fg"><Copy size={12} /></button>
                    </div>
                  )}
                </div>
              ))}
            </div>
            {editMode && (
              <p className="text-[11px] text-fg-3">{String(t.editFieldHint)}</p>
            )}
          </div>
        ) : (
          // free-form
          <div className="space-y-3">
            <Badge variant="neutral">{String(t.free)}</Badge>
            {editMode ? (
              <textarea
                value={edits['__raw__'] ?? data.value ?? ''}
                onChange={(e: any) => setEdits((x: any) => ({ ...x, __raw__: e.target.value }))}
                className="w-full h-40 rounded-lg bg-bg border border-border p-3 font-mono text-xs focus:outline-none focus:border-accent resize-y"
              />
            ) : (
              <pre className="font-mono text-xs text-fg whitespace-pre-wrap break-all bg-bg border border-border rounded-lg p-3">{data.value || '—'}</pre>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={onClose}>{String(editMode ? t.cancel : t.close)}</Button>
          {editMode && (
            <Button variant="primary" onClick={save} disabled={busy}>
              {busy ? <LoaderCircle size={15} className="animate-spin" /> : String(t.save)}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default function Secrets() {
  const { t } = useLang()
  const [vaults, setVaults] = React.useState<any[]>([])
  const [vault, setVault] = React.useState('')
  const [secrets, setSecrets] = React.useState<any[] | null>(null)
  const [templates, setTemplates] = React.useState<Template[]>([])
  const [open, setOpen] = React.useState(false)
  const [dialogSecret, setDialogSecret] = React.useState<any | null>(null)
  const [dialogMode, setDialogMode] = React.useState<'reveal' | 'edit'>('reveal')

  React.useEffect(() => { api('GET', '/admin/vaults').then((v: any[]) => { setVaults(v); if (v.length) setVault(v[0].name) }) }, [])
  React.useEffect(() => { api('GET', '/admin/templates').then(setTemplates).catch(() => {}) }, [])
  React.useEffect(() => { if (vault) load() }, [vault])

  const load = () => api('GET', `/admin/secrets?vault=${vault}`).then(setSecrets)
  const reveal = (s: any) => { setDialogMode('reveal'); setDialogSecret(s) }
  const revealSearch = (sr: any) => { setDialogMode('reveal'); setDialogSecret(sr) }

  const del = async (id: string, key: string) => {
    if (!confirm(t.deleteConfirm(key))) return
    await api('POST', `/admin/secrets/${id}/delete`)
    toast.success(String(t.secretDeleted)); load()
  }

  const [query, setQuery] = React.useState('')
  const [searchResults, setSearchResults] = React.useState<any[] | null>(null
  )
  const searchTimer = React.useRef<any>(null)

  const runSearch = (q: string) => {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    if (!q.trim()) { setSearchResults(null); return }
    searchTimer.current = setTimeout(async () => {
      try {
        const r = await api('GET', `/admin/secrets/search?q=${encodeURIComponent(q.trim())}`)
        setSearchResults(Array.isArray(r) ? r : [])
      } catch { setSearchResults([]) }
    }, 200)
  }
  React.useEffect(() => { runSearch(query) }, [query])
  const searching = query.trim() !== ''

  const openEdit = (s: any) => { setDialogMode('edit'); setDialogSecret(s) }

  if (!vaults.length) return (
    <div>
      <h1 className="text-xl font-bold tracking-tight mb-6">Secrets</h1>
      <p className="text-fg-3">{String(t.noVaults)}</p>
    </div>
  )

  return (
    <div>
      <div className="flex items-center justify-between mb-6 gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight mb-1">Secrets</h1>
          <p className="text-sm text-fg-2">{String(t.secretsSub)}</p>
        </div>
        <div className="flex gap-1.5 items-center">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-3" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={String(t.search)}
              className="h-9 w-48 bg-card border border-border rounded-lg pl-8 pr-7 text-sm text-fg placeholder:text-fg-3 focus:border-accent focus:outline-none"
            />
            {query && (
              <button onClick={() => setQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-fg-3 hover:text-fg cursor-pointer">
                <X size={13} />
              </button>
            )}
          </div>
          {vaults.map(v => (
            <button key={v.id} onClick={() => setVault(v.name)}
              className={cn(
                'h-9 px-4 rounded-lg text-sm font-medium cursor-pointer transition-colors',
                v.name === vault ? 'bg-accent text-[#0F172A] font-semibold' : 'bg-card-2 text-fg-2 hover:text-fg border border-border',
              )}>
              {v.name}
            </button>
          ))}
          <Button variant="primary" onClick={() => setOpen(true)} className="ml-2"><Plus size={16} /> {String(t.newSecret)}</Button>
        </div>
      </div>

      {searching ? (
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-border text-xs text-fg-2">
          {searchResults?.length ?? 0} résultat{(searchResults?.length ?? 0) > 1 ? 's' : ''} pour « {query.trim()} » — tous vaults
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-fg-3">
              {[String(t.key), 'Vault', 'Type', String(t.value), 'Version', 'MàJ', ''].map((h, i) => (
                <th key={i} className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(searchResults ?? []).map((sr: any) => (
              <tr key={sr.id} className="border-b border-border/50 last:border-0 hover:bg-card-2/50 transition-colors">
                <td className="px-5 py-3"><span className="font-semibold">{sr.key}</span></td>
                <td className="px-5 py-3"><Badge variant="accent">{sr.vault_name}</Badge></td>
                <td className="px-5 py-3"><Badge variant={sr.template ? 'neutral' : 'neutral'}>{sr.template || String(t.free)}</Badge></td>
                <td className="px-5 py-3">
                  <Button variant="ghost" size="sm" onClick={() => revealSearch(sr)}>
                    <Eye size={13} /> {String(t.reveal)}
                  </Button>
                </td>
                <td className="px-5 py-3 text-xs text-fg-2">v{sr.version}</td>
                <td className="px-5 py-3 text-xs text-fg-2">{fmtDateTime(sr.updated_at)}</td>
                <td></td>
              </tr>
            ))}
            {searchResults?.length === 0 && (
              <tr><td colSpan={7} className="py-14 text-center text-fg-3">
                <Search className="mx-auto mb-3 opacity-50" size={32} />{String(t.noResults)}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      ) : (
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-fg-3">
              {[String(t.key), 'Type', String(t.value), 'Version', 'MàJ', ''].map((h, i) => (
                <th key={i} className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <AnimatePresence>
              {(secrets ?? []).map(s => (
                <motion.tr
                  key={s.id}
                  layout
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="border-b border-border/50 last:border-0 hover:bg-card-2/50 transition-colors"
                >
                  <td className="px-5 py-3"><span className="font-semibold">{s.key}</span></td>
                  <td className="px-5 py-3">
                    <Badge variant={s.template ? 'accent' : 'neutral'}>{s.template || String(t.free)}</Badge>
                  </td>
                  <td className="px-5 py-3">
                    <span className="font-mono text-fg-3">••••••••••••</span>
                  </td>
                  <td className="px-5 py-3 text-xs text-fg-2">v{s.version}</td>
                  <td className="px-5 py-3 text-xs text-fg-2">{fmtDateTime(s.updated_at)}</td>
                  <td className="px-5 py-3 text-right whitespace-nowrap">
                    <Button variant="ghost" size="icon" onClick={() => reveal(s)}>
                      <Eye size={15} />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => openEdit(s)}>
                      <Pencil size={15} />
                    </Button>
                    <Button variant="ghost" size="icon" className="text-danger hover:bg-danger/10" onClick={() => del(s.id, s.key)}>
                      <Trash2 size={15} />
                    </Button>
                  </td>
                </motion.tr>
              ))}
            </AnimatePresence>
            {secrets?.length === 0 && (
              <tr><td colSpan={6} className="py-14 text-center text-fg-3">
                <KeyRound className="mx-auto mb-3 opacity-50" size={32} />
                {String(t.emptyVault)}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      )}

      {/* secret dialog: reveal + edit (templated = champs, jamais de JSON) */}
      {dialogSecret && (
        <SecretDialog
          secret={dialogSecret} mode={dialogMode} t={t} templates={templates}
          onClose={() => setDialogSecret(null)}
          onSaved={load}
        />
      )}

      <CreateDialog
        open={open} setOpen={setOpen} vault={vault} templates={templates}
        onCreated={() => { setOpen(false); load() }}
      />
    </div>
  )
}

function CreateDialog({ open, setOpen, vault, templates, onCreated }: {
  open: boolean; setOpen: (b: boolean) => void; vault: string
  templates: Template[]; onCreated: () => void
}) {
  const { t } = useLang()
  const [tplKey, setTplKey] = React.useState('')
  const [key, setKey] = React.useState('')
  const [value, setValue] = React.useState('')
  const [vals, setVals] = React.useState<Record<string, string>>({})
  const [busy, setBusy] = React.useState(false)
  const tpl = templates.find(t => t.key === tplKey)

  const submit = async () => {
    if (!key.trim() || busy) return
    const body: any = { vault, key: key.trim() }
    if (tpl) {
      body.template = tplKey
      body.values = Object.fromEntries(Object.entries(vals).filter(([, v]) => v !== ''))
      const missing = tpl.fields.filter(f => f.required && !body.values[f.name])
      if (missing.length) { toast.error(String(t.missingFields) + missing.map(f => f.label).join(', ')); return }
    } else {
      if (!value) { toast.error(String(t.value) + ' ?'); return }
      body.value = value
    }
    setBusy(true)
    try { await api('POST', '/admin/secrets', body); toast.success(String(t.secretCreated)); onCreated(); setKey(''); setValue(''); setVals({}) }
    catch (e: any) { toast.error(e.message) }
    setBusy(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {open && (
        <DialogContent title={`Nouveau secret dans « ${vault} »`} className="max-w-lg max-h-[85vh] overflow-y-auto">
          <Field label={String(t.credentialType)} help={String(t.templateHelp)}>
            <select
              value={tplKey} onChange={e => { setTplKey(e.target.value); setVals({}) }}
              className="w-full h-9 bg-bg border border-border rounded-lg px-3 text-sm cursor-pointer focus:border-accent outline-none"
            >
              <option value="">{String(t.freeValue)}</option>
              {templates.map(t => <option key={t.key} value={t.key}>{t.name} ({t.category})</option>)}
            </select>
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
            <Field label={String(t.value)}>
              <Input value={value} onChange={e => setValue(e.target.value)} className="font-mono"
                placeholder="le secret lui-même" onKeyDown={e => e.key === 'Enter' && submit()} />
            </Field>
          )}

          <div className="flex justify-end gap-2 mt-2">
            <Button onClick={() => setOpen(false)}>{String(t.cancel)}</Button>
            <Button variant="primary" onClick={submit} disabled={!key.trim() || busy}>
              {busy ? <LoaderCircle size={15} className="animate-spin" /> : String(t.create)}
            </Button>
          </div>
        </DialogContent>
      )}
    </Dialog>
  )
}
