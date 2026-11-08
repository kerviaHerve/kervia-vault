import * as React from 'react'
import { Archive, Users, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { api, friendly } from '@/lib/api'
import { useLang } from '@/i18n'
import { Button, Alert, ConfirmDialog, EmptyState, Loading, Table, Th, Td } from '@/components/ui'
import { cn } from '@/lib/utils'

// Pattern exceptionnel autorisé (fondation §7) : la matrice est un tableau
// technique — les aria-labels de cellules composent agent + vault + niveau
// via une table bilingue LOCALE, sans clé i18n par cellule.
const MATRIX_LABELS = {
  fr: {
    corner: 'Lignes\u00A0: agents — colonnes\u00A0: vaults',
    none: 'aucun accès',
    cell: (agent: string, vault: string, cur: string, next: string) =>
      `Accès de ${agent} à ${vault}\u00A0: ${cur}. Cliquer\u00A0: ${next}`,
  },
  en: {
    corner: 'Rows: agents — columns: vaults',
    none: 'no access',
    cell: (agent: string, vault: string, cur: string, next: string) =>
      `${agent}'s access to ${vault}: ${cur}. Click: ${next}`,
  },
} as const

export default function Grants() {
  const { t, lang } = useLang()
  const L = MATRIX_LABELS[lang]
  const [agents, setAgents] = React.useState<any[]>([])
  const [vaults, setVaults] = React.useState<any[]>([])
  const [grants, setGrants] = React.useState<any[]>([])
  const [loaded, setLoaded] = React.useState(false)
  const [err, setErr] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  // H1 : retrait d'accès en attente de confirmation (agent + vault pour le message)
  const [pending, setPending] = React.useState<{ aid: string; vid: string; agent: string; vault: string } | null>(null)

  const load = async () => {
    setErr(null)
    try {
      const [a, v, g] = await Promise.all([api('GET', '/admin/agents'), api('GET', '/admin/vaults'), api('GET', '/admin/grants')])
      setAgents(a.filter((x: any) => !x.revoked_at)); setVaults(v); setGrants(g)
      setLoaded(true)
    } catch (e) {
      setErr(friendly(e)) // H2 : bannière + retry, pas de matrice fantôme
    }
  }
  React.useEffect(() => { load() }, [])

  const level = (aid: string, vid: string) => {
    const g = grants.find(g => g.agent_id === aid && g.vault_id === vid)
    if (!g) return 'none'
    return g.can_write ? 'rw' : 'ro'
  }

  // H2 : toute mutation passe par ici — en cas d'échec on toast ET on
  // recharge la matrice : l'UI doit refléter le serveur, jamais l'intention.
  const apply = async (aid: string, vid: string, to: string) => {
    setBusy(true)
    try {
      if (to === 'none') await api('DELETE', '/admin/grants', { agent_id: aid, vault_id: vid })
      else await api('POST', '/admin/grants', { agent_id: aid, vault_id: vid, can_write: to === 'rw' })
    } catch (e) {
      toast.error(friendly(e))
    }
    setBusy(false)
    await load() // toujours : succès comme échec
  }

  // H1 : le cycle à un clic peut couper un agent en production — toute
  // transition VERS « aucun accès » exige une confirmation écrite. Les
  // transitions none→RO→RW restent directes (réversibles).
  const cycle = (aid: string, vid: string, to: string, agent: string, vault: string) => {
    if (to === 'none') { setPending({ aid, vid, agent, vault }); return }
    apply(aid, vid, to)
  }

  const cells = { none: ['—', 'ro', 'text-fg-3'], ro: ['RO', 'rw', 'text-accent-fg bg-accent/12'], rw: ['RW', 'none', 'text-accent-fg bg-accent/15'] } as const
  const levelWord = (l: string) => (l === 'none' ? L.none : l.toUpperCase())

  if (err) {
    return (
      <div>
        <h1 className="text-xl font-bold tracking-tight mb-1">{String(t.grantsTitle)}</h1>
        <div className="mt-6">
          <Alert tone="danger">{err}</Alert>
          <Button variant="primary" className="mt-4" onClick={load}>{String(t.retry)}</Button>
        </div>
      </div>
    )
  }

  if (!loaded) {
    return (
      <div>
        <h1 className="text-xl font-bold tracking-tight mb-1 sr-only">{String(t.grantsTitle)}</h1>
        <Loading rows={6} label={String(t.loading)} />
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-xl font-bold tracking-tight mb-1">{String(t.grantsTitle)}</h1>
      <p className="text-sm text-fg-2 mb-6">{String(t.grantsSub)}</p>

      {agents.length === 0 ? (
        <EmptyState
          icon={<Users size={28} aria-hidden="true" />}
          title={String(t.grantsNoAgents)}
          action={<Button variant="primary" onClick={() => { window.location.hash = 'agents' }}><Plus size={15} aria-hidden="true" /> {String(t.newAgent)}</Button>}
        />
      ) : vaults.length === 0 ? (
        <EmptyState
          icon={<Archive size={28} aria-hidden="true" />}
          title={String(t.grantsNoVaults)}
          action={<Button variant="primary" onClick={() => { window.location.hash = 'vaults' }}><Plus size={15} aria-hidden="true" /> {String(t.newVault)}</Button>}
        />
      ) : (
        <>
          {/* légende visuelle des niveaux — l'état n'est pas porté par la couleur seule */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mb-4 text-2xs text-fg-3">
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="inline-flex items-center justify-center px-2 py-0.5 rounded-md text-2xs font-bold text-fg-3">—</span>
              {L.none}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="inline-flex items-center justify-center px-2 py-0.5 rounded-md text-2xs font-bold text-accent-fg bg-accent/12">RO</span>
              {String(t.readOnly)}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="inline-flex items-center justify-center px-2 py-0.5 rounded-md text-2xs font-bold text-accent-fg bg-accent/15">RW</span>
              {String(t.readWrite)}
            </span>
          </div>

          <Table label={String(t.grantsTitle)}>
            <thead>
              <tr>
                {/* en-tête diagonal — le glyphe reste, l'aria-label explique la lecture */}
                <Th aria-label={L.corner} className="whitespace-nowrap">{String(t.agentVault)}</Th>
                {vaults.map(v => (
                  <Th key={v.id} className="text-center whitespace-nowrap">{v.name}</Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {agents.map(a => (
                <tr key={a.id} className="hover:bg-card-2/50 transition-colors">
                  <Td className="font-semibold whitespace-nowrap">{a.name}</Td>
                  {vaults.map(v => {
                    const cur = level(a.id, v.id) as 'none' | 'ro' | 'rw'
                    const [label, next, cls] = cells[cur]
                    return (
                      <Td key={v.id} className="text-center px-3">
                        <button
                          onClick={() => cycle(a.id, v.id, next, a.name, v.name)}
                          disabled={busy}
                          aria-label={L.cell(a.name, v.name, levelWord(cur), levelWord(next))}
                          className={cn('w-14 h-8 rounded-md text-2xs font-bold cursor-pointer transition-colors hover:brightness-125', cls)}
                        >
                          {label}
                        </button>
                      </Td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </Table>
        </>
      )}

      {/* H1 : retrait d'accès = interruption possible en production → ConfirmDialog */}
      <ConfirmDialog
        open={!!pending}
        onOpenChange={o => { if (!o) setPending(null) }}
        title={String(t.grantRemoveTitle)}
        message={String(t.grantRemoveConfirm(pending?.agent ?? '', pending?.vault ?? ''))}
        confirmLabel={String(t.grantRemoveTitle)}
        busy={busy}
        onConfirm={() => (pending ? apply(pending.aid, pending.vid, 'none') : undefined)}
      />
    </div>
  )
}
