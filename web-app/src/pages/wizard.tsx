// Setup wizard — first boot. Full-screen with the Kervia-vault logo.
// Steps: language → terms of use → admin password → recovery codes → first agent → done.
import * as React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { LoaderCircle, Download, Check, ArrowRight, KeyRound, ShieldCheck, Bot, Languages, Scale } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { Button, Input, Field } from '@/components/ui'
import { useLang } from '@/i18n'
import logo from '@/assets/logo-dark.png'

// Step texts are kept bilingual inline: the wizard's FIRST step picks the
// language, so it must render both before any choice exists.
const T = {
  fr: {
    welcome: "Bienvenue dans Kervia-vault",
    sub: "Configurez votre coffre multi-agents.",
    langTitle: "Choisissez votre langue",
    termsTitle: "Conditions d'utilisation",
    termsBody: [
      { b: "Avant de continuer, comprenez ce que vous allez utiliser." },
      { b: "Kervia-vault est un coffre-fort de secrets. Les clés API, mots de passe et jetons que vous y confiez sont chiffrés uniquement pour vous :" },
      { li: "Personne ne pourra les récupérer si vous perdez votre mot de passe — ni nous, ni le support. Seuls les codes de récupération générés à l'étape suivante peuvent réinitialiser l'accès." },
      { li: "La clé de chiffrement principale (master key) est stockée sur ce serveur (fichier de service systemd). Sauvegardez-la : elle seule permet de restaurer vos secrets sur une autre machine." },
      { li: "Vous êtes responsable de la sécurité de cette instance : ne l'exposez jamais directement sur Internet, gardez-la sur votre réseau privé ou VPN." },
      { li: "Les clés API des agents sont affichées une seule fois à leur création. Non sauvegardées = perdues." },
      { li: "Le logiciel est fourni sous licence AGPL-3.0, sans garantie. En cas de perte du mot de passe, de la master key et des codes de récupération, les données sont définitivement irrécupérables — c'est le principe même d'un coffre-fort." },
    ],
    accept: "Je comprends et j'accepte ces conditions",
    stepPw: "Mot de passe administrateur",
    stepPwH: "12 caractères minimum — c'est le seul mot de passe à retenir.",
    pw: "Mot de passe",
    pw2: "Confirmer",
    next: "Continuer",
    stepCodes: "Codes de récupération",
    stepCodesH: "Si vous perdez votre mot de passe, ces codes vous sauveront. Téléchargez-les maintenant — ils ne seront plus jamais affichés.",
    dlCodes: "Télécharger les codes",
    stepAgent: "Premier agent",
    stepAgentH: "Créez votre premier agent (pour Hermes, RITA, CI…) et récupérez sa clé API.",
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
    loginFailed: "Échec de la connexion",
  },
  en: {
    welcome: "Welcome to Kervia-vault",
    sub: "Set up your multi-agent vault.",
    langTitle: "Choose your language",
    termsTitle: "Terms of use",
    termsBody: [
      { b: "Before you continue, understand what you are about to use." },
      { b: "Kervia-vault is a secrets vault. The API keys, passwords and tokens you entrust to it are encrypted for you only:" },
      { li: "Nobody can recover your secrets if you lose your password — not us, not support. Only the recovery codes generated in the next step can reset access." },
      { li: "The master encryption key is stored on this server (systemd service file). Back it up: it is the only way to restore your secrets on another machine." },
      { li: "You are responsible for this instance's security: never expose it directly to the Internet — keep it on your private network or VPN." },
      { li: "Agent API keys are shown exactly once at creation. Not saved = lost." },
      { li: "The software is licensed under AGPL-3.0, with no warranty. If you lose your password, master key and recovery codes, the data is permanently unrecoverable — that is the very point of a vault." },
    ],
    accept: "I understand and accept these terms",
    stepPw: "Administrator password",
    stepPwH: "12 characters minimum — the only password you need.",
    pw: "Password",
    pw2: "Confirm",
    next: "Continue",
    stepCodes: "Recovery codes",
    stepCodesH: "If you lose your password, these codes will save you. Download them now — they will never be shown again.",
    dlCodes: "Download codes",
    stepAgent: "First agent",
    stepAgentH: "Create your first agent (for Hermes, RITA, CI…) and grab its API key.",
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
    loginFailed: "Login failed",
  },
}

