// Setup wizard — first boot. Full-screen with the viking logo.
// Steps: admin password → recovery codes download → first agent (key) → done.
import * as React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { LoaderCircle, Download, Check, ArrowRight, KeyRound, ShieldCheck, Bot } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { Button, Input, Field } from '@/components/ui'
import { useLang } from '@/i18n'
import emblem from '@/assets/emblem-dark.png'
import logo from '@/assets/logo-dark.png'

const W = {
  fr: {
    welcome: "Bienvenue dans Kervia-vault",
    sub: "Configurez votre coffre multi-agents en 3 étapes.",
    step1: "Mot de passe administrateur",
    step1h: "12 caractères minimum — c'est le seul mot de passe à retenir.",
    pw: "Mot de passe",
    pw2: "Confirmer",
    next: "Continuer",
    step2: "Codes de récupération",
    step2h: "Si vous perdez votre mot de passe, ces codes vous sauveront. Téléchargez-les maintenant — ils ne seront plus jamais affichés.",
    dlCodes: "Télécharger les codes",
    step3: "Premier agent",
    step3h: "Créez votre premier agent (pour Hermes, RITA, CI…) et récupérez sa clé API.",
    agentName: "Nom de l'agent (ex: hermes, rita)",
    createAgent: "Créer l'agent",
    dlKey: "Télécharger la clé",
    dlSkill: "Télécharger le skill",
    finish: "Terminé",
    finishH: "Kervia-vault est prêt. Connectez-vous avec votre nouveau mot de passe.",
    goLogin: "Ouvrir Kervia-vault",
    weak: "Trop court (12 caractères minimum)",
    mismatch: "Les mots de passe ne correspondent pas",
    stepOf: "Étape",
  },
  en: {
    welcome: "Welcome to Kervia-vault",
    sub: "Set up your multi-agent vault in 3 steps.",
    step1: "Administrator password",
    step1h: "12 characters minimum — the only password you need.",
    pw: "Password",
    pw2: "Confirm",
    next: "Continue",
    step2: "Recovery codes",
    step2h: "If you lose your password, these codes will save you. Download them now — they will never be shown again.",
    dlCodes: "Download codes",
    step3: "First agent",
    step3h: "Create your first agent (for Hermes, RITA, CI…) and grab its API key.",
    agentName: "Agent name (e.g. hermes, rita)",
    createAgent: "Create agent",
    dlKey: "Download key",
    dlSkill: "Download skill",
    finish: "Done",
    finishH: "Kervia-vault is ready. Sign in with your new password.",
    goLogin: "Open Kervia-vault",
    weak: "Too short (12 characters minimum)",
    mismatch: "Passwords do not match",
    stepOf: "Step",
  },
}

