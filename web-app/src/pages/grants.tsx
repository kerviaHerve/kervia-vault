import * as React from 'react'
import { toast } from 'sonner'
import { api } from '@/lib/api'

export default function Grants() {
  const [agents, setAgents] = React.useState<any[]>([])
  const [vaults, setVaults] = React.useState<any[]>([])
  const [grants, setGrants] = React.useState<any[]>([])

  const load = async () => {
    const [a, v, g] = await Promise.all([api('GET', '/admin/agents'), api('GET', '/admin/vaults'), api('GET', '/admin/grants')])
    setAgents(a.filter((x: any) => !x.revoked_at)); setVaults(v); setGrants(g)
  }
  React.useEffect(() => { load() }, [])

  const level = (aid: string, vid: string) => {
    const g = grants.find(g => g.agent_id === aid && g.vault_id === vid)
    if (!g) return 'none'
    return g.can_write ? 'rw' : 'ro'
  }
  const cycle = async (aid: string, vid: string, to: string) => {
    if (to === 'none') await api('DELETE', '/admin/grants', { agent_id: aid, vault_id: vid })
    else await api('POST', '/admin/grants', { agent_id: aid, vault_id: vid, can_write: to === 'rw' })
    load()
  }

  const cells = { none: ['—', 'ro', 'text-fg-3'], ro: ['RO', 'rw', 'text-accent bg-accent/12'], rw: ['RW', 'none', 'text-accent bg-accent/15'] } as const

  return (
    <div>
      <h1 className="text-xl font-bold tracking-tight mb-1">Permissions</h1>
      <p className="text-sm text-fg-2 mb-6">Cliquez sur une case : rien → lecture → lecture+écriture → rien.</p>

      <div className="bg-card border border-border rounded-xl overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-fg-3">Agent ↓ / Vault →</th>
              {vaults.map(v => (
                <th key={v.id} className="px-3 py-3 text-[11px] font-semibold text-fg-3">{v.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {agents.map(a => (
              <tr key={a.id} className="border-b border-border/50 last:border-0">
                <td className="px-5 py-2.5 font-semibold">{a.name}</td>
                {vaults.map(v => {
                  const [label, next, cls] = cells[level(a.id, v.id) as 'none' | 'ro' | 'rw']
                  return (
                    <td key={v.id} className="px-3 py-2 text-center">
                      <button
                        onClick={() => cycle(a.id, v.id, next)}
                        className={`w-14 py-1 rounded-md text-[11px] font-bold cursor-pointer transition-colors hover:brightness-125 ${cls}`}
                      >
                        {label}
                      </button>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
