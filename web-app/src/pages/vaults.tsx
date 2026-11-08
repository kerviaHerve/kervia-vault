import * as React from 'react'
import { motion } from 'framer-motion'
import { Plus, Archive, Users, Check, Trash2, Settings2, LoaderCircle } from 'lucide-react'
import { toast } from 'sonner'
import { useLang } from '@/i18n'
import { api, friendly } from '@/lib/api'
import {
  Button, Dialog, DialogContent, Input, Field, Select,
  ConfirmDialog, SegmentedControl, Table, Th, Td, Alert, Loading, EmptyState, Tip,
} from '@/components/ui'
import { cn, fmtDate } from '@/lib/utils'

export default function Vaults() {
  const { t } = useLang()
  const [vaults, setVaults] = React.useState<any[] | null>(null)
  const [grants, setGrants] = React.useState<any[]>([])
  const [agents, setAgents] = React.useState<any[]>([])
  const [secrets, setSecrets] = React.useState<Record<string, number>>({})
  const [err, setErr] = React.useState<string | null>(null) // E1 : erreur ≠ vide
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState('')
  const [access, setAccess] = React.useState<'all' | 'select'>('all')
  const [selected, setSelected] = React.useState<Record<string, boolean>>({})
  const [canWrite, setCanWrite] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  const [manage, setManage] = React.useState<any | null>(null) // vault being managed
  const [delTarget, setDelTarget] = React.useState<any | null>(null) // E2 : ConfirmDialog
  const [delBusy, setDelBusy] = React.useState(false)

  const load = async () => {
    setErr(null)
    try {
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
    } catch (e) {
      setErr(friendly(e)) // E1 : bannière + retry, jamais une page blanche
    }
  }
  React.useEffect(() => { load() }, [])

  // E3 : le vault est créé PUIS les grants suivent. Un échec partiel de grant
  // ne doit ni masquer le succès du vault, ni passer pour un succès global :
  // toast dédié au vault, toast dédié aux grants (succès ou première erreur).
  const create = async () => {
    if (!name.trim() || busy) return
    setBusy(true)
    try {
      const vault = await api('POST', '/admin/vaults', { name: name.trim() })
      const targets = access === 'all' ? agents : agents.filter(a => selected[a.id])
      let ok = 0
      let firstErr: unknown = null
      await Promise.all(targets.map(a =>
        api('POST', '/admin/grants', { agent_id: a.id, vault_id: vault.id, can_write: canWrite })
          .then(() => { ok++ })
          .catch(e => { if (firstErr === null) firstErr = e }),
      ))
      toast.success(String(t.vaultCreated(vault.name)))
      if (targets.length > 0) {
        if (ok === targets.length) toast.success(String(t.accessGrantedTo(ok)))
        else toast.error(friendly(firstErr)) // partiel : le vault existe, l'utilisateur sait quoi corriger
      }
      setOpen(false); setName(''); setSelected({}); setAccess('all')
      load()
    } catch (e) {
      toast.error(friendly(e))
    }
    setBusy(false)
  }

  const del = async (v: any) => {
    if (!v) return
    setDelBusy(true)
    try {
      await api('DELETE', `/admin/vaults/${v.id}`)
      toast.success(String(t.vaultDeleted))
      load()
    } catch (e) {
      toast.error(friendly(e)) // vault_not_empty → message localisé, plus de switch par page
    }
    setDelBusy(false)
  }

  // E1 : erreur de chargement = bannière danger + retry — jamais déguisée en vide.
  if (err) {
    return (
      <div>
        <h1 className="text-xl font-bold tracking-tight mb-1">{String(t.vaultsTitle)}</h1>
        <div className="mt-6">
          <Alert tone="danger">{err}</Alert>
          <Button variant="primary" className="mt-4" onClick={load}>{String(t.retry)}</Button>
        </div>
      </div>
    )
  }

  if (!vaults) {
    return (
      <div>
        <h1 className="text-xl font-bold tracking-tight mb-1 sr-only">{String(t.vaultsTitle)}</h1>
        <Loading rows={6} label={String(t.loading)} />
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold tracking-tight mb-1">{String(t.vaultsTitle)}</h1>
          <p className="text-sm text-fg-2">{String(t.vaultsSub)}</p>
        </div>
        <Button variant="primary" onClick={() => setOpen(true)}><Plus size={16} aria-hidden="true" /> {String(t.newVault)}</Button>
      </div>

      <Table label={String(t.vaultsTitle)}>
        <thead>
          <tr>
            <Th>{String(t.name)}</Th>
            <Th>{String(t.secrets)}</Th>
            <Th>{String(t.agentsAllowed)}</Th>
            <Th>{String(t.created)}</Th>
            <Th className="w-px"><span className="sr-only">{String(t.actions)}</span></Th>
          </tr>
        </thead>
        <tbody>
          {vaults.map(v => {
            const granted = grants.filter(g => g.vault_id === v.id).length
            return (
              <tr key={v.id} className="hover:bg-card-2/50 transition-colors">
                <Td><span className="font-semibold">{v.name}</span></Td>
                <Td className="tabular-nums">{secrets[v.id] ?? '—'}</Td>
                <Td>
                  <span className="text-fg-2">
                    {granted > 0
                      ? granted
                      : <span className="text-danger font-medium">{String(t.nobody)}</span>}
                  </span>
                </Td>
                <Td className="text-fg-2 text-xs">{fmtDate(v.created_at)}</Td>
                <Td className="text-right whitespace-nowrap">
                  <Button variant="ghost" size="icon" onClick={() => setManage(v)}
                    title={String(t.manageAccess)} aria-label={`${String(t.manageAccess)} ${v.name}`}>
                    <Settings2 size={15} aria-hidden="true" />
                  </Button>
                  <Button variant="ghost" size="icon" className="text-danger hover:bg-danger/10" onClick={() => setDelTarget(v)}
                    title={String(t.delete)} aria-label={`${String(t.delete)} ${v.name}`}>
                    <Trash2 size={15} aria-hidden="true" />
                  </Button>
                </Td>
              </tr>
            )
          })}
          {vaults.length === 0 && (
            <tr><Td colSpan={5}>
              <EmptyState icon={<Archive size={28} aria-hidden="true" />} title={String(t.noVaults)} />
            </Td></tr>
          )}
        </tbody>
      </Table>

      {/* create dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        {open && (
          <DialogContent title={String(t.newVault)} className="max-w-md max-h-[85vh] overflow-y-auto">
            <Field label={String(t.vaultName)} help={String(t.vaultNameHelp)}>
              <Input value={name} autoFocus onChange={e => setName(e.target.value)} />
            </Field>
            <div className="mb-4">
              <p className="text-xs font-semibold text-fg-2 mb-2">{String(t.accessToVault)}</p>
              <SegmentedControl<'all' | 'select'>
                options={[
                  { value: 'all', label: <><Users size={15} aria-hidden="true" /> {String(t.allAgents)}</> },
                  { value: 'select', label: String(t.specificAgents) },
                ]}
                value={access}
                onChange={setAccess}
                ariaLabel={String(t.accessToVault)}
                className="mb-3"
              />
              <motion.div initial={false}
                animate={{ height: access === 'select' ? 'auto' : 0, opacity: access === 'select' ? 1 : 0 }}
                className="overflow-hidden">
                <div className="space-y-1 mb-3 max-h-44 overflow-y-auto">
                  {agents.length === 0 && <p className="text-xs text-fg-3 py-2">{String(t.noActiveAgents)}</p>}
                  {agents.map(a => (
                    <button key={a.id} type="button"
                      onClick={() => setSelected(s => ({ ...s, [a.id]: !s[a.id] }))}
                      aria-pressed={!!selected[a.id]}
                      className={cn('w-full flex items-center justify-between px-3 h-9 rounded-lg text-sm cursor-pointer transition-colors border',
                        selected[a.id] ? 'bg-accent/12 border-accent/50 text-accent-fg' : 'bg-card-2 border-border text-fg-2 hover:text-fg')}>
                      <span>{a.name}</span>
                      {selected[a.id] && <Check size={14} aria-hidden="true" />}
                    </button>
                  ))}
                </div>
              </motion.div>
              <p className="text-xs font-semibold text-fg-2 mb-2">{String(t.accessLevel)}</p>
              <SegmentedControl<'ro' | 'rw'>
                options={[{ value: 'ro', label: String(t.readOnly) }, { value: 'rw', label: String(t.readWrite) }]}
                value={canWrite ? 'rw' : 'ro'}
                onChange={v => setCanWrite(v === 'rw')}
                ariaLabel={String(t.accessLevel)}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setOpen(false)}>{String(t.cancel)}</Button>
              <Button variant="primary" onClick={create} disabled={!name.trim() || busy
                || (access === 'select' && agents.length > 0 && !Object.values(selected).some(Boolean))}>
                {busy ? <LoaderCircle size={15} className="animate-spin" aria-hidden="true" /> : String(t.create)}
              </Button>
            </div>
          </DialogContent>
        )}
      </Dialog>

      {/* manage-access dialog */}
      <Dialog open={!!manage} onOpenChange={o => { if (!o) setManage(null) }}>
        {manage && <ManageAccessInner vault={manage} grants={grants} agents={agents} t={t} onClose={() => { setManage(null); load() }} />}
      </Dialog>

      {/* E2 : suppression de vault — window.confirm → ConfirmDialog (focus
          Annuler, conséquence écrite par vaultDeleteConfirm, précondition
          « doit être vide » incluse dans la clé). */}
      <ConfirmDialog
        open={!!delTarget}
        onOpenChange={o => { if (!o) setDelTarget(null) }}
        title={String(t.delete)}
        message={String(t.vaultDeleteConfirm(delTarget?.name ?? ''))}
        confirmLabel={String(t.delete)}
        busy={delBusy}
        onConfirm={() => del(delTarget)}
      />
    </div>
  )
}

function ManageAccessInner({ vault, grants, agents, onClose, t }: {
  vault: any; grants: any[]; agents: any[]; onClose: () => void; t: any
}) {
  const [busy, setBusy] = React.useState(false)
  const [newAgent, setNewAgent] = React.useState('')
  const [revokeTarget, setRevokeTarget] = React.useState<{ id: string; name: string } | null>(null)
  const mine = grants.filter(g => g.vault_id === vault.id)
  const grantedIds = new Set(mine.map(g => g.agent_id))
  const agentById = Object.fromEntries(agents.map(a => [a.id, a]))
  const available = agents.filter(a => !grantedIds.has(a.id))

  const setLevel = async (agentId: string, canWrite: boolean) => {
    setBusy(true)
    try { await api('POST', '/admin/grants', { agent_id: agentId, vault_id: vault.id, can_write: canWrite }); onClose() }
    catch (e) { toast.error(friendly(e)) }
    setBusy(false)
  }
  const revoke = async (agentId: string) => {
    setBusy(true)
    try { await api('DELETE', '/admin/grants', { agent_id: agentId, vault_id: vault.id }); onClose() }
    catch (e) { toast.error(friendly(e)) }
    setBusy(false)
  }
  const grantNew = async () => {
    if (!newAgent) return
    await setLevel(newAgent, true)
  }

  return (
    <>
      <DialogContent title={`${String(t.manageAccess)} « ${vault.name} »`} className="max-w-md max-h-[80vh] overflow-y-auto">
        {mine.length === 0 && <p className="text-sm text-fg-2 mb-4">{String(t.nobody)}</p>}
        <div className="space-y-1.5 mb-5">
          {mine.map(g => {
            const a = agentById[g.agent_id]
            const name = a?.name || g.agent_id.slice(0, 8)
            return (
              <div key={g.agent_id} className="flex items-center justify-between bg-card-2 border border-border rounded-lg px-3 h-10">
                <span className="text-sm font-medium">{name}</span>
                <div className="flex items-center gap-1.5">
                  <SegmentedControl<'ro' | 'rw'>
                    options={[{ value: 'ro', label: 'RO' }, { value: 'rw', label: 'RW' }]}
                    value={g.can_write ? 'rw' : 'ro'}
                    onChange={v => setLevel(g.agent_id, v === 'rw')}
                    ariaLabel={`${String(t.accessLevel)} — ${name}`}
                    size="sm"
                  />
                  <Tip label={String(t.removeAccess(name, vault.name))}>
                    <button onClick={() => setRevokeTarget({ id: g.agent_id, name })} disabled={busy}
                      aria-label={String(t.revoke)}
                      className="h-7 px-2 rounded-md text-danger hover:bg-danger/10 cursor-pointer transition-colors">
                      <Trash2 size={13} aria-hidden="true" />
                    </button>
                  </Tip>
                </div>
              </div>
            )
          })}
        </div>
        {available.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-fg-2 mb-2">{String(t.grantAccess)}</p>
            <div className="flex gap-2">
              <Select value={newAgent} onChange={e => setNewAgent(e.target.value)}
                aria-label={String(t.grantAccess)} className="flex-1">
                <option value="">{String(t.chooseAgent)}</option>
                {available.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </Select>
              <Button variant="primary" onClick={grantNew} disabled={!newAgent || busy} aria-label={String(t.grantAccess)}>
                {busy ? <LoaderCircle size={15} className="animate-spin" aria-hidden="true" /> : <Plus size={15} aria-hidden="true" />}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>

      {/* révocation d'accès — confirm natif → ConfirmDialog : l'agent perd
          immédiatement l'accès (conséquence écrite par removeAccess). */}
      <ConfirmDialog
        open={!!revokeTarget}
        onOpenChange={o => { if (!o) setRevokeTarget(null) }}
        title={String(t.revoke)}
        message={String(t.removeAccess(revokeTarget?.name ?? '', vault.name))}
        confirmLabel={String(t.revoke)}
        busy={busy}
        onConfirm={() => revoke(revokeTarget?.id ?? '')}
      />
    </>
  )
}
