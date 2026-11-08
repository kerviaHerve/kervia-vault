import * as React from 'react'
import { motion } from 'framer-motion'
import { Bot, Archive, KeyRound, Activity, ScrollText } from 'lucide-react'
import { useLang } from '@/i18n'
import { api, friendly } from '@/lib/api'
import { Badge, StatsSkeleton, Loading, Table, Th, Td, Alert } from '@/components/ui'
import { fmtDateTime } from '@/lib/utils'

export default function Dashboard({ go }: { go: (p: string) => void }) {
  const { t } = useLang()
  const [data, setData] = React.useState<{ agents: any[]; vaults: any[]; audit: any[]; secrets: number } | null>(null)
  const [err, setErr] = React.useState<string | null>(null)

  const load = React.useCallback(() => {
    setErr(null)
    Promise.all([
      api('GET', '/admin/agents'), api('GET', '/admin/vaults'), api('GET', '/admin/audit?limit=8'),
    ]).then(async ([agents, vaults, audit]) => {
      let count = 0
      for (const v of vaults) {
        const s = await api('GET', `/admin/secrets?vault=${v.name}`)
        count += Array.isArray(s) ? s.length : 0
      }
      setData({ agents, vaults, audit, secrets: count })
    }).catch(e => setErr(friendly(e)))
  }, [])

  React.useEffect(() => { load() }, [load])

  // v1.8.6 : loading = squelette (fin du `return null` → flash de page vide),
  // erreur = bannière + retry (fin de la page blanche à vie sur session expirée).
  if (err) {
    return (
      <div>
        <h1 className="text-xl font-bold tracking-tight mb-1">{String(t.dashTitle)}</h1>
        <div className="mt-6">
          <Alert tone="danger">{err}</Alert>
          <button onClick={load} className="mt-4 h-9 px-4 rounded-lg text-sm font-semibold cursor-pointer bg-accent text-accent-text">
            {String(t.retry)}
          </button>
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div>
        <h1 className="text-xl font-bold tracking-tight mb-1 sr-only">{String(t.dashTitle)}</h1>
        <StatsSkeleton />
        <div className="mt-6"><Loading rows={5} label={String(t.loading)} /></div>
      </div>
    )
  }

  const active = data.agents.filter(a => !a.revoked_at).length

  // v1.8.6 (audit bug n°2) : les cartes routaient sur le LIBELLÉ traduit
  // (« Activité récente » → #activité : lien mort). Route = id stable.
  const stats = [
    { id: 'agents', label: String(t.statActiveAgents), value: active, icon: Bot },
    { id: 'vaults', label: String(t.statVaults), value: data.vaults.length, icon: Archive },
    { id: 'secrets', label: String(t.statSecrets), value: data.secrets, icon: KeyRound },
    { id: 'audit', label: String(t.statActivity), value: data.audit.length, icon: Activity },
  ]

  const badge = (a: string) =>
    a === 'create' ? 'ok' : a === 'delete' || a === 'login_fail' ? 'danger' : a === 'update' ? 'accent' : 'neutral'

  return (
    <div>
      <h1 className="text-xl font-bold tracking-tight mb-1">{String(t.dashTitle)}</h1>
      <p className="text-sm text-fg-2 mb-6">{String(t.dashSub)}</p>

      {/* v1.8.6 : grid-cols-2 sur mobile (reflow 320px), aria-label descriptif par carte */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {stats.map(({ id, label, value, icon: Icon }, i) => (
          <motion.button
            key={id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            onClick={() => go(id)}
            aria-label={`${label} — ${value}`}
            className="bg-card border border-border rounded-xl p-5 text-left hover:border-border-2 transition-colors cursor-pointer"
          >
            <div className="flex items-center justify-between">
              <span className="text-3xl font-bold tracking-tight tabular-nums">{value}</span>
              <Icon size={18} className="text-fg-3" aria-hidden="true" />
            </div>
            <div className="text-xs text-fg-2 font-medium mt-1">{label}</div>
          </motion.button>
        ))}
      </div>

      {/* v1.8.6 : vrai thead (avant : aucune en-tête pour les lecteurs d'écran) */}
      <Table label={String(t.lastActivity)}>
        <thead>
          <tr>
            <Th className="w-44">{String(t.when)}</Th>
            <Th className="w-36">{String(t.who)}</Th>
            <Th className="w-32">{String(t.action)}</Th>
            <Th>{String(t.resource)}</Th>
          </tr>
        </thead>
        <tbody>
          {data.audit.map((e: any) => (
            <tr key={e.id} className="border-b border-border/50 last:border-0 hover:bg-card-2/50 transition-colors">
              <Td className="text-fg-2 text-xs whitespace-nowrap">{fmtDateTime(e.ts)}</Td>
              <Td className="font-medium">{e.agent_id}</Td>
              <Td><Badge variant={badge(e.action) as any}>{e.action}</Badge></Td>
              <Td className="font-mono text-xs text-fg-2 truncate">{e.resource}</Td>
            </tr>
          ))}
          {data.audit.length === 0 && (
            <tr><Td className="py-10 text-center text-fg-3"><ScrollText size={32} className="mx-auto mb-3 opacity-50" aria-hidden="true" />{String(t.noEntries)}</Td></tr>
          )}
        </tbody>
      </Table>
    </div>
  )
}
