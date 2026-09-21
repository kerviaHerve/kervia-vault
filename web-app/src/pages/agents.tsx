import * as React from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Plus, Copy, Ban, Trash2, LoaderCircle, Bot } from 'lucide-react'
import { toast } from 'sonner'
import { useLang } from '@/i18n'
import { api } from '@/lib/api'
import { Button, Badge, Dialog, DialogContent, Input, Field } from '@/components/ui'
import { fmtDateTime } from '@/lib/utils'

export default function Agents() {
  const { t } = useLang()
  const [agents, setAgents] = React.useState<any[] | null>(null)
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [keyModal, setKeyModal] = React.useState<{ name: string; key: string } | null>(null)

  const load = () => api('GET', '/admin/agents').then(setAgents)
  React.useEffect(() => { load() }, [])

  const create = async () => {
    if (!name.trim() || busy) return
    setBusy(true)
    try {
      const d = await api('POST', '/admin/agents', { name: name.trim() })
      setOpen(false); setName('')
      setKeyModal({ name: d.agent.name, key: d.api_key })
      load()
    } catch (e: any) { toast.error(e.message) }
    setBusy(false)
  }

  const revoke = async (id: string, name: string) => {
    if (!confirm(t.revokeConfirm(name))) return
    await api('POST', `/admin/agents/${id}/revoke`)
    toast.success(t.revokedToast(name))
    load()
  }

  const purge = async (id: string, name: string) => {
    if (!confirm(t.purgeConfirm(name))) return
    try {
      await api('DELETE', `/admin/agents/${id}`)
      toast.success(t.purgedToast(name))
      load()
    } catch (e: any) { toast.error(e.message === 'not_revoked' ? 'Révoquez d\'abord l\'agent' : e.message) }
  }

  if (!agents) return null

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold tracking-tight mb-1">Agents</h1>
          <p className="text-sm text-fg-2">{String(t.agentsSub)}</p>
        </div>
        <Button variant="primary" onClick={() => setOpen(true)}><Plus size={16} /> {String(t.newAgent)}</Button>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-fg-3">
              {[t.agents ? 'Nom' : '', t.key ? 'Key' : '', 'Statut', 'Dernier accès', 'Créé', ''].map(h => (
                <th key={h} className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {agents.map(a => (
              <tr key={a.id} className="border-b border-border/50 last:border-0 hover:bg-card-2/50 transition-colors">
                <td className="px-5 py-3"><span className="font-semibold">{a.name}</span></td>
                <td className="px-5 py-3 font-mono text-xs text-fg-2">{a.key_prefix}…</td>
                <td className="px-5 py-3">
                  <Badge variant={a.revoked_at ? 'danger' : 'ok'}>
                    {a.revoked_at ? String(t.revoked) : String(t.active)}
                  </Badge>
                </td>
                <td className="px-5 py-3 text-fg-2 text-xs">{fmtDateTime(a.last_used)}</td>
                <td className="px-5 py-3 text-fg-2 text-xs">{fmtDateTime(a.created_at)}</td>
                <td className="px-5 py-3 text-right">
                  {!a.revoked_at
                  ? <Button variant="destructive" size="sm" onClick={() => revoke(a.id, a.name)}><Ban size={13} /> {String(t.revoke)}</Button>
                  : <Button variant="destructive" size="sm" onClick={() => purge(a.id, a.name)}><Trash2 size={13} /> {String(t.delete)}</Button>}
                </td>
              </tr>
            ))}
            {agents.length === 0 && (
              <tr><td colSpan={6} className="py-14 text-center text-fg-3">
                <Bot className="mx-auto mb-3 opacity-50" size={32} />
                {String(t.noAgents)}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        {open && <DialogContent title="Nouvel agent">
          <Field label={String(t.agentName)} help={String(t.agentNameHelp)}>
            <Input value={name} autoFocus onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && create()} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setOpen(false)}>{String(t.cancel)}</Button>
            <Button variant="primary" onClick={create} disabled={!name.trim() || busy}>
              {busy ? <LoaderCircle size={15} className="animate-spin" /> : String(t.create)}
            </Button>
          </div>
        </DialogContent>}
      </Dialog>

      {/* the key reveal ritual */}
      <AnimatePresence>
        {keyModal && (
          <motion.div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 grid place-items-center"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={(e: React.MouseEvent) => e.target === e.currentTarget && setKeyModal(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 8 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 400, damping: 28 }}
              className="w-[440px] bg-card border border-accent/40 rounded-2xl overflow-hidden shadow-2xl"
            >
              <div className="px-6 py-4 border-b border-border font-semibold flex items-center gap-2">
                <Bot size={16} className="text-accent" /> {String(t.keyCreatedTitle(keyModal.name))}
              </div>
              <div className="p-6">
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.15 }}
                  className="bg-bg border border-accent rounded-lg p-3.5 font-mono text-xs text-accent break-all leading-relaxed"
                >
                  {keyModal.key}
                </motion.div>
                <div className="flex items-center gap-3 mt-4">
                  <Button onClick={() => { navigator.clipboard.writeText(keyModal.key); toast.success(String(t.keyCopied)) }}>
                    <Copy size={14} /> Copier
                  </Button>
                  <span className="text-xs text-fg-2">{String(t.keyUsage)}</span>
                </div>
                <div className="mt-4 bg-warn/10 text-warn rounded-lg px-3.5 py-2.5 text-xs font-semibold flex items-center gap-2">
                  ⚠ {String(t.keyWarning)}
                </div>
              </div>
              <div className="px-6 py-4 border-t border-border flex justify-end">
                <Button variant="primary" onClick={() => setKeyModal(null)}>{String(t.keyCopiedConfirm)}</Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
