import * as React from 'react'
import { Plus, Archive } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { Button, Dialog, DialogContent, Input, Field } from '@/components/ui'
import { fmtDate } from '@/lib/utils'

export default function Vaults() {
  const [vaults, setVaults] = React.useState<any[] | null>(null)
  const [grants, setGrants] = React.useState<any[]>([])
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState('')

  const load = async () => {
    const [v, g] = await Promise.all([api('GET', '/admin/vaults'), api('GET', '/admin/grants')])
    setVaults(v); setGrants(g)
  }
  React.useEffect(() => { load() }, [])

  const create = async () => {
    if (!name.trim()) return
    try {
      const d = await api('POST', '/admin/vaults', { name: name.trim() })
      toast.success(`Vault « ${d.name} » créé`); setOpen(false); setName(''); load()
    } catch (e: any) { toast.error(e.message) }
  }

  if (!vaults) return null

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold tracking-tight mb-1">Vaults</h1>
          <p className="text-sm text-fg-2">Un vault par agent ou par usage.</p>
        </div>
        <Button variant="primary" onClick={() => setOpen(true)}><Plus size={16} /> Nouveau vault</Button>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-fg-3">
              {['Nom', 'Secrets', 'Agents autorisés', 'Créé'].map(h => (
                <th key={h} className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {vaults.map(v => (
              <tr key={v.id} className="border-b border-border/50 last:border-0 hover:bg-card-2/50 transition-colors">
                <td className="px-5 py-3"><span className="font-semibold">{v.name}</span></td>
                <td className="px-5 py-3 tabular-nums">{v._count ?? '—'}</td>
                <td className="px-5 py-3 tabular-nums">{grants.filter(g => g.vault_id === v.id).length}</td>
                <td className="px-5 py-3 text-fg-2 text-xs">{fmtDate(v.created_at)}</td>
              </tr>
            ))}
            {vaults.length === 0 && (
              <tr><td colSpan={4} className="py-14 text-center text-fg-3">
                <Archive className="mx-auto mb-3 opacity-50" size={32} />Aucun vault.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        {open && <DialogContent title="Nouveau vault">
          <Field label="Nom du vault" help="ex : rita, ci, commun…">
            <Input value={name} autoFocus onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && create()} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setOpen(false)}>Annuler</Button>
            <Button variant="primary" onClick={create} disabled={!name.trim()}>Créer</Button>
          </div>
        </DialogContent>}
      </Dialog>
    </div>
  )
}