export default function Wizard({ onDone }: { onDone: () => void }) {
  const { lang } = useLang()
  const t = W[lang] || W.fr
  const [step, setStep] = React.useState(1)
  const [pw, setPw] = React.useState('')
  const [pw2, setPw2] = React.useState('')
  const [codes, setCodes] = React.useState<string[] | null>(null)
  const [agentName, setAgentName] = React.useState('')
  const [agent, setAgent] = React.useState<any | null>(null)
  const [busy, setBusy] = React.useState(false)

  const dl = (content: string, filename: string) => {
    const blob = new Blob([content], { type: 'text/plain' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = filename
    a.click()
  }

  const initSetup = async () => {
    if (pw.length < 12) { toast.error(t.weak); return }
    if (pw !== pw2) { toast.error(t.mismatch); return }
    setBusy(true)
    try {
      const d = await api('POST', '/setup/init', { admin_password: pw })
      setCodes(d.recovery_codes)
      setStep(2)
    } catch (e: any) { toast.error(e.message) }
    setBusy(false)
  }

  const createAgent = async () => {
    if (!agentName.trim() || busy) return
    setBusy(true)
    // login first (the setup just created the password) — if this fails the
    // api() call below will surface the error, but we still stop early
    let loggedIn = false
    try {
      const res = await fetch('/admin/login', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw }),
      })
      loggedIn = res.ok
    } catch { /* network error — fall through */ }
    if (!loggedIn) { toast.error('Login failed'); setBusy(false); return }
    try {
      const d = await api('POST', '/admin/agents', { name: agentName.trim() })
      setAgent(d)
      setStep(4)
    } catch (e: any) { toast.error(e.message) }
    setBusy(false)
  }

  const codesText = codes ? ['Kervia-vault — CODES DE RÉCUPÉRATION', '='.repeat(30), '',
    'Chaque code réinitialise le mot de passe admin. Usage unique.',
    '', ...codes.map((c, i) => `${i + 1}. ${c}`)].join('\n') : ''

  const keyText = agent ? [`Kervia-vault — CLÉ API AGENT "${agent.agent.name}"`, '='.repeat(30), '',
    `API key (usage: Authorization: Bearer <key> ou KERVIA_VAULT_API_KEY):`, agent.api_key,
    '', 'Ne partagez jamais cette clé. Elle ne sera plus jamais affichée.'].join('\n') : ''

  const skillText = agent ? skillFor(agent.agent.name, agent.api_key) : ''

  const progress = { 1: '1/3', 2: '2/3', 3: '2/3', 4: '3/3' } as const

  return (
    <div className="grid place-items-center min-h-screen relative">
      {/* progress */}
      <div className="absolute top-5 flex items-center gap-3 text-xs text-fg-3">
        <span className="font-bold text-accent">{t.stepOf} {progress[step as 1]}</span>
        <span className="w-40 h-1 bg-muted rounded-full overflow-hidden">
          <motion.span className="block h-full bg-accent rounded-full" animate={{ width: `${(step >= 4 ? 3 : step) / 3 * 100}%` }} />
        </span>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
        className="w-[440px] bg-card border border-border rounded-2xl p-8 shadow-2xl"
      >
        {/* viking head */}
        <div className="flex flex-col items-center gap-2 mb-6">
          <img src={emblem} alt="" className="w-20 h-20" />
          <img src={logo} alt="Kervia-vault" className="h-9" />
          <p className="text-xs text-fg-2 mt-1">{t.welcome}</p>
          <p className="text-[11px] text-fg-3">{t.sub}</p>
        </div>

        <AnimatePresence mode="wait">
          {step === 1 && (
            <motion.div key="1" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }}>
              <div className="flex items-center gap-2 mb-3">
                <ShieldCheck size={16} className="text-accent" />
                <span className="text-sm font-semibold">{t.step1}</span>
              </div>
              <p className="text-xs text-fg-2 mb-4">{t.step1h}</p>
              <Field label={t.pw}>
                <Input type="password" value={pw} autoFocus onChange={e => setPw(e.target.value)} />
              </Field>
              <Field label={t.pw2}>
                <Input type="password" value={pw2} onChange={e => setPw2(e.target.value)}
                  className={pw2 && pw !== pw2 ? 'border-danger' : ''} />
              </Field>
              {pw2 && pw !== pw2 && <p className="text-xs text-danger -mt-2 mb-3">{t.mismatch}</p>}
              <Button variant="primary" className="w-full" onClick={initSetup} disabled={pw.length < 12 || pw !== pw2 || busy}>
                {busy ? <LoaderCircle size={16} className="animate-spin" /> : <>{t.next} <ArrowRight size={14} /></>}
              </Button>
            </motion.div>
          )}

          {step === 2 && codes && (
            <motion.div key="2" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }}>
              <div className="flex items-center gap-2 mb-3">
                <KeyRound size={16} className="text-accent" />
                <span className="text-sm font-semibold">{t.step2}</span>
              </div>
              <p className="text-xs text-fg-2 mb-4">{t.step2h}</p>
              <div className="bg-bg border border-accent/40 rounded-lg p-3.5 font-mono text-xs space-y-1 mb-4">
                {codes.map((c, i) => <div key={i} className="text-accent">{String(i + 1).padStart(2, '0')} · {c}</div>)}
              </div>
              <Button variant="primary" className="w-full" onClick={() => dl(codesText, 'kervia-vault-recovery-codes.txt')}>
                <Download size={14} /> {t.dlCodes}
              </Button>
              <Button className="w-full mt-2" onClick={() => setStep(3)}>{t.next} <ArrowRight size={14} /></Button>
            </motion.div>
          )}

          {step === 3 && (
            <motion.div key="3" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }}>
              <div className="flex items-center gap-2 mb-3">
                <Bot size={16} className="text-accent" />
                <span className="text-sm font-semibold">{t.step3}</span>
              </div>
              <p className="text-xs text-fg-2 mb-4">{t.step3h}</p>
              <Field label={t.agentName}>
                <Input value={agentName} autoFocus onChange={e => setAgentName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && createAgent()} />
              </Field>
              <Button variant="primary" className="w-full" onClick={createAgent} disabled={!agentName.trim() || busy}>
                {busy ? <LoaderCircle size={15} className="animate-spin" /> : t.createAgent}
              </Button>
            </motion.div>
          )}

          {step === 4 && agent && (
            <motion.div key="4" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }}>
              <div className="flex items-center gap-2 mb-3">
                <Check size={16} className="text-accent" />
                <span className="text-sm font-semibold">{t.finish}</span>
              </div>
              <p className="text-xs text-fg-2 mb-4">{t.finishH}</p>
              <div className="bg-bg border border-accent rounded-lg p-3.5 font-mono text-xs text-accent break-all mb-4">
                {agent.api_key}
              </div>
              <div className="flex flex-col gap-2 mb-4">
                <Button onClick={() => dl(keyText, `kervia-vault-key-${agent.agent.name}.txt`)}>
                  <Download size={14} /> {t.dlKey}
                </Button>
                <Button onClick={() => dl(skillText, 'SKILL.md')}>
                  <Download size={14} /> {t.dlSkill}
                </Button>
              </div>
              <Button variant="primary" className="w-full" onClick={onDone}>
                {t.goLogin} <ArrowRight size={14} />
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* footer */}
      <div className="absolute bottom-4 flex items-center gap-4 text-[11px] text-fg-3">
        <span>v1.0</span>
        <a href="https://kervia.ch" target="_blank" rel="noreferrer" className="hover:text-fg-2 transition-colors">kervia.ch</a>
        <span>by <span className="text-fg-2">kervia</span></span>
        <a href="https://www.gnu.org/licenses/agpl-3.0.html" target="_blank" rel="noreferrer" className="hover:text-fg-2 transition-colors">AGPL-3.0</a>
      </div>
    </div>
  )
}

