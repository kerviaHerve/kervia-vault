import * as React from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Plus, Archive, Users, Check, Trash2, Settings2, LoaderCircle } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { Button, Badge, Dialog, DialogContent, Input, Field } from '@/components/ui'
import { cn, fmtDate } from '@/lib/utils'

export default function Vaults() {
  const [vaults, setVaults] = React.useState<any[] | null>(null)
  const [grants, setGrants] = React.useState<any[]>([])
  const [agents, setAgents] = React.useState<any[]>([])
  const [secrets, setSecrets] = React.useState<Record<string, number>>({})
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState('')
  const [access, setAccess] = React.useState<'all' | 'select'>('all')
  const [selected, setSelected] = React.useState<Record<string, boolean>>({})
  const [canWrite, setCanWrite] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  const [manage, setManage] = React.useState<any | null>(null) // vault being managed

  const load = async () => {
    const [v, g, a] = await Promise.all([
      api('GET', '/admin/vaults'), api('GET', '/admin/grants'), api('GET', '/admin/agents'),
    ])
    setVaults(v); setGrants(g); setAgents((a as any[]).filter(x => !x.revoked_at))
    // secret counts per vault
    const counts: Record<string, number> = {}
    await Promise.all((v as any[]).map(async (vault: any) => {
      const s = await api('GET', `/admin/secrets?vault=${vault.name}`)
      counts[vault.id] = Array.isArray(s) ? s.length : 0
    }))
    setSecrets(counts)
  }
  React.useEffect(() => { load() }, [])

  const create = async () => {
    if (!name.trim() || busy) return
    setBusy(true)
    try {
      const vault = await api('POST', '/admin/vaults', { name: name.trim() })
      const targets = access === 'all' ? agents : agents.filter(a => selected[a.id])
      await Promise.all(targets.map(a =>
        api('POST', '/admin/grants', { agent_id: a.id, vault_id: vault.id, can_write: canWrite })
      ))
      toast.success(`Vault « ${vault.name} » créé — accès donné à ${targets.length} agent${targets.length > 1 ? 's' : ''}`)
      setOpen(false); setName(''); setSelected({}); setAccess('all')
      load()
    } catch (e: any) { toast.error(e.message) }
    setBusy(false)
  }

  const del = async (v: any) => {
    if (!confirm(`Supprimer le vault « ${v.name} » ? (seulement possible s'il est vide)`)) return
    try {
      await api('DELETE', `/admin/vaults/${v.id}`)
      toast.success('Vault supprimé')
      load()
    } catch (e: any) {
      toast.error(e.message === 'vault_not_empty' ? "Le vault contient des secrets — supprimez-les d'abord" : e.message)
    }
  }

  if (!vaults) return null

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold tracking-tight mb-1">Vaults</h1>
          <p className="text-sm text-fg-2">Un vault par agent ou par usage — les permissions se gèrent aussi dans l'onglet Permissions.</p>
        </div>
        <Button variant="primary" onClick={() => setOpen(true)}><Plus size={16} /> Nouveau vault</Button>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-fg-3">
              {['Nom', 'Secrets', 'Agents autorisés', 'Créé', ''].map(h => (
                <th key={h} className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {vaults.map(v => (
              <tr key={v.id} className="border-b border-border/50 last:border-0 hover:bg-card-2/50 transition-colors">
                <td className="px-5 py-3"><span className="font-semibold">{v.name}</span></td>
                <td className="px-5 py-3 tabular-nums">{secrets[v.id] ?? '—'}</td>
                <td className="px-5 py-3">
                  <span className="text-fg-2">
                    {grants.filter(g => g.vault_id === v.id).length > 0
                      ? grants.filter(g => g.vault_id === v.id).length
                      : <span className="text-danger font-medium">personne</span>}
                  </span>
                </td>
                <td className="px-5 py-3 text-fg-2 text-xs">{fmtDate(v.created_at)}</td>
                <td className="px-5 py-3 text-right whitespace-nowrap">
                  <Button variant="ghost" size="icon" onClick={() => setManage(v)} title="Gérer les accès">
                    <Settings2 size={15} />
                  </Button>
                  <Button variant="ghost" size="icon" className="text-danger hover:bg-danger/10" onClick={() => del(v)} title="Supprimer">
                    <Trash2 size={15} />
                  </Button>
                </td>
              </tr>
            ))}
            {vaults.length === 0 && (
              <tr><td colSpan={5} className="py-14 text-center text-fg-3">
                <Archive className="mx-auto mb-3 opacity-50" size={32} />Aucun vault.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* create dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        {open && (
          <DialogContent title="Nouveau vault" className="max-w-md max-h-[85vh] overflow-y-auto">
            <Field label="Nom du vault" help="ex : rita, ci, commun…">
              <Input value={name} autoFocus onChange={e => setName(e.target.value)} />
            </Field>
            <div className="mb-4">
              <p className="text-xs font-semibold text-fg-2 mb-2">Accès au vault</p>
              <div className="grid grid-cols-2 gap-2 mb-3">
                <button onClick={() => setAccess('all')}
                  className={cn('h-10 rounded-lg text-[13px] font-medium cursor-pointer transition-colors border flex items-center justify-center gap-2',
                    access === 'all' ? 'bg-accent/12 border-accent text-accent' : 'bg-card-2 border-border text-fg-2 hover:text-fg')}>
                  <Users size={15} /> Tous les agents
                </button>
                <button onClick={() => setAccess('select')}
                  className={cn('h-10 rounded-lg text-[13px] font-medium cursor-pointer transition-colors border',
                    access === 'select' ? 'bg-accent/12 border-accent text-accent' : 'bg-card-2 border-border text-fg-2 hover:text-fg')}>
                  Agents spécifiques…
                </button>
              </div>
              <motion.div initial={false}
                animate={{ height: access === 'select' ? 'auto' : 0, opacity: access === 'select' ? 1 : 0 }}
                className="overflow-hidden">
                <div className="space-y-1 mb-3 max-h-44 overflow-y-auto">
                  {agents.length === 0 && <p className="text-xs text-fg-3 py-2">Aucun agent actif — créez-en un d'abord.</p>}
                  {agents.map(a => (
                    <button key={a.id}
                      onClick={() => setSelected(s => ({ ...s, [a.id]: !s[a.id] }))}
                      className={cn('w-full flex items-center justify-between px-3 h-9 rounded-lg text-[13px] cursor-pointer transition-colors border',
                        selected[a.id] ? 'bg-accent/12 border-accent/50 text-accent' : 'bg-card-2 border-border text-fg-2 hover:text-fg')}>
                      <span>{a.name}</span>
                      {selected[a.id] && <Check size={14} />}
                    </button>
                  ))}
                </div>
              </motion.div>
              <p className="text-xs font-semibold text-fg-2 mb-2">Niveau d'accès</p>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => setCanWrite(true)}
                  className={cn('h-9 rounded-lg text-xs font-semibold cursor-pointer transition-colors border',
                    canWrite ? 'bg-accent/12 border-accent text-accent' : 'bg-card-2 border-border text-fg-2')}>
                  Lecture + écriture
                </button>
                <button onClick={() => setCanWrite(false)}
                  className={cn('h-9 rounded-lg text-xs font-semibold cursor-pointer transition-colors border',
                    !canWrite ? 'bg-accent/12 border-accent text-accent' : 'bg-card-2 border-border text-fg-2')}>
                  Lecture seule
                </button>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setOpen(false)}>Annuler</Button>
              <Button variant="primary" onClick={create} disabled={!name.trim() || busy
                || (access === 'select' && agents.length > 0 && !Object.values(selected).some(Boolean))}>
                Créer
              </Button>
            </div>
          </DialogContent>
        )}
      </Dialog>

      {/* manage-access dialog */}
      <Dialog open={!!manage} onOpenChange={o => { if (!o) setManage(null) }}>
        {manage && <ManageAccess vault={manage} grants={grants} agents={agents} onClose={() => { setManage(null); load() }} />}
      </Dialog>
    </div>
  )
}

function ManageAccess({ vault, grants, agents, onClose }: {
  vault: any; grants: any[]; agents: any[]; onClose: () => void
}) {
  const [busy, setBusy] = React.useState(false)
  const [newAgent, setNewAgent] = React.useState('')
  const mine = grants.filter(g => g.vault_id === vault.id)
  const grantedIds = new Set(mine.map(g => g.agent_id))
  const agentById = Object.fromEntries(agents.map(a => [a.id, a]))
  const available = agents.filter(a => !grantedIds.has(a.id))

  const setLevel = async (agentId: string, canWrite: boolean) => {
    setBusy(true)
    try { await api('POST', '/admin/grants', { agent_id: agentId, vault_id: vault.id, can_write: canWrite }); onClose() }
    catch (e: any) { toast.error(e.message) }
    setBusy(false)
  }
  const revoke = async (agentId: string, name: string) => {
    if (!confirm(`Retirer l'accès de ${name} à « ${vault.name} » ?`)) return
    setBusy(true)
    try { await api('DELETE', '/admin/grants', { agent_id: agentId, vault_id: vault.id }); onClose() }
    catch (e: any) { toast.error(e.message) }
    setBusy(false)
  }
  const grantNew = async () => {
    if (!newAgent) return
    await setLevel(newAgent, true)
  }

  return (
    <DialogContent title={`Accès à « ${vault.name} »`} className="max-w-md max-h-[80vh] overflow-y-auto">
      {mine.length === 0 && <p className="text-sm text-fg-2 mb-4">Aucun agent n'a accès à ce vault.</p>}
      <div className="space-y-1.5 mb-5">
        {mine.map(g => {
          const a = agentById[g.agent_id]
          const name = a?.name || g.agent_id.slice(0, 8)
          return (
            <div key={g.agent_id} className="flex items-center justify-between bg-card-2 border border-border rounded-lg px-3 h-10">
              <span className="text-sm font-medium">{name}</span>
              <div className="flex items-center gap-1.5">
                <button onClick={() => setLevel(g.agent_id, !g.can_write)} disabled={busy}
                  className={cn('h-7 px-2.5 rounded-md text-[11px] font-bold cursor-pointer transition-colors border',
                    g.can_write ? 'bg-accent/15 border-accent/50 text-accent' : 'bg-muted border-border text-fg-2')}>
                  {g.can_write ? 'RW' : 'RO'}
                </button>
                <button onClick={() => revoke(g.agent_id, name)} disabled={busy}
                  className="h-7 px-2 rounded-md text-danger hover:bg-danger/10 cursor-pointer transition-colors">
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          )
        })}
      </div>
      {available.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-fg-2 mb-2">Donner l'accès à…</p>
          <div className="flex gap-2">
            <select value={newAgent} onChange={e => setNewAgent(e.target.value)}
              className="flex-1 h-9 bg-bg border border-border rounded-lg px-3 text-sm cursor-pointer focus:border-accent outline-none">
              <option value="">— choisir un agent —</option>
              {available.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <Button variant="primary" onClick={grantNew} disabled={!newAgent || busy}>
              {busy ? <LoaderCircle size={15} className="animate-spin" /> : <Plus size={15} />}
            </Button>
          </div>
        </div>
      )}
    </DialogContent>
  )
}
