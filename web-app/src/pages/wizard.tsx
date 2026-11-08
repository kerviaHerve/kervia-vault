// Setup wizard — first boot. Full-screen with the Kervia-vault logo.
// Steps: language → terms of use → admin password → recovery codes → first agent → done.
import * as React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { LoaderCircle, Download, Check, ArrowRight, ArrowLeft, KeyRound, ShieldCheck, Bot, Languages, Scale } from 'lucide-react'
import { toast } from 'sonner'
import { api, friendly } from '@/lib/api'
import { Button, Input, Field, PasswordInput, Alert, BrandBlock } from '@/components/ui'
import { Strength } from '@/components/coffre/parts'
import { useLang } from '@/i18n'
import { LangSwitch } from '@/i18n/LangSwitch'

// Version affichée au footer — synchronisée avec le CHANGELOG lors des
// releases (pas d'accès API ici : le wizard tourne avant l'auth).
const WIZARD_VERSION = 'v1.8.6'

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
      { li: "La clé de chiffrement principale (master key) est stockée sur ce serveur (fichier de service : unit systemd sur Linux, LaunchDaemon sur macOS). Sauvegardez-la : elle seule permet de restaurer vos secrets sur une autre machine." },
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
    skillHintT: "Que faire du skill ?",
    skillHint: "Le SKILL.md contient les URLs de CETTE installation et les commandes d'installation MCP — mais AUCUNE clé (par sécurité : une clé dans un fichier est une clé compromise). Posez-le selon votre agent :",
    skillHintOC: "OpenCode : ~/.config/opencode/skills/kervia-vault/SKILL.md",
    skillHintH: "Hermes : ~/.hermes/skills/devops/kervia-vault/SKILL.md",
    skillHintEnd: "L'agent demandera la clé (fichier .txt ci-dessus) au moment de l'installation — dans le prompt masqué du client, jamais dans un fichier.",
    finish: "Terminé",
    finishH: "Kervia-vault est prêt. Connectez-vous avec votre nouveau mot de passe.",
    goLogin: "Ouvrir Kervia-vault",
    keyAck: "J'ai enregistré la clé API en lieu sûr",
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
      { li: "The master encryption key is stored on this server (service file: systemd unit on Linux, LaunchDaemon on macOS). Back it up: it is the only way to restore your secrets on another machine." },
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
    skillHintT: "What to do with the skill",
    skillHint: "The SKILL.md holds THIS installation's URLs and the MCP install commands — but NO key (by design: a key inside a file is a burned key). Drop it depending on your agent:",
    skillHintOC: "OpenCode: ~/.config/opencode/skills/kervia-vault/SKILL.md",
    skillHintH: "Hermes: ~/.hermes/skills/devops/kervia-vault/SKILL.md",
    skillHintEnd: "The agent will ask for the key (the .txt above) at install time — through the client's masked prompt, never stored in a file.",
    finish: "Done",
    finishH: "Kervia-vault is ready. Sign in with your new password.",
    goLogin: "Open Kervia-vault",
    keyAck: "I have stored the API key somewhere safe",
    weak: "Too short (12 characters minimum)",
    mismatch: "Passwords do not match",
    stepOf: "Step",
    loginFailed: "Login failed",
  },
}