export default function Wizard({ onDone }: { onDone: () => void }) {
  const { lang, setLang } = useLang()
  const t = T[lang] || T.fr
  // 0=language (ALWAYS first — the user must pick before reading anything),
  // 1=terms, 2=password, 3=codes, 4=agent, 5=done
  const [step, setStep] = React.useState(0)
  const [accepted, setAccepted] = React.useState(false)
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

  const pickLang = (l: 'fr' | 'en') => {
    setLang(l)
    setStep(1)
  }

  const initSetup = async () => {
    if (pw.length < 12) { toast.error(t.weak); return }
    if (pw !== pw2) { toast.error(t.mismatch); return }
    setBusy(true)
    try {
      const d = await api('POST', '/setup/init', { admin_password: pw })
      setCodes(d.recovery_codes)
      setStep(3)
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
    if (!loggedIn) { toast.error(t.loginFailed); setBusy(false); return }
    try {
      const d = await api('POST', '/admin/agents', { name: agentName.trim() })
      setAgent(d)
      setStep(5)
    } catch (e: any) { toast.error(e.message) }
    setBusy(false)
  }

  const codesText = codes ? ['Kervia-vault — CODES DE RÉCUPÉRATION', '='.repeat(30), '',
    'Chaque code réinitialise le mot de passe admin. Usage unique.',
    '', ...codes.map((c, i) => `${i + 1}. ${c}`)].join('\n') : ''

  const keyText = agent ? [`Kervia-vault — CLÉ API AGENT "${agent.agent.name}"`, '='.repeat(30), '',
    `API key (usage: Authorization: Bearer <key> ou KERVIA_VAULT_API_KEY):`, agent.api_key,
    '', 'Ne partagez jamais cette clé. Elle ne sera plus jamais affichée.'].join('\n') : ''

  const skillText = agent ? skillFor(agent.agent.name, agent.api_key, window.location.origin) : ''

  const progress = { 1: '1/5', 2: '2/5', 3: '3/5', 4: '4/5', 5: '5/5' } as const

  return (
    <div className="grid place-items-center min-h-screen relative">
      {/* progress */}
      <div className="absolute top-5 flex items-center gap-3 text-xs text-fg-3">
        {step >= 1 && <>
          <span className="font-bold text-accent">{t.stepOf} {progress[step as 1]}</span>
          <span className="w-40 h-1 bg-muted rounded-full overflow-hidden">
            <motion.span className="block h-full bg-accent rounded-full" animate={{ width: `${step / 5 * 100}%` }} />
          </span>
        </>}
      </div>

      <motion.div
        initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
        className="w-[480px] bg-card border border-border rounded-2xl p-8 shadow-2xl"
      >
        {/* logo */}
        <div className="flex flex-col items-center gap-2 mb-6">
          <img src={logo} alt="Kervia-vault" className="h-16" />
          {step > 1 && <>
            <p className="text-xs text-fg-2 mt-1">{t.welcome}</p>
            <p className="text-[11px] text-fg-3">{t.sub}</p>
          </>}
        </div>

        <AnimatePresence mode="wait">
          {/* ── 0. language ── */}
          {step === 0 && (
            <motion.div key="0" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }}>
              <div className="flex items-center gap-2 mb-4">
                <Languages size={16} className="text-accent" />
                <span className="text-sm font-semibold">{t.langTitle}</span>
              </div>
              <div className="flex flex-col gap-2">
                <button onClick={() => pickLang('fr')}
                  className={`px-4 h-11 rounded-lg border text-sm font-medium transition-colors cursor-pointer ${lang === 'fr' ? 'border-accent bg-accent/10 text-accent' : 'border-border bg-card-2 hover:border-fg-3'}`}>
                  Français
                </button>
                <button onClick={() => pickLang('en')}
                  className={`px-4 h-11 rounded-lg border text-sm font-medium transition-colors cursor-pointer ${lang === 'en' ? 'border-accent bg-accent/10 text-accent' : 'border-border bg-card-2 hover:border-fg-3'}`}>
                  English
                </button>
              </div>
            </motion.div>
          )}

          {/* ── 1. terms of use ── */}
          {step === 1 && (
            <motion.div key="1" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }}>
              <div className="flex items-center gap-2 mb-3">
                <Scale size={16} className="text-accent" />
                <span className="text-sm font-semibold">{t.termsTitle}</span>
              </div>
              <div className="text-[11px] leading-relaxed space-y-2 mb-4 text-fg-2">
                {t.termsBody.map((p: any, i: number) => 'li' in p
                  ? <p key={i} className="pl-3 border-l-2 border-border">• {p.li}</p>
                  : <p key={i} className="font-semibold text-fg-1">{p.b}</p>)}
              </div>
              <label className="flex items-start gap-2.5 cursor-pointer select-none mb-4">
                <input type="checkbox" checked={accepted}
                  onChange={e => setAccepted(e.target.checked)}
                  className="mt-0.5 accent-[#22C55E] w-4 h-4 cursor-pointer" />
                <span className="text-xs font-medium">{t.accept}</span>
              </label>
              <Button variant="primary" className="w-full" disabled={!accepted} onClick={() => setStep(2)}>
                {t.next} <ArrowRight size={14} />
              </Button>
            </motion.div>
          )}

          {/* ── 2. admin password ── */}
          {step === 2 && (
            <motion.div key="2" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }}>
              <div className="flex items-center gap-2 mb-3">
                <ShieldCheck size={16} className="text-accent" />
                <span className="text-sm font-semibold">{t.stepPw}</span>
              </div>
              <p className="text-xs text-fg-2 mb-4">{t.stepPwH}</p>
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

          {/* ── 3. recovery codes ── */}
          {step === 3 && codes && (
            <motion.div key="3" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }}>
              <div className="flex items-center gap-2 mb-3">
                <KeyRound size={16} className="text-accent" />
                <span className="text-sm font-semibold">{t.stepCodes}</span>
              </div>
              <p className="text-xs text-fg-2 mb-4">{t.stepCodesH}</p>
              <div className="bg-bg border border-accent/40 rounded-lg p-3.5 font-mono text-xs space-y-1 mb-4">
                {codes.map((c, i) => <div key={i} className="text-accent">{String(i + 1).padStart(2, '0')} · {c}</div>)}
              </div>
              <Button variant="primary" className="w-full" onClick={() => dl(codesText, 'kervia-vault-recovery-codes.txt')}>
                <Download size={14} /> {t.dlCodes}
              </Button>
              <Button className="w-full mt-2" onClick={() => setStep(4)}>{t.next} <ArrowRight size={14} /></Button>
            </motion.div>
          )}

          {/* ── 4. first agent ── */}
          {step === 4 && (
            <motion.div key="4" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }}>
              <div className="flex items-center gap-2 mb-3">
                <Bot size={16} className="text-accent" />
                <span className="text-sm font-semibold">{t.stepAgent}</span>
              </div>
              <p className="text-xs text-fg-2 mb-4">{t.stepAgentH}</p>
              <Field label={t.agentName}>
                <Input value={agentName} autoFocus onChange={e => setAgentName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && createAgent()} />
              </Field>
              <Button variant="primary" className="w-full" onClick={createAgent} disabled={!agentName.trim() || busy}>
                {busy ? <LoaderCircle size={15} className="animate-spin" /> : t.createAgent}
              </Button>
            </motion.div>
          )}

          {/* ── 5. done ── */}
          {step === 5 && agent && (
            <motion.div key="5" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }}>
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

