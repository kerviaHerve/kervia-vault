import * as React from 'react'
import { ScrollText } from 'lucide-react'
import { api } from '@/lib/api'
import { Badge } from '@/components/ui'
import { fmtDateTime } from '@/lib/utils'

export default function Audit() {
  const [entries, setEntries] = React.useState<any[] | null>(null)
  React.useEffect(() => { api('GET', '/admin/audit?limit=100').then(setEntries) }, [])
  if (!entries) return null

  const badge = (a: string) =>
    a === 'create' ? 'ok' : a === 'delete' || a === 'login_fail' ? 'danger'
    : a === 'update' ? 'accent' : a === 'rate_limited' ? 'warn' : 'neutral'

  return (
    <div>
      <h1 className="text-xl font-bold tracking-tight mb-1">Audit</h1>
      <p className="text-sm text-fg-2 mb-6">Chaque lecture, écriture et accès refusé — trace append-only.</p>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-fg-3">
              {['Horodatage', 'Agent', 'Action', 'Ressource', 'Détail'].map(h => (
                <th key={h} className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries.map(e => (
              <tr key={e.id} className="border-b border-border/50 last:border-0 hover:bg-card-2/50 transition-colors">
                <td className="px-5 py-2.5 text-xs text-fg-2 whitespace-nowrap">{fmtDateTime(e.ts)}</td>
                <td className="px-5 py-2.5 font-medium">{e.agent_id}</td>
                <td className="px-5 py-2.5"><Badge variant={badge(e.action) as any}>{e.action}</Badge></td>
                <td className="px-5 py-2.5 font-mono text-xs text-fg-2">{e.resource}</td>
                <td className="px-5 py-2.5 text-xs text-fg-3">{e.detail || '—'}</td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr><td colSpan={5} className="py-14 text-center text-fg-3">
                <ScrollText className="mx-auto mb-3 opacity-50" size={32} />Aucune activité.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
