import * as React from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Plus, Copy, Eye, EyeOff, Trash2, KeyRound, LoaderCircle, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { Button, Badge, Dialog, DialogContent, Input, Field } from '@/components/ui'
import { cn, fmtDateTime } from '@/lib/utils'

interface Template {
  key: string; name: string; category: string
  fields: { name: string; label: string; type: string; required: boolean; placeholder?: string; help?: string }[]
}

export default function Secrets() {
  const [vaults, setVaults] = React.useState<any[]>([])
  const [vault, setVault] = React.useState('')
  const [secrets, setSecrets] = React.useState<any[] | null>(null)
  const [templates, setTemplates] = React.useState<Template[]>([])
  const [open, setOpen] = React.useState(false)
  const [revealed, setRevealed] = React.useState<Record<string, string>>({})

  React.useEffect(() => { api('GET', '/admin/vaults').then((v: any[]) => { setVaults(v); if (v.length) setVault(v[0].name) }) }, [])
  React.useEffect(() => { api('GET', '/admin/templates').then(setTemplates).catch(() => {}) }, [])
  React.useEffect(() => { if (vault) load() }, [vault])

  const load = () => api('GET', `/admin/secrets?vault=${vault}`).then(setSecrets)
  const reveal = async (id: string) => {
    if (revealed[id] !== undefined) { setRevealed(r => { const n = { ...r }; delete n[id]; return n }); return }
    const d = await api('GET', `/admin/secrets/reveal?id=${id}`)
    let v = d.value
    try { v = JSON.stringify(JSON.parse(v), null, 2) } catch {}
    setRevealed(r => ({ ...r, [id]: v }))
  }
  const del = async (id: string, key: string) => {
    if (!confirm(`Supprimer ${key} ?`)) return
    await api('POST', `/admin/secrets/${id}/delete`)
    toast.success('Supprimé'); load()
  }

  const [edit, setEdit] = React.useState<any | null>(null)
  const [editKey, setEditKey] = React.useState('')
  const [editVal, setEditVal] = React.useState('')
  const [editBusy, setEditBusy] = React.useState(false)
  const openEdit = async (s: any) => {
    setEdit(s); setEditKey(s.key); setEditVal('')
    try {
      const d = await api('GET', `/admin/secrets/reveal?id=${s.id}`)
      setEditVal(d.value)
    } catch { /* leave empty = no value change */ }
  }
  const saveEdit = async () => {
    if (!edit || editBusy) return
    if (!editKey.trim()) { toast.error('Le nom ne peut pas être vide'); return }
    setEditBusy(true)
    try {
      const body: any = {}
      if (editKey.trim() !== edit.key) body.key = editKey.trim()
      if (editVal !== '' && editVal !== undefined) body.value = editVal
      if (!body.key && body.value === undefined) { setEdit(null); setEditBusy(false); return }
      await api('PATCH', `/admin/secrets/${edit.id}`, body)
      toast.success('Secret mis à jour')
      setEdit(null); load()
    } catch (e: any) { toast.error(e.message === 'already_exists' ? 'Ce nom existe déjà' : e.message) }
    setEditBusy(false)
  }

  if (!vaults.length) return (
    <div>
      <h1 className="text-xl font-bold tracking-tight mb-6">Secrets</h1>
      <p className="text-fg-3">Créez d'abord un vault.</p>
    </div>
  )

  return (
    <div>
      <div className="flex items-center justify-between mb-6 gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight mb-1">Secrets</h1>
          <p className="text-sm text-fg-2">Les valeurs ne s'affichent que sur clic.</p>
        </div>
        <div className="flex gap-1.5">
          {vaults.map(v => (
            <button key={v.id} onClick={() => setVault(v.name)}
              className={cn(
                'h-9 px-4 rounded-lg text-sm font-medium cursor-pointer transition-colors',
                v.name === vault ? 'bg-accent text-[#0F172A] font-semibold' : 'bg-card-2 text-fg-2 hover:text-fg border border-border',
              )}>
              {v.name}
            </button>
          ))}
          <Button variant="primary" onClick={() => setOpen(true)} className="ml-2"><Plus size={16} /> Nouveau</Button>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-fg-3">
              {['Clé', 'Type', 'Valeur', 'Version', 'MàJ', ''].map(h => (
                <th key={h} className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider">{h}</th>
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
                    <Badge variant={s.template ? 'accent' : 'neutral'}>{s.template || 'libre'}</Badge>
                  </td>
                  <td className="px-5 py-3 max-w-72">
                    {revealed[s.id] !== undefined ? (
                      <motion.pre
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                        className="font-mono text-xs text-fg whitespace-pre-wrap break-all max-w-64"
                      >{revealed[s.id]}</motion.pre>
                    ) : (
                      <span className="font-mono text-fg-3">••••••••••••</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-xs text-fg-2">v{s.version}</td>
                  <td className="px-5 py-3 text-xs text-fg-2">{fmtDateTime(s.updated_at)}</td>
                  <td className="px-5 py-3 text-right whitespace-nowrap">
                    <Button variant="ghost" size="icon" onClick={() => reveal(s.id)}>
                      {revealed[s.id] !== undefined ? <EyeOff size={15} /> : <Eye size={15} />}
                    </Button>
                    {revealed[s.id] !== undefined && (
                      <Button variant="ghost" size="icon" onClick={() => { navigator.clipboard.writeText(revealed[s.id]); toast.success('Copié') }}>
                        <Copy size={15} />
                      </Button>
                    )}
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
                Vault vide. Créez un secret (avec template si possible).</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* edit dialog */}
      <Dialog open={!!edit} onOpenChange={o => { if (!o) setEdit(null) }}>
        {edit && (
          <DialogContent title={`Modifier « ${edit.key} »`}>
            <Field label="Nom du secret (KEY)">
              <Input value={editKey} onChange={e => setEditKey(e.target.value)} className="font-mono" />
            </Field>
            <Field label="Valeur" help="Modifiée = nouvelle version (l'historique est conservé).">
              <Input value={editVal} onChange={e => setEditVal(e.target.value)} className="font-mono" />
            </Field>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setEdit(null)}>Annuler</Button>
              <Button variant="primary" onClick={saveEdit} disabled={editBusy}>
                {editBusy ? <LoaderCircle size={15} className="animate-spin" /> : 'Enregistrer'}
              </Button>
            </div>
          </DialogContent>
        )}
      </Dialog>

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
      if (missing.length) { toast.error(`Champs requis manquants : ${missing.map(f => f.label).join(', ')}`); return }
    } else {
      if (!value) { toast.error('Valeur requise'); return }
      body.value = value
    }
    setBusy(true)
    try { await api('POST', '/admin/secrets', body); toast.success('Secret créé'); onCreated(); setKey(''); setValue(''); setVals({}) }
    catch (e: any) { toast.error(e.message) }
    setBusy(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {open && (
        <DialogContent title={`Nouveau secret dans « ${vault} »`} className="max-w-lg max-h-[85vh] overflow-y-auto">
          <Field label="Type de credential" help="Les templates valident les champs (openai, postgres, smtp…).">
            <select
              value={tplKey} onChange={e => { setTplKey(e.target.value); setVals({}) }}
              className="w-full h-9 bg-bg border border-border rounded-lg px-3 text-sm cursor-pointer focus:border-accent outline-none"
            >
              <option value="">— Valeur libre —</option>
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
                    <Input
                      type={f.type === 'password' ? 'password' : 'text'}
                      placeholder={f.placeholder}
                      value={vals[f.name] ?? ''}
                      onChange={e => setVals(v => ({ ...v, [f.name]: e.target.value }))}
                      className={f.type === 'password' ? 'font-mono' : ''}
                    />
                  </Field>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          <Field label="Nom du secret (KEY)">
            <Input value={key} onChange={e => setKey(e.target.value)} className="font-mono"
              placeholder="PROD_DB, OPENAI_KEY…" onKeyDown={e => e.key === 'Enter' && submit()} />
          </Field>

          {!tpl && (
            <Field label="Valeur">
              <Input value={value} onChange={e => setValue(e.target.value)} className="font-mono"
                placeholder="le secret lui-même" onKeyDown={e => e.key === 'Enter' && submit()} />
            </Field>
          )}

          <div className="flex justify-end gap-2 mt-2">
            <Button onClick={() => setOpen(false)}>Annuler</Button>
            <Button variant="primary" onClick={submit} disabled={!key.trim() || busy}>
              {busy ? <LoaderCircle size={15} className="animate-spin" /> : 'Créer'}
            </Button>
          </div>
        </DialogContent>
      )}
    </Dialog>
  )
}
