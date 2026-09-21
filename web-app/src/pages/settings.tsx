import * as React from 'react'
import { motion } from 'framer-motion'
import { KeyRound, ShieldCheck, Clock, LoaderCircle } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { Button, Input, Field, Card, CardHeader, CardTitle, CardBody } from '@/components/ui'

export default function Settings() {
  const [cur, setCur] = React.useState('')
  const [next, setNext] = React.useState('')
  const [confirm, setConfirm] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [info, setInfo] = React.useState<any>(null)

  React.useEffect(() => { api('GET', '/admin/settings').then(setInfo).catch(() => {}) }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    if (next !== confirm) { toast.error('La confirmation ne correspond pas'); return }
    if (next.length < 12) { toast.error('Le mot de passe doit faire au moins 12 caractères'); return }
    setBusy(true)
    try {
      await api('POST', '/admin/password', { current_password: cur, new_password: next })
      toast.success('Mot de passe administrateur mis à jour')
      setCur(''); setNext(''); setConfirm('')
    } catch (e: any) { toast.error(e.message === 'invalid_credentials' ? 'Mot de passe actuel incorrect' : e.message) }
    setBusy(false)
  }

  return (
    <div className="max-w-xl">
      <h1 className="text-xl font-bold tracking-tight mb-1">Paramètres</h1>
      <p className="text-sm text-fg-2 mb-6">Administration du coffre.</p>

      <Card className="mb-5">
        <CardHeader>
          <span className="flex items-center gap-2"><KeyRound size={15} /> Changer le mot de passe administrateur</span>
        </CardHeader>
        <CardBody>
          <form onSubmit={submit}>
            <Field label="Mot de passe actuel">
              <Input type="password" value={cur} onChange={e => setCur(e.target.value)} autoComplete="current-password" />
            </Field>
            <Field label="Nouveau mot de passe" help="12 caractères minimum.">
              <Input type="password" value={next} onChange={e => setNext(e.target.value)} autoComplete="new-password" />
            </Field>
            <Field label="Confirmer le nouveau mot de passe">
              <Input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password"
                className={confirm && next !== confirm ? 'border-danger' : ''} />
            </Field>
            {confirm && next !== confirm && <p className="text-xs text-danger font-medium -mt-2 mb-3">Les mots de passe ne correspondent pas.</p>}
            <Button variant="primary" type="submit" disabled={!cur || !next || next !== confirm || busy}>
              {busy ? <LoaderCircle size={15} className="animate-spin" /> : 'Mettre à jour'}
            </Button>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader><span className="flex items-center gap-2"><ShieldCheck size={15} /> Sécurité</span></CardHeader>
        <CardBody className="space-y-3">
          <div className="flex items-center gap-3 text-sm">
            <Clock size={15} className="text-fg-3" />
            <span className="text-fg-2">Rétention des journaux d'audit :</span>
            <span className="font-semibold text-accent">{info?.audit_retention_days ?? 90} jours</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <ShieldCheck size={15} className="text-fg-3" />
            <span className="text-fg-2">Chiffrement au repos :</span>
            <span className="font-semibold">AES-256-GCM</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <KeyRound size={15} className="text-fg-3" />
            <span className="text-fg-2">Longueur minimale des mots de passe :</span>
            <span className="font-semibold">{info?.min_password_length ?? 12} caractères</span>
          </div>
        </CardBody>
      </Card>
    </div>
  )
}
