import * as React from 'react'
import { motion } from 'framer-motion'
import { ScrollText, Globe, Monitor, Bot, Download, ChevronLeft, ChevronRight } from 'lucide-react'
import { api, friendly } from '@/lib/api'
import { useLang } from '@/i18n'
import {
  Badge, Button, Select, Table, Th, Td, Alert, Loading, EmptyState,
  PageHeader, SegmentedControl,
} from '@/components/ui'
import { fmtDateTime, cn } from '@/lib/utils'

// Pattern exceptionnel autorisé (fondation §7) : table de correspondance
// bilingue LOCALE pour les actions d'audit — codes techniques figés côté
// Go (internal/model/model.go + internal/api). Fallback : la chaîne brute.
const ACTION_LABELS: Record<'fr' | 'en', Record<string, string>> = {
  fr: {
    read: 'Lecture', create: 'Création', update: 'Modification', delete: 'Suppression',
    login: 'Connexion', logout: 'Déconnexion', login_fail: 'Échec de connexion',
    agent_create: 'Agent créé', agent_revoke: 'Agent révoqué', agent_purge: 'Agent supprimé définitivement',
    vault_create: 'Vault créé', vault_delete: 'Vault supprimé',
    vault_delete_denied: 'Suppression refusée (vault non vide)',
    grant: 'Accès donné', grant_revoke: 'Accès retiré', key_rotate: 'Rotation de clé',
    share_create: 'Lien de partage créé', share_view: 'Lien de partage consulté',
    export: 'Export chiffré',
    restore_verify: 'Restauration\u00A0: vérification', restore_import: 'Restauration\u00A0: import',
    '2fa_enroll': '2FA\u00A0: enrôlement', '2fa_enabled': '2FA activée',
    '2fa_disabled': '2FA désactivée', '2fa_reset': '2FA réinitialisée',
    coffre_create: 'Coffre créé', coffre_rekey: 'Coffre\u00A0: mot de passe maître changé',
    coffre_destroy: 'Coffre détruit',
    coffre_item_create: 'Élément créé', coffre_item_update: 'Élément modifié',
    coffre_item_delete: 'Élément mis à la corbeille', coffre_item_restore: 'Élément restauré',
    coffre_item_purge: 'Élément supprimé définitivement', coffre_trash_purge: 'Corbeille vidée',
    coffre_import: 'Import dans le coffre',
    extension_token_create: 'Token d’extension créé', extension_token_revoke: 'Token d’extension révoqué',
    password_change: 'Mot de passe modifié', recovery_generate: 'Codes de récupération régénérés',
    recovery_fail: 'Échec de récupération', recovery_success: 'Récupération réussie',
    rate_limited: 'Trop de requêtes (rate limit)', list_templates: 'Liste des templates',
    access: 'Accès', update_applied: 'Mise à jour appliquée', update_failed: 'Mise à jour échouée',
    setup_init: 'Installation initiale',
  },
  en: {
    read: 'Read', create: 'Create', update: 'Update', delete: 'Delete',
    login: 'Login', logout: 'Logout', login_fail: 'Login failed',
    agent_create: 'Agent created', agent_revoke: 'Agent revoked', agent_purge: 'Agent permanently deleted',
    vault_create: 'Vault created', vault_delete: 'Vault deleted',
    vault_delete_denied: 'Deletion denied (vault not empty)',
    grant: 'Access granted', grant_revoke: 'Access revoked', key_rotate: 'Key rotation',
    share_create: 'Share link created', share_view: 'Share link viewed',
    export: 'Encrypted export',
    restore_verify: 'Restore: verification', restore_import: 'Restore: import',
    '2fa_enroll': '2FA: enrollment', '2fa_enabled': '2FA enabled',
    '2fa_disabled': '2FA disabled', '2fa_reset': '2FA reset',
    coffre_create: 'Coffre created', coffre_rekey: 'Coffre: master password changed',
    coffre_destroy: 'Coffre destroyed',
    coffre_item_create: 'Item created', coffre_item_update: 'Item updated',
    coffre_item_delete: 'Item moved to trash', coffre_item_restore: 'Item restored',
    coffre_item_purge: 'Item permanently deleted', coffre_trash_purge: 'Trash emptied',
    coffre_import: 'Coffre import',
    extension_token_create: 'Extension token created', extension_token_revoke: 'Extension token revoked',
    password_change: 'Password changed', recovery_generate: 'Recovery codes regenerated',
    recovery_fail: 'Recovery failed', recovery_success: 'Recovery successful',
    rate_limited: 'Rate limited', list_templates: 'Templates listed',
    access: 'Access', update_applied: 'Update applied', update_failed: 'Update failed',
    setup_init: 'Initial setup',
  },
}

