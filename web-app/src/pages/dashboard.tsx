import * as React from 'react'
import { motion } from 'framer-motion'
import { Bot, Archive, KeyRound, Activity } from 'lucide-react'
import { useLang } from '@/i18n'
import { api } from '@/lib/api'
import { Badge } from '@/components/ui'
import { fmtDateTime } from '@/lib/utils'

export default function Dashboard({ go }: { go: (p: string) => void }) {
  const { t } = useLang()
  const [data, setData] = React.useState<{ agents: any[]; vaults: any[]; audit: any[]; secrets: number } | null>(null)

  React.useEffect(() => {
    Promise.all([
      api('GET', '/admin/agents'), api('GET', '/admin/vaults'), api('GET', '/admin/audit?limit=8'),
    ]).then(async ([agents, vaults, audit]) => {
      let count = 0
      for (const v of vaults) {
        const s = await api('GET', `/admin/secrets?vault=${v.name}`)
        count += Array.isArray(s) ? s.length : 0
      }
      setData({ agents, vaults, audit, secrets: count })
    }).catch(() => {})
  }, [])

  if (!data) return null
  const active = data.agents.filter(a => !a.revoked_at).length

  const stats = [
    { label: String(t.statActiveAgents), value: active, icon: Bot },
    { label: String(t.statVaults), value: data.vaults.length, icon: Archive },
    { label: String(t.statSecrets), value: data.secrets, icon: KeyRound },
    { label: String(t.statActivity), value: data.audit.length, icon: Activity },
  ]

  const badge = (a: string) =>
    a === 'create' ? 'ok' : a === 'delete' || a === 'login_fail' ? 'danger' : a === 'update' ? 'accent' : 'neutral'

  return (
    <div>
      <h1 className="text-xl font-bold tracking-tight mb-1">{String(t.dashTitle)}</h1>
      <p className="text-sm text-fg-2 mb-6">{String(t.dashSub)}</p>

      <div className="grid grid-cols-4 gap-4 mb-6">
        {stats.map(({ label, value, icon: Icon }, i) => (
          <motion.button
            key={label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            onClick={() => go(label.toLowerCase().split(' ')[0])}
            className="bg-card border border-border rounded-xl p-5 text-left hover:border-border-2 transition-colors cursor-pointer"
          >
            <div className="flex items-center justify-between">
              <span className="text-[26px] font-bold tracking-tight tabular-nums">{value}</span>
              <Icon size={18} className="text-fg-3" />
            </div>
            <div className="text-xs text-fg-2 font-medium mt-1">{label}</div>
          </motion.button>
        ))}
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border text-sm font-semibold">{String(t.lastActivity)}</div>
        <table className="w-full text-sm">
          <tbody>
            {data.audit.map((e: any) => (
              <tr key={e.id} className="border-b border-border/50 last:border-0 hover:bg-card-2/50 transition-colors">
                <td className="px-5 py-2.5 text-fg-2 text-xs whitespace-nowrap w-40">{fmtDateTime(e.ts)}</td>
                <td className="px-2 py-2.5 font-medium w-32">{e.agent_id}</td>
                <td className="px-2 py-2.5 w-28"><Badge variant={badge(e.action) as any}>{e.action}</Badge></td>
                <td className="px-5 py-2.5 font-mono text-xs text-fg-2 truncate">{e.resource}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
