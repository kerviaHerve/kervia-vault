import * as React from 'react'
import { motion } from 'framer-motion'
import { ScrollText, Globe, Monitor, Bot } from 'lucide-react'
import { api } from '@/lib/api'
import { useLang } from '@/i18n'
import { Badge } from '@/components/ui'
import { fmtDateTime, cn } from '@/lib/utils'

export default function Audit() {
  const { t } = useLang()
  const [entries, setEntries] = React.useState<any[] | null>(null)
  const [filter, setFilter] = React.useState<'all' | 'agent' | 'webui'>('all')
  React.useEffect(() => { api('GET', '/admin/audit?limit=100').then(setEntries) }, [])
  if (!entries) return null

  const badge = (a: string) =>
    a === 'create' ? 'ok' : a === 'delete' || a === 'login_fail' ? 'danger'
    : a === 'update' ? 'accent' : a === 'rate_limited' ? 'warn' : 'neutral'

  const shown = entries.filter(e => filter === 'all' || e.source === filter)

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold tracking-tight mb-1">Audit</h1>
          <p className="text-sm text-fg-2">Tous les accès agents et webui — conservés 90 jours.</p>
        </div>
        <div className="flex gap-1.5">
          {([['all', String(t.all)], ['agent', String(t.agents)], ['webui', 'Webui']] as const).map(([id, label]) => (
            <button key={id} onClick={() => setFilter(id)}
              className={cn(
                'h-8 px-3 rounded-lg text-xs font-medium cursor-pointer transition-colors border',
                filter === id ? 'bg-accent/12 border-accent text-accent' : 'bg-card-2 border-border text-fg-2 hover:text-fg',
              )}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-fg-3">
              {[String(t.when), 'Source', String(t.who), String(t.action), String(t.resource), 'IP', 'Statut'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.slice(0, 100).map((e, i) => (
              <motion.tr
                key={e.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(i * 0.01, 0.3) }}
                className="border-b border-border/50 last:border-0 hover:bg-card-2/50 transition-colors"
              >
                <td className="px-4 py-2.5 text-xs text-fg-2 whitespace-nowrap">{fmtDateTime(e.ts)}</td>
                <td className="px-4 py-2.5">
                  <span className="inline-flex items-center gap-1 text-xs text-fg-2">
                    {e.source === 'webui' ? <Monitor size={12} /> : e.source === 'agent' ? <Bot size={12} /> : <Globe size={12} />}
                    {e.source}
                  </span>
                </td>
                <td className="px-4 py-2.5 font-medium font-mono text-xs max-w-36 truncate">{e.agent_id}</td>
                <td className="px-4 py-2.5"><Badge variant={badge(e.action) as any}>{e.action}</Badge></td>
                <td className="px-4 py-2.5 font-mono text-xs text-fg-2 max-w-56 truncate">{e.path || e.resource}</td>
                <td className="px-4 py-2.5 font-mono text-xs text-fg-2">{e.ip || '—'}</td>
                <td className="px-4 py-2.5">
                  <span className={cn(
                    'font-mono text-xs font-semibold',
                    e.status >= 400 ? 'text-danger' : e.status >= 300 ? 'text-warn' : 'text-accent',
                  )}>{e.status || '—'}</span>
                </td>
              </motion.tr>
            ))}
            {shown.length === 0 && (
              <tr><td colSpan={7} className="py-14 text-center text-fg-3">
                <ScrollText className="mx-auto mb-3 opacity-50" size={32} />{String(t.noEntries)}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