// Le statut HTTP est coloré — sa signification est aussi ÉCRITE (sr-only).
const STATUS_WORDS = { fr: { ok: 'OK', err: 'erreur' }, en: { ok: 'OK', err: 'error' } } as const

const PAGE = 100

export default function Audit() {
  const { t, lang } = useLang()
  const L = STATUS_WORDS[lang]
  const [entries, setEntries] = React.useState<any[] | null>(null)
  const [err, setErr] = React.useState<string | null>(null)
  const [agents, setAgents] = React.useState<any[]>([])
  const [agentFilter, setAgentFilter] = React.useState('') // → ?agent= (backend)
  const [source, setSource] = React.useState<'all' | 'agent' | 'webui'>('all')
  const [page, setPage] = React.useState(1)
  const [hasNext, setHasNext] = React.useState(false)

  // I1 : pagination réelle — le backend supporte ?limit=&offset=&agent=.
  // Pas de count serveur : on charge UNE entrée de plus ; si moins de limit
  // sont retournées, la page courante est la dernière.
  const load = React.useCallback(async () => {
    setErr(null)
    try {
      const q = `/admin/audit?limit=${PAGE + 1}&offset=${(page - 1) * PAGE}`
        + (agentFilter ? `&agent=${encodeURIComponent(agentFilter)}` : '')
      const [rows, ags] = await Promise.all([api('GET', q), api('GET', '/admin/agents')])
      setHasNext(rows.length > PAGE)
      setEntries(rows.slice(0, PAGE))
      setAgents(ags)
    } catch (e) {
      setErr(friendly(e))
    }
  }, [page, agentFilter])
  React.useEffect(() => { load() }, [load])

  const badge = (a: string) =>
    a === 'create' ? 'ok' : a === 'delete' || a === 'login_fail' ? 'danger'
    : a === 'update' ? 'accent' : a === 'rate_limited' ? 'warn' : 'neutral'
  const actionLabel = (a: string) => ACTION_LABELS[lang][a] ?? a
  const shown = (entries ?? []).filter(e => source === 'all' || e.source === source)

  // Export CSV des entrées chargées (page courante, filtres appliqués) —
  // échappement RFC 4180 + BOM UTF-8 pour qu'Excel FR lise l'accentuation.
  const exportCsv = () => {
    const esc = (v: unknown) => {
      const s = String(v ?? '')
      return /["\n,]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
    }
    const header = [String(t.when), String(t.source), String(t.who), String(t.action), String(t.resource), String(t.ip), String(t.status)]
      .map(esc).join(',')
    const rows = shown.map(e => [
      fmtDateTime(e.ts), e.source, e.agent_id, actionLabel(e.action), e.path || e.resource, e.ip, e.status,
    ].map(esc).join(','))
    const csv = '\uFEFF' + [header, ...rows].join('\r\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `audit-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (err) {
    return (
      <div>
        <h1 className="text-xl font-bold tracking-tight mb-1">{String(t.auditTitle)}</h1>
        <div className="mt-6">
          <Alert tone="danger">{err}</Alert>
          <Button variant="primary" className="mt-4" onClick={load}>{String(t.retry)}</Button>
        </div>
      </div>
    )
  }

  if (!entries) {
    return (
      <div>
        <h1 className="text-xl font-bold tracking-tight mb-1 sr-only">{String(t.auditTitle)}</h1>
        <Loading rows={8} label={String(t.loading)} />
      </div>
    )
  }

  // I1 : total estimé — la page suivante existe (limite+1 chargée) → au moins p+1.
  const totalPages = page + (hasNext ? 1 : 0)

  return (
    <div>
      <PageHeader
        title={String(t.auditTitle)}
        sub={String(t.auditSub)}
        actions={
          <>
            <SegmentedControl<'all' | 'agent' | 'webui'>
              options={[
                { value: 'all', label: String(t.all) },
                { value: 'agent', label: 'agent' }, // mot technique identique fr/en
                { value: 'webui', label: String(t.webui) },
              ]}
              value={source}
              onChange={setSource}
              ariaLabel={String(t.source)}
            />
            <Select value={agentFilter} onChange={e => { setAgentFilter(e.target.value); setPage(1) }}
              aria-label={String(t.agents)} className="w-44">
              <option value="">{String(t.all)}</option>
              {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
            <Button size="sm" onClick={exportCsv}><Download size={14} aria-hidden="true" /> {String(t.exportCsv)}</Button>
          </>
        }
      />

      <Table label={String(t.auditTitle)}>
        <thead>
          <tr>
            {[String(t.when), String(t.source), String(t.who), String(t.action), String(t.resource), String(t.ip), String(t.status)].map(h => (
              <Th key={h} className="whitespace-nowrap">{h}</Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((e, i) => (
            <motion.tr
              key={e.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(i * 0.01, 0.3) }}
              className="hover:bg-card-2/50 transition-colors"
            >
              <Td className="text-fg-2 text-xs whitespace-nowrap">{fmtDateTime(e.ts)}</Td>
              <Td>
                <span className="inline-flex items-center gap-1 text-xs text-fg-2">
                  {e.source === 'webui' ? <Monitor size={12} aria-hidden="true" /> : e.source === 'agent' ? <Bot size={12} aria-hidden="true" /> : <Globe size={12} aria-hidden="true" />}
                  {e.source}
                </span>
              </Td>
              <Td className="font-medium font-mono text-xs max-w-36 truncate">{e.agent_id}</Td>
              <Td><Badge variant={badge(e.action) as any}>{actionLabel(e.action)}</Badge></Td>
              <Td className="font-mono text-xs text-fg-2 max-w-56 truncate">{e.path || e.resource}</Td>
              <Td className="font-mono text-xs text-fg-2">{e.ip || '—'}</Td>
              <Td className="whitespace-nowrap">
                <span className={cn(
                  'font-mono text-xs font-semibold',
                  e.status >= 400 ? 'text-danger' : e.status >= 300 ? 'text-warn' : 'text-accent-fg',
                )}>{e.status || '—'}</span>
                {!!e.status && (
                  <span className="sr-only">{e.status >= 400 ? L.err : L.ok}</span>
                )}
              </Td>
            </motion.tr>
          ))}
          {shown.length === 0 && (
            <tr><Td colSpan={7}>
              <EmptyState icon={<ScrollText size={28} aria-hidden="true" />} title={String(t.noEntries)} />
            </Td></tr>
          )}
        </tbody>
      </Table>

      {/* I1 : pagination — compteur annoncé (role="status"), total estimé */}
      <div className="flex items-center justify-end gap-2 mt-4">
        <Button size="sm" disabled={page === 1} onClick={() => setPage(p => Math.max(1, p - 1))}>
          <ChevronLeft size={14} aria-hidden="true" /> {String(t.prev)}
        </Button>
        <span role="status" className="text-xs text-fg-3 tabular-nums whitespace-nowrap">
          {String(t.pageInfo(page, totalPages))}
        </span>
        <Button size="sm" disabled={!hasNext} onClick={() => setPage(p => p + 1)}>
          {String(t.next)} <ChevronRight size={14} aria-hidden="true" />
        </Button>
      </div>
    </div>
  )
}