export default function Wizard({ onDone }: { onDone: () => void }) {
  // i18n = traductions globales (t.back, t.codesSaved… du contrat v1.8.6) ;
  // t = dico inline ci-dessus, documenté et assumé pour le wizard.
  const { t: i18n, lang, setLang } = useLang()
  const t = T[lang] || T.fr
  // 0=language (ALWAYS first — the user must pick before reading anything),
  // 1=terms, 2=password, 3=codes, 4=agent, 5=done
  const [step, setStep] = React.useState(0)
  const [accepted, setAccepted] = React.useState(false)
  const [pw, setPw] = React.useState('')
  const [pw2, setPw2] = React.useState('')
  const pwMismatch = pw2 !== '' && pw !== pw2
  const [codes, setCodes] = React.useState<string[] | null>(null)
  // B1c : accusé de réception des codes avant de quitter l'étape 3.
  const [codesSaved, setCodesSaved] = React.useState(false)
  const [agentName, setAgentName] = React.useState('')
  const [agent, setAgent] = React.useState<any | null>(null)
  const [busy, setBusy] = React.useState(false)
  // B4 : l'auto-login a échoué — on ouvre l'issue « Passer cette étape ».
  const [loginFailed, setLoginFailed] = React.useState(false)
  // B1d : sortie de l'étape 5 seulement après téléchargement de la clé
  // (bouton) ou confirmation explicite (case).
  const [keyAck, setKeyAck] = React.useState(false)

  // B1a : les codes (étape 3) et la clé API (étape 5) sont affichés UNE
  // SEULE fois — un refresh les détruit pour toujours. Garde-fou bloquant
  // pendant les étapes qui portent une donnée à usage unique. exitRef =
  // sortie volontaire (bouton final / skip) : on ne retient pas quelqu'un
  // qui part exprès.
  const exitRef = React.useRef(false)
  React.useEffect(() => {
    if (step < 3) return
    const guard = (e: BeforeUnloadEvent) => {
      if (exitRef.current) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [step])

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
    } catch (e) { toast.error(friendly(e)) }
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
    if (!loggedIn) { toast.error(t.loginFailed); setLoginFailed(true); setBusy(false); return }
    try {
      const d = await api('POST', '/admin/agents', { name: agentName.trim() })
      setAgent(d)
      setStep(5)
    } catch (e) { toast.error(friendly(e)) }
    setBusy(false)
  }

  // Fichier de codes bilingue (B1/i18n) — même pattern que K ci-dessous :
  // avant, le contenu téléchargé était en FR codé dur quelle que soit la
  // langue choisie.
  const C = {
    fr: {
      title: 'Kervia-vault — CODES DE RÉCUPÉRATION',
      use: 'Chaque code réinitialise le mot de passe admin. Usage unique.',
    },
    en: {
      title: 'Kervia-vault — RECOVERY CODES',
      use: 'Each code resets the admin password. Single use.',
    },
  }
  const c = C[lang] || C.fr
  const codesText = codes ? [c.title, '='.repeat(30), '', c.use, '',
    ...codes.map((x, i) => `${i + 1}. ${x}`)].join('\n') : ''

  const K = {
    fr: {
      title: (n: string) => `Kervia-vault — CLÉ API AGENT "${n}"`,
      intro: `API key:`,
      store: [
        'STOCKAGE SÉCURISÉ (ce fichier est le SEUL endroit où la clé doit',
        'vivre — ne la recopiez ni dans un skill, ni dans un chat, ni dans',
        'un config, ni dans une commande en ligne):',
        '  chmod 600 ce-fichier  # ou rangez-la dans le coffre de votre',
        '                        # client (~/.hermes/.env, keychain…)',
        "  Les skills/docs n'embarquent JAMAIS la clé: les installateurs",
        '  la demandent au moment voulu (prompt masqué ou fichier 0600).',
      ],
      warn: 'Ne partagez jamais cette clé. Elle ne sera plus jamais affichée.',
      lost: 'Perdue ou exposée ? Révoquez-la dans la webui et créez-en une neuve.',
    },
    en: {
      title: (n: string) => `Kervia-vault — API KEY FOR AGENT "${n}"`,
      intro: `API key:`,
      store: [
        'SECURE STORAGE (this file is the ONLY place the key should live',
        '— never copy it into a skill, a chat, a config file, or a',
        'command line):',
        '  chmod 600 this-file  # or store it in your client\'s own',
        '                       # vault (~/.hermes/.env, keychain…)',
        '  Skills/docs NEVER embed the key: installers ask for it at',
        '  the right moment (masked prompt or a 0600 file).',
      ],
      warn: 'Never share this key. It will never be shown again.',
      lost: 'Lost or exposed? Revoke it in the webui and create a new one.',
    },
  }
  const k = K[lang] || K.fr
  const keyText = agent ? [k.title(agent.agent.name), '='.repeat(30), '',
    k.intro, agent.api_key, '', ...k.store,
    '', k.warn, k.lost].join('\n') : ''

  const skillText = agent ? skillFor(agent.agent.name, window.location.origin) : ''

  const progress = { 1: '1/5', 2: '2/5', 3: '3/5', 4: '4/5', 5: '5/5' } as const

  return (
    // app.tsx rend le wizard HORS du shell (pas de <main>) — la page fournit
    // elle-même son landmark principal.
    <main className="grid place-items-center min-h-screen relative">
      {/* retour discret (B3) — uniquement où rebrousser chemin est sûr :
          2→1 et 4→3. Les autres retours casseraient un setup déjà consommé
          (3→2 : /setup/init déjà appelé ; 5→4 : agent déjà créé). */}
      {(step === 2 || step === 4) && (
        <Button variant="ghost" size="sm" className="absolute top-4 left-4"
          onClick={() => setStep(step === 2 ? 1 : 3)}>
          <ArrowLeft size={14} aria-hidden="true" /> {String(i18n.back)}
        </Button>
      )}

      {/* B3 : la langue était figée après l'étape 0 — le switch officiel
          reste accessible en coin à partir de l'étape 1. */}
      {step >= 1 && <LangSwitch className="absolute top-4 right-4 !w-auto" />}

      {/* progress — a11y : la barre porte son rôle et ses valeurs */}
      <div className="absolute top-5 flex items-center gap-3 text-xs text-fg-3">
        {step >= 1 && <>
          <span className="font-bold text-accent-fg">{t.stepOf} {progress[step as 1]}</span>
          <span
            className="w-40 h-1 bg-muted rounded-full overflow-hidden"
            role="progressbar" aria-valuemin={1} aria-valuemax={5} aria-valuenow={step}
            aria-label={`${t.stepOf} ${progress[step as 1]}`}
          >
            <motion.span className="block h-full bg-accent rounded-full" animate={{ width: `${step / 5 * 100}%` }} />
          </span>
        </>}
      </div>

      <motion.div
        initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
        className="w-[480px] bg-card border border-border rounded-2xl p-8 shadow-2xl"
      >
        {/* bloc marque — BrandBlock (v1.8.6) : logo + nom + slogan, une seule
            implémentation partagée avec login et la sidebar */}
        <BrandBlock
          size="lg"
          centered
          className="mb-6"
          tagline={step > 1 ? <>{t.welcome}<span className="text-fg-3"> {t.sub}</span></> : undefined}
        />

        {/* B1b : une donnée à usage unique est à l'écran (codes, clé API) —
            bannière bloquante tant qu'elle n'est pas sauvegardée. */}
        {step >= 3 && (
          <Alert tone="warn" className="mb-4">{String(i18n.wizardDontClose)}</Alert>
        )}

        <AnimatePresence mode="wait">
          {/* ── 0. language ── */}
          {step === 0 && (
            <motion.div key="0" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }}>
              <div className="flex items-center gap-2 mb-4">
                <Languages size={16} className="text-accent-fg" aria-hidden="true" />
                <h1 className="text-sm font-semibold">{t.langTitle}</h1>
              </div>
              <div className="flex flex-col gap-2">
                <button onClick={() => pickLang('fr')}
                  className={`px-4 h-11 rounded-lg border text-sm font-medium transition-colors cursor-pointer ${lang === 'fr' ? 'border-accent bg-accent/10 text-accent-fg' : 'border-border bg-card-2 hover:border-fg-3'}`}>
                  Français
                </button>
                <button onClick={() => pickLang('en')}
                  className={`px-4 h-11 rounded-lg border text-sm font-medium transition-colors cursor-pointer ${lang === 'en' ? 'border-accent bg-accent/10 text-accent-fg' : 'border-border bg-card-2 hover:border-fg-3'}`}>
                  English
                </button>
              </div>
            </motion.div>
          )}

          {/* ── 1. terms of use ── */}
          {step === 1 && (
            <motion.div key="1" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }}>
              <div className="flex items-center gap-2 mb-3">
                <Scale size={16} className="text-accent-fg" aria-hidden="true" />
                <h1 className="text-sm font-semibold">{t.termsTitle}</h1>
              </div>
              <div className="text-2xs leading-relaxed space-y-2 mb-4 text-fg-2">
                {t.termsBody.map((p: any, i: number) => 'b' in p
                  ? <p key={i} className="font-semibold text-fg">{p.b}</p>
                  : null)}
                {/* vraie liste (a11y) — avant : des <p> préfixées « • » à la main */}
                <ul className="space-y-2">
                  {t.termsBody.map((p: any, i: number) => 'li' in p
                    ? <li key={i} className="pl-3 border-l-2 border-border">{p.li}</li>
                    : null)}
                </ul>
              </div>
              <label className="flex items-start gap-2.5 cursor-pointer select-none mb-4">
                <input type="checkbox" checked={accepted}
                  onChange={e => setAccepted(e.target.checked)}
                  className="mt-0.5 accent-[var(--color-accent)] w-4 h-4 cursor-pointer" />
                <span className="text-xs font-medium">{t.accept}</span>
              </label>
              <Button variant="primary" size="lg" className="w-full" disabled={!accepted} onClick={() => setStep(2)}>
                {t.next} <ArrowRight size={14} aria-hidden="true" />
              </Button>
            </motion.div>
          )}

          {/* ── 2. admin password ── */}
          {step === 2 && (
            <motion.div key="2" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }}>
              <div className="flex items-center gap-2 mb-3">
                <ShieldCheck size={16} className="text-accent-fg" aria-hidden="true" />
                <h1 className="text-sm font-semibold">{t.stepPw}</h1>
              </div>
              <p className="text-xs text-fg-2 mb-4">{t.stepPwH}</p>
              <Field label={t.pw}>
                <PasswordInput value={pw} autoFocus autoComplete="new-password" onChange={e => setPw(e.target.value)} />
                {/* B2 : jauge de force — le seul mot de passe du coffre mérite un feedback */}
                <div className="mt-1.5">{pw && <Strength pw={pw} />}</div>
              </Field>
              <Field label={t.pw2} error={pwMismatch ? t.mismatch : undefined}>
                <PasswordInput value={pw2} autoComplete="new-password" onChange={e => setPw2(e.target.value)}
                  className={pwMismatch ? 'border-danger' : ''} />
              </Field>
              <Button variant="primary" size="lg" className="w-full" onClick={initSetup} disabled={pw.length < 12 || pw !== pw2 || busy} aria-busy={busy}>
                {busy ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> : <>{t.next} <ArrowRight size={14} aria-hidden="true" /></>}
              </Button>
            </motion.div>
          )}

          {/* ── 3. recovery codes ── */}
          {step === 3 && codes && (
            <motion.div key="3" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }}>
              <div className="flex items-center gap-2 mb-3">
                <KeyRound size={16} className="text-accent-fg" aria-hidden="true" />
                <h1 className="text-sm font-semibold">{t.stepCodes}</h1>
              </div>
              <p className="text-xs text-fg-2 mb-4">{t.stepCodesH}</p>
              <div className="bg-bg border border-accent/40 rounded-lg p-3.5 font-mono text-xs space-y-1 mb-4">
                {codes.map((x, i) => <div key={i} className="text-accent-fg">{String(i + 1).padStart(2, '0')} · {x}</div>)}
              </div>
              <Button variant="primary" className="w-full" onClick={() => dl(codesText, 'kervia-vault-recovery-codes.txt')}>
                <Download size={14} aria-hidden="true" /> {t.dlCodes}
              </Button>
              {/* B1c : accusé de réception obligatoire avant de continuer —
                  ces codes ne seront plus JAMAIS affichés. */}
              <label className="flex items-start gap-2.5 cursor-pointer select-none mt-3 mb-2">
                <input type="checkbox" checked={codesSaved}
                  onChange={e => setCodesSaved(e.target.checked)}
                  className="mt-0.5 accent-[var(--color-accent)] w-4 h-4 cursor-pointer" />
                <span className="text-xs font-medium">{String(i18n.codesSaved)}</span>
              </label>
              <Button size="lg" className="w-full mt-2" disabled={!codesSaved} onClick={() => setStep(4)}>
                {t.next} <ArrowRight size={14} aria-hidden="true" />
              </Button>
            </motion.div>
          )}

          {/* ── 4. first agent ── */}
          {step === 4 && (
            <motion.div key="4" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }}>
              <div className="flex items-center gap-2 mb-3">
                <Bot size={16} className="text-accent-fg" aria-hidden="true" />
                <h1 className="text-sm font-semibold">{t.stepAgent}</h1>
              </div>
              <p className="text-xs text-fg-2 mb-4">{t.stepAgentH}</p>
              <Field label={t.agentName}>
                <Input value={agentName} autoFocus onChange={e => setAgentName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && createAgent()} />
              </Field>
              <Button variant="primary" size="lg" className="w-full" onClick={createAgent} disabled={!agentName.trim() || busy} aria-busy={busy}>
                {busy ? <LoaderCircle size={15} className="animate-spin" aria-hidden="true" /> : t.createAgent}
              </Button>
              {/* B4 : issue visible si l'auto-login échoue — le setup est déjà
                  terminé côté serveur, on peut rejoindre le login normal. */}
              {loginFailed && (
                <Button variant="link" className="w-full mt-3 text-xs"
                  onClick={() => { exitRef.current = true; onDone() }}>
                  {String(i18n.skipStep)}
                </Button>
              )}
            </motion.div>
          )}

          {/* ── 5. done ── */}
          {step === 5 && agent && (
            <motion.div key="5" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }}>
              <div className="flex items-center gap-2 mb-3">
                <Check size={16} className="text-accent-fg" aria-hidden="true" />
                <h1 className="text-sm font-semibold">{t.finish}</h1>
              </div>
              <p className="text-xs text-fg-2 mb-4">{t.finishH}</p>
              <div className="bg-bg border border-accent rounded-lg p-3.5 font-mono text-xs text-accent-fg break-all mb-4">
                {agent.api_key}
              </div>
              <div className="flex flex-col gap-2 mb-3">
                {/* B1d : le téléchargement de la clé vaut confirmation de
                    sauvegarde (le SKILL.md, lui, ne contient aucune clé). */}
                <Button onClick={() => { dl(keyText, `kervia-vault-key-${agent.agent.name}.txt`); setKeyAck(true) }}>
                  <Download size={14} aria-hidden="true" /> {t.dlKey}
                </Button>
                <Button onClick={() => dl(skillText, 'SKILL.md')}>
                  <Download size={14} aria-hidden="true" /> {t.dlSkill}
                </Button>
              </div>
              <div className="bg-bg border border-border rounded-lg p-3.5 mb-4 text-2xs leading-relaxed">
                <p className="font-semibold text-fg mb-1.5">{t.skillHintT}</p>
                <p className="text-fg-2 mb-2">{t.skillHint}</p>
                <p className="font-mono text-fg-3 mb-1 break-all">{t.skillHintOC}</p>
                <p className="font-mono text-fg-3 mb-2 break-all">{t.skillHintH}</p>
                <p className="text-fg-2">{t.skillHintEnd}</p>
              </div>
              {/* B1d : la clé n'est plus jamais affichée — sortie uniquement
                  après téléchargement ou confirmation explicite. */}
              <label className="flex items-start gap-2.5 cursor-pointer select-none mb-4">
                <input type="checkbox" checked={keyAck}
                  onChange={e => setKeyAck(e.target.checked)}
                  className="mt-0.5 accent-[var(--color-accent)] w-4 h-4 cursor-pointer" />
                <span className="text-xs font-medium">{t.keyAck}</span>
              </label>
              <Button variant="primary" size="lg" className="w-full" disabled={!keyAck}
                onClick={() => { exitRef.current = true; onDone() }}>
                {t.goLogin} <ArrowRight size={14} aria-hidden="true" />
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* footer */}
      <div className="absolute bottom-4 flex items-center gap-4 text-2xs text-fg-3">
        <span>{WIZARD_VERSION}</span>
        <a href="https://kervia.ch" target="_blank" rel="noreferrer" className="hover:text-fg-2 transition-colors">kervia.ch</a>
        <span>by <span className="text-fg-2">kervia</span></span>
        <a href="https://www.gnu.org/licenses/agpl-3.0.html" target="_blank" rel="noreferrer" className="hover:text-fg-2 transition-colors">AGPL-3.0</a>
      </div>
    </main>
  )
}