// Skill generator (usage + connection, NO master key inside)
function skillFor(agentName: string, apiKey: string): string {
  return `---
name: kervia-vault
description: Read and write credentials in Kervia-vault — the kervia multi-agent secrets vault. Use when a task needs an API key, password, token, or any credential, when storing/rotating a shared credential, or when the user mentions "vault", "secret", or a credential by name.
version: 1.0.0
---

# Kervia-vault — Credentials for AI agents (${agentName})

You are authenticated as agent "${agentName}". You can ONLY access the
vaults granted to you. Never echo a secret value unless the task requires it.

## How to connect (choose ONE)

### Option A — MCP over HTTP (simplest, no binary needed)
\`\`\`yaml
mcp_servers:
  kervia-vault:
    url: http://<host>:<port>/mcp
    headers:
      Authorization: "Bearer ${apiKey}"
\`\`\`

### Option B — MCP stdio (local binary)
\`\`\`bash
KERVIA_VAULT_API_KEY=${apiKey} ./kervia-vault --mcp-stdio
\`\`\`

### Option C — REST fallback
\`\`\`bash
curl -H "Authorization: Bearer ${apiKey}" http://<host>:<port>/v1/whoami
curl -H "Authorization: Bearer ${apiKey}" "http://<host>:<port>/v1/secrets?vault=<name>"
curl -X POST -H "Authorization: Bearer ${apiKey}" -H "Content-Type: application/json" \\
  http://<host>:<port>/v1/secrets \\
  -d '{"vault":"<name>","key":"NEW_KEY","value":"..."}'
\`\`\`

## Tools
whoami · list_vaults · list_secrets · get_secret · create_secret ·
update_secret · delete_secret · list_templates

## Rules
1. Start with whoami + list_secrets to see your scope.
2. ALWAYS prefer templated secrets (list_templates shows 58 structures:
   openai, postgres, smtp, cloudflare, github…).
3. update_secret creates a new version (history preserved).
4. "forbidden" = you lack the right; report, don't retry.
5. Never log or echo secret values beyond task requirements.
`
}