// Skill generator (usage + connection, NO master key inside).
// origin: where the user is RIGHT NOW (window.location.origin) — the skill
// is ready to paste, no <host>:<port> placeholders to fill.
function skillFor(agentName: string, apiKey: string, origin: string): string {
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
    url: ${origin}/mcp
    headers:
      Authorization: "Bearer ${apiKey}"
\`\`\`

### Option B — MCP stdio (local binary)
\`\`\`bash
KERVIA_VAULT_API_KEY=${apiKey} ./kervia-vault --mcp-stdio
\`\`\`

### Option C — REST fallback
\`\`\`bash
curl -H "Authorization: Bearer ${apiKey}" ${origin}/v1/whoami
curl -H "Authorization: Bearer ${apiKey}" "${origin}/v1/secrets?vault=<name>"
curl -X POST -H "Authorization: Bearer ${apiKey}" -H "Content-Type: application/json" \\
  ${origin}/v1/secrets \\
  -d '{"vault":"<name>","key":"NEW_KEY","value":"..."}'
\`\`\`

## Tools
whoami · list_vaults · list_secrets · get_secret · create_secret ·
update_secret · delete_secret · list_templates

## Installation (MCP connection setup)

The vault is NOT yet wired into your MCP clients. To install it:

**OpenCode** — run this once (any machine that can reach ${origin}):
\`\`\`bash
opencode mcp add kervia-vault --global --url ${origin}/mcp --header "Authorization=Bearer ${apiKey}"
\`\`\`
or add to ~/.config/opencode/opencode.jsonc:
\`\`\`json
{ "mcp": { "kervia-vault": { "type": "url", "url": "${origin}/mcp",
  "headers": { "Authorization": "Bearer ${apiKey}" } } } }
\`\`\`

**Hermes Agent** — run this once, paste the API key when prompted
(it is stored in ~/.hermes/.env, not in config.yaml):
\`\`\`bash
hermes mcp add kervia-vault --url ${origin}/mcp --auth header
# → "API key / Bearer token:" → paste: ${apiKey}
\`\`\`
or add the block to ~/.hermes/config.yaml:
\`\`\`yaml
mcp_servers:
  kervia-vault:
    url: ${origin}/mcp
    headers:
      Authorization: "Bearer ${apiKey}"
\`\`\`
then reload with /reload-mcp (chat) or restart.

After install, restart the client, then call whoami to confirm access.
If connection fails: check you can reach ${origin} (VPN/mesh), and that
the key is still active (revocation kills it instantly).

## Rules
1. Start with whoami + list_secrets to see your scope.
2. ALWAYS prefer templated secrets (list_templates shows 58 structures:
   openai, postgres, smtp, cloudflare, github…).
3. update_secret creates a new version (history preserved).
4. "forbidden" = you lack the right; report, don't retry.
5. Never log or echo secret values beyond task requirements.
`
}