// Skill generator — NO SECRETS INSIDE (security rule): the key is
// provided by the USER out-of-band (masked prompt of the client, or a
// 0600 file they own), NEVER embedded in the skill. A skill file gets
// stored, attached to chats, logged — any key inside is burned.
// origin: where the user is RIGHT NOW (window.location.origin).
function skillFor(agentName: string, origin: string): string {
  return `---
name: kervia-vault
description: Read and write credentials in Kervia-vault — the multi-agent secrets vault. Use when a task needs an API key, password, token, or any credential, when storing/rotating a shared credential, or when the user mentions "vault", "secret", or a credential by name.
version: 1.0.0
---

# Kervia-vault — Credentials for AI agents

This skill contains NO secret. The API key is provided by the user at
install time, out-of-band (masked prompt or their own 0600 file).
You are authenticated as the agent whose key the user provides — call
whoami to see your REAL identity and scope. Never assume the agent name.

## Connection

Server: kervia-vault — MCP over HTTP at ${origin}/mcp

## Tools
whoami · list_vaults · list_secrets · get_secret · create_secret ·
update_secret · delete_secret · list_templates

## Usage rules
1. Start with whoami (your real identity + vaults granted to you),
   then list_secrets (metadata only — never values).
2. You can ONLY access the vaults granted to your key. Do not guess
   vault names or ids.
3. ALWAYS prefer templated secrets (list_templates shows ~100 structures:
   openai, postgres, smtp, imap, cloudflare, github…). Required fields are
   enforced.
4. update_secret creates a new version (history preserved). Rotation:
   generate a new strong value, update, then update the consumer.
5. "forbidden" = you lack the right (RO vault or not your vault).
   Report to the user; do NOT retry.
6. Never log or echo secret values beyond task requirements.

## Installation (one-time)

Ask the user for the API key when running these. The key comes from the
Kervia-vault webui (Agents → created once at setup, or ask the admin).
NEVER store the key in this skill, a gist, a markdown, or any
world-readable file. If a key appears in a document: it is burned —
tell the user to revoke and issue a new one.

**Hermes Agent** — the CLI prompts for the token (masked, stored in
~/.hermes/.env with 0600 perms, referenced via \${ } interpolation only):
\`\`\`bash
hermes mcp add kervia-vault --url ${origin}/mcp --auth header
# when prompted "API key / Bearer token": the user pastes the key
# (the prompt is masked — the key never lands in a file or history)
\`\`\`
config.yaml equivalent (interpolation ONLY — never the raw value):
\`\`\`yaml
mcp_servers:
  kervia-vault:
    url: ${origin}/mcp
    headers:
      Authorization: "Bearer \${MCP_AG_VAULT_API_KEY}"
\`\`\`
Note: tools from a newly added MCP usually appear in a NEW session,
not the current one. /reload-mcp is not always enough — start a fresh
conversation to see the kervia-vault tools.

**OpenCode** — use the client's own secret mechanism (the key is
provided by the user, typed into the prompt or their keychain):
\`\`\`bash
opencode mcp add kervia-vault --global --url ${origin}/mcp \
  --header "Authorization=Bearer \$AG_VAULT_API_KEY"
\`\`\`
(the user may export AG_VAULT_API_KEY in their shell rc first — env
vars stay out of files that get committed)

**REST fallback** — read the key from a 0600 file the USER owns:
\`\`\`bash
KEY=$(cat ~/.config/kervia-vault/key)   # file created by the user, chmod 600
curl -H "Authorization: Bearer \$KEY" ${origin}/v1/whoami
curl -H "Authorization: Bearer \$KEY" "${origin}/v1/secrets?vault=<name>"
\`\`\`
Never put the key inline in a command (shell history + argv are logged).

## After install
Call whoami to confirm: your identity + granted vaults. If it fails:
check you can reach ${origin} (VPN/mesh), and that the key is still
active — revocation is instant.
`
}
