import * as React from 'react'
import { Plus, Ban, Trash2, LoaderCircle, Bot, Download } from 'lucide-react'
import { toast } from 'sonner'
import { useLang } from '@/i18n'
import { api, friendly } from '@/lib/api'
import { Button, Badge, Dialog, DialogContent, Input, Field, ConfirmDialog, Alert, CodeReveal, Table, Th, Td, Loading, EmptyState, Tip, PageHeader } from '@/components/ui'
import { fmtDateTime } from '@/lib/utils'

export default function Agents() {
  const { t, lang } = useLang()
  const [agents, setAgents] = React.useState<any[] | null>(null)
  const [loadErr, setLoadErr] = React.useState(false)
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [keyModal, setKeyModal] = React.useState<{ name: string; key: string } | null>(null)
  const [confirming, setConfirming] = React.useState<{ kind: 'revoke' | 'purge'; id: string; name: string } | null>(null)

  const load = () => {
    setLoadErr(false)
    api('GET', '/admin/agents').then(setAgents).catch(() => setLoadErr(true))
  }
  React.useEffect(() => { load() }, [])

  const create = async () => {
    if (!name.trim() || busy) return
    setBusy(true)
    try {
      const d = await api('POST', '/admin/agents', { name: name.trim() })
      setOpen(false); setName('')
      setKeyModal({ name: d.agent.name, key: d.api_key })
      load()
    } catch (e) { toast.error(friendly(e)) }
    setBusy(false)
  }

  const revoke = async (id: string, agentName: string) => {
    try {
      await api('POST', `/admin/agents/${id}/revoke`)
      toast.success(String(t.revokedToast(agentName)))
      load()
    } catch (e) { toast.error(friendly(e)) }
  }

  const purge = async (id: string, agentName: string) => {
    try {
      await api('DELETE', `/admin/agents/${id}`)
      toast.success(String(t.purgedToast(agentName)))
      load()
    } catch (e) { toast.error(friendly(e)) }
  }

  // pattern K (cf. wizard) : le .txt est le seul endroit où une clé API doit
  // vivre — bilingue, rappel KERVIA_VAULT_API_KEY, la clé n'est plus jamais
  // ré-affichée ensuite.
  const K = {
    fr: {
      title: (n: string) => `Kervia-vault — CLÉ API AGENT "${n}"`,
      intro: 'À coller dans KERVIA_VAULT_API_KEY :',
      warn: 'Ne partagez jamais cette clé. Elle ne sera plus jamais affichée.',
      lost: 'Perdue ou exposée ? Révoquez-la dans la webui et créez-en une neuve.',
    },
    en: {
      title: (n: string) => `Kervia-vault — API KEY FOR AGENT "${n}"`,
      intro: 'Paste into KERVIA_VAULT_API_KEY:',
      warn: 'Never share this key. It will never be shown again.',
      lost: 'Lost or exposed? Revoke it in the webui and create a new one.',
    },
  }
  const k = K[lang] || K.fr
  const downloadKey = (agentName: string, key: string) => {
    const txt = [k.title(agentName), '='.repeat(30), '', k.intro, key, '', k.warn, k.lost].join('\n')
    const blob = new Blob([txt], { type: 'text/plain' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'kervia-vault-api-key.txt'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const newAgentBtn = (
    <Button variant="primary" onClick={() => setOpen(true)}>
      <Plus size={16} aria-hidden="true" /> {String(t.newAgent)}
    </Button>
  )

  // erreur ≠ vide (contrat v1.8.6) : un échec de chargement ne se déguise
  // JAMAIS en « Aucun agent » — bannière danger + réessayer.
  if (loadErr && !agents) return (
    <div>
      <PageHeader title={String(t.agentsTitle)} sub={String(t.agentsSub)} actions={newAgentBtn} />
      <Alert tone="danger">
        <div className="flex items-center justify-between gap-3">
          <span>{String(t.loadFailed)}</span>
          <Button size="sm" onClick={load}>{String(t.retry)}</Button>
        </div>
      </Alert>
    </div>
  )

  if (!agents) return (
    <div>
      <PageHeader title={String(t.agentsTitle)} sub={String(t.agentsSub)} actions={newAgentBtn} />
      <Loading label={String(t.loading)} />
    </div>
  )

  return (
    <div>
      <PageHeader title={String(t.agentsTitle)} sub={String(t.agentsSub)} actions={newAgentBtn} />

      {loadErr && (
        <Alert tone="danger" className="mb-4">
          <div className="flex items-center justify-between gap-3">
            <span>{String(t.loadFailed)}</span>
            <Button size="sm" onClick={load}>{String(t.retry)}</Button>
          </div>
        </Alert>
      )}

      <Table label={String(t.agentsTitle)}>
        <thead>
          <tr>
            <Th>{String(t.name)}</Th>
            <Th>{String(t.key)}</Th>
            <Th>{String(t.status)}</Th>
            <Th>{String(t.lastAccess)}</Th>
            <Th>{String(t.created)}</Th>
            <Th className="text-right">{String(t.actions)}</Th>
          </tr>
        </thead>
        <tbody className="[&_tr:last-child>td]:border-0">
          {agents.map(a => (
            <tr key={a.id} className="hover:bg-card-2/50 transition-colors">
              <Td className="font-semibold">{a.name}</Td>
              <Td className="font-mono text-xs text-fg-2">{a.key_prefix}…</Td>
              <Td>
                <Badge variant={a.revoked_at ? 'danger' : 'ok'}>
                  {a.revoked_at ? String(t.revoked) : String(t.active)}
                </Badge>
              </Td>
              <Td className="text-fg-2 text-xs">{fmtDateTime(a.last_used)}</Td>
              <Td className="text-fg-2 text-xs">{fmtDateTime(a.created_at)}</Td>
              <Td className="text-right">
                {!a.revoked_at
                ? <Tip label={String(t.revoke)}>
                    <Button variant="destructive" size="iconSm" aria-label={String(t.revoke)}
                      onClick={() => setConfirming({ kind: 'revoke', id: a.id, name: a.name })}>
                      <Ban size={13} aria-hidden="true" />
                    </Button>
                  </Tip>
                : <Tip label={String(t.purge)}>
                    <Button variant="destructive" size="iconSm" aria-label={String(t.purge)}
                      onClick={() => setConfirming({ kind: 'purge', id: a.id, name: a.name })}>
                      <Trash2 size={13} aria-hidden="true" />
                    </Button>
                  </Tip>}
              </Td>
            </tr>
          ))}
          {agents.length === 0 && (
            <tr>
              <td colSpan={6} className="p-0">
                <EmptyState
                  icon={<Bot size={26} aria-hidden="true" />}
                  title={String(t.noAgents)}
                  action={newAgentBtn}
                />
              </td>
            </tr>
          )}
        </tbody>
      </Table>

      <Dialog open={open} onOpenChange={setOpen}>
        {open && <DialogContent title={String(t.newAgent)}>
          <Field label={String(t.agentName)} help={String(t.agentNameHelp)}>
            <Input value={name} autoFocus onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && create()} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setOpen(false)}>{String(t.cancel)}</Button>
            <Button variant="primary" onClick={create} disabled={!name.trim() || busy}>
              {busy ? <LoaderCircle size={15} className="animate-spin" aria-hidden="true" /> : String(t.create)}
            </Button>
          </div>
        </DialogContent>}
      </Dialog>

      {/* the key reveal ritual — la clé est affichée UNE fois : une fermeture
          accidentelle (Escape, clic overlay, croix) la perdrait à jamais.
          Escape et overlay sont neutralisés, et onOpenChange ignore les
          demandes de fermeture : la SEULE sortie est la confirmation. */}
      <Dialog open={!!keyModal} onOpenChange={() => { /* garde-fou : voir commentaire ci-dessus */ }}>
        {keyModal && (
          <DialogContent
            title={String(t.keyCreatedTitle(keyModal.name))}
            description={String(t.keyUsage)}
            onEscapeKeyDown={e => e.preventDefault()}
            onInteractOutside={e => e.preventDefault()}
          >
            <Alert tone="warn" className="mb-4">{String(t.keyWarning)}</Alert>
            <CodeReveal value={keyModal.key} masked label={String(t.key)} />
            <div className="flex flex-wrap justify-end gap-2 mt-5">
              <Button onClick={() => downloadKey(keyModal.name, keyModal.key)}>
                <Download size={14} aria-hidden="true" /> {String(t.download)}
              </Button>
              <Button variant="primary" onClick={() => setKeyModal(null)}>{String(t.keyCopiedConfirm)}</Button>
            </div>
          </DialogContent>
        )}
      </Dialog>

      <ConfirmDialog
        open={!!confirming}
        onOpenChange={o => { if (!o) setConfirming(null) }}
        title={String(confirming?.kind === 'purge' ? t.purge : t.revoke)}
        message={confirming ? String(confirming.kind === 'purge' ? t.purgeConfirm(confirming.name) : t.revokeConfirm(confirming.name)) : ''}
        confirmLabel={String(confirming?.kind === 'purge' ? t.purge : t.revoke)}
        onConfirm={async () => {
          if (!confirming) return
          if (confirming.kind === 'purge') await purge(confirming.id, confirming.name)
          else await revoke(confirming.id, confirming.name)
        }}
      />
    </div>
  )
}
