// Coffre v1.9.0 — santé du coffre : audit pure + contrôle HIBP opt-in.
// CONTRAT-COFFRE-v1.9.0 §1, règles EXACTES :
//   périmètre = items NON supprimés AVEC mot de passe principal (les
//              notes/cartes sans champ secret restent dans la liste
//              générale mais sortent du scoring)
//   faible    = passwordStrength(pw).bits < 50 (labels weak/fair)
//   réutilisé = mot de passe strictement identique sur ≥ 2 items (un
//              groupe par valeur)
//   ancien    = password_updated_at (fallback updated_at) plus vieux que
//              oldDays (défaut 180)
//   score     = 100 − (faibles×4 + groupes×6 + anciens×2), min 0
//   HIBP      = opt-in (localStorage 'kerviavault-hibp', UI), k-anonymité :
//              seul le préfixe SHA-1 (5 chars) quitte le navigateur, la
//              Map résultat vit en mémoire le temps de la session —
//              JAMAIS persistée (ni localStorage, ni blob serveur).
import { mainPasswordField } from './coffre-schema'
import { passwordStrength } from './coffre'

export interface HealthReport {
  score: number                              // 0-100
  weak: { idx: number; bits: number }[]       // items triés par bits croissant
  reused: { count: number; idxs: number[] }[] // groupes, count desc
  old: { idx: number; days: number }[]        // jours desc
  checkedCount: number                        // items avec mot de passe principal
}

// Le « mot de passe principal » au sens santé : la valeur du champ marqué
// pw du modèle (mainPasswordField de coffre-schema), non vide. Local ici :
// coffre-schema n'expose pas (encore) de mainSecret — dès qu'il existera,
// ce helper sera strictement équivalent (mainSecret(it) === champ pw.v).
function mainSecret(it: any): string {
  return mainPasswordField(it)?.v || ''
}

// ---- audit complet : pur, déterministe (now injectable pour les tests) ----
export function computeHealth(items: any[], opts?: { oldDays?: number; now?: number }): HealthReport {
  const oldDays = opts?.oldDays ?? 180
  const now = opts?.now ?? Date.now()
  const weak: { idx: number; bits: number }[] = []
  const byPw = new Map<string, number[]>() // mot de passe → indices (groupes réutilisé)
  const old: { idx: number; days: number }[] = []
  let checkedCount = 0
  let idx = 0
  for (const it of items || []) {
    if (it && !it.deleted_at) {
      const pw = mainSecret(it)
      if (pw) {
        checkedCount++
        const { bits } = passwordStrength(pw)
        if (bits < 50) weak.push({ idx, bits })
        const group = byPw.get(pw)
        if (group) group.push(idx)
        else byPw.set(pw, [idx])
        const stamp = it.password_updated_at || it.updated_at
        if (stamp) {
          const last = new Date(stamp).getTime()
          if (!isNaN(last)) {
            const days = Math.floor((now - last) / 86_400_000)
            if (days > oldDays) old.push({ idx, days })
          }
        }
      }
    }
    idx++
  }
  weak.sort((a, b) => a.bits - b.bits || a.idx - b.idx)
  const reused = [...byPw.values()]
    .filter(g => g.length >= 2)
    .map(g => ({ count: g.length, idxs: g.slice().sort((a, b) => a - b) }))
    .sort((a, b) => b.count - a.count || a.idxs[0] - b.idxs[0])
  old.sort((a, b) => b.days - a.days || a.idx - b.idx)
  // score : chaque faiblesse coûte, HIBP n'entre PAS dedans (état externe
  // au coffre — affiché en section séparée, contrat §1)
  const score = Math.max(0, Math.round(100 - (weak.length * 4 + reused.length * 6 + old.length * 2)))
  return { score, weak, reused, old, checkedCount }
}

// ---- HIBP : SHA-1 hex majuscule (WebCrypto, dispo navigateur + node) ----
export const HIBP_RANGE_URL = 'https://api.pwnedpasswords.com/range/'
export const HIBP_MAX_REQUESTS = 300 // garde-fou : coût réseau borné par run
const HIBP_CONCURRENCY = 6           // ~6 requêtes en vol (usage raisonnable de l'API)

export async function sha1Upper(pw: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(pw))
  const bytes = new Uint8Array(digest)
  let hex = ''
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0')
  return hex.toUpperCase()
}

// Cherche le suffixe (35 chars restants du SHA-1) dans la réponse HIBP
// « SUFFIX:count », une ligne par hash du préfixe. 0 = pas dans les fuites.
export function hibpCountFromResponse(suffix: string, body: string): number {
  const want = suffix.toUpperCase()
  for (const raw of body.split('\n')) {
    const m = /^([0-9A-F]{35}):(\d+)\s*$/.exec(raw.trim())
    if (m && m[1] === want) return Number(m[2])
  }
  return 0
}

// Vérifie les mots de passe UNIQUES du périmètre santé (dédupliqués par
// valeur, max 300/run, concurrence ~6). Clé de la Map = le mot de passe
// (jamais persisté), valeur = count HIBP (>0 = compromis ; 0 = propre).
// Panne totale → rejet (l'UI affiche cofHibpError) ; panne partielle →
// onError + résultats partiels rendus (partiel OK, contrat §1).
export async function checkHibp(
  items: any[],
  onProgress?: (done: number, total: number) => void,
  onError?: (err: unknown) => void,
): Promise<Map<string, number>> {
  const seen = new Set<string>()
  const pws: string[] = []
  for (const it of items || []) {
    if (!it || it.deleted_at) continue
    const pw = mainSecret(it)
    if (!pw || seen.has(pw)) continue
    seen.add(pw)
    pws.push(pw)
  }
  const batch = pws.slice(0, HIBP_MAX_REQUESTS)
  const out = new Map<string, number>()
  let done = 0
  let cursor = 0
  let firstErr: unknown = null
  const worker = async (): Promise<void> => {
    while (cursor < batch.length) {
      const pw = batch[cursor++]
      try {
        const hash = await sha1Upper(pw)
        const res = await fetch(HIBP_RANGE_URL + hash.slice(0, 5))
        if (!res.ok) throw new Error('hibp_http_' + res.status)
        out.set(pw, hibpCountFromResponse(hash.slice(5), await res.text()))
      } catch (e) {
        if (firstErr === null) firstErr = e
      }
      done++
      onProgress?.(done, batch.length)
    }
  }
  const lanes = Math.max(1, Math.min(HIBP_CONCURRENCY, batch.length))
  await Promise.all(Array.from({ length: lanes }, worker))
  if (firstErr !== null) {
    if (out.size === 0) throw firstErr // rien n'a passé : rien à montrer
    onError?.(firstErr)               // partiel : on rend ce qu'on a
  }
  return out
}

// ================= self-tests (exécutables sous node) =================
// runSelfTests() est pur : fetch est mocké, aucun réseau réel, aucun
// écriture. Le mini-runner du rapport compile ce fichier en CJS puis
// `node coffre-health.js` (le bloc auto-exec en fin de fichier déclenche).
export async function runSelfTests(): Promise<string[]> {
  const failures: string[] = []
  const eq = (name: string, got: unknown, want: unknown) => {
    const g = JSON.stringify(got), w = JSON.stringify(want)
    if (g !== w) failures.push(`${name} : obtenu ${g}, attendu ${w}`)
  }
  const DAY = 86_400_000
  const now = 1_800_000_000_000 // date figée → test déterministe
  const mk = (name: string, pw: string, extra: Record<string, unknown> = {}): any => ({
    v: 2, type: 'login', name,
    fields: [
      { k: 'text', l: 'Identifiant', v: 'user' },
      ...(pw ? [{ k: 'secret', l: 'Mot de passe', v: pw }] : []),
    ],
    notes: '', folder: '', tags: [], favorite: false, history: [],
    updated_at: new Date(now - 10 * DAY).toISOString(),
    ...extra,
  })

  // ---- cas contractuel : 2 faibles + 1 groupe réutilisé + 3 anciens ----
  // attendu : score = 100 − (2×4 + 1×6 + 3×2) = 100 − 20 = 80
  const items = [
    mk('Alpha', 'a'), // faible : 5 bits
    mk('Bravo', 'bb'), // faible : 7 bits
    mk('Charlie', 'S3cret-Partage!42', { password_updated_at: new Date(now - 10 * DAY).toISOString() }),
    mk('Delta', 'S3cret-Partage!42', { password_updated_at: new Date(now - 10 * DAY).toISOString() }),
    mk('Echo', 'G7vJq4Lx9Zp2Wn8$', { updated_at: new Date(now - 200 * DAY).toISOString() }), // fallback updated_at
    mk('Foxtrot', 'Km3#pQr7Tz9Xw2Ls', { password_updated_at: new Date(now - 250 * DAY).toISOString(), updated_at: new Date(now - 250 * DAY).toISOString() }),
    mk('Golf', 'Pd8@nRt5Yb1Cm6Zx', { password_updated_at: new Date(now - 300 * DAY).toISOString(), updated_at: new Date(now - 300 * DAY).toISOString() }),
    { v: 2, type: 'note', name: 'Note seule', fields: [], notes: 'x', updated_at: new Date(now - 10 * DAY).toISOString() },
    mk('Hôtel', 'a', { deleted_at: new Date(now - 2 * DAY).toISOString() }), // canari : supprimé, même pw qu'Alpha
  ]
  const r = computeHealth(items, { now })
  eq('score cas contractuel (100 − 2×4 − 1×6 − 3×2)', r.score, 80)
  eq('checkedCount (note et supprimé exclus)', r.checkedCount, 7)
  eq('faibles triés bits croissants', r.weak.map(w => [w.idx, w.bits]), [[0, 5], [1, 7]])
  eq('réutilisés : 1 groupe {2,3}', r.reused, [{ count: 2, idxs: [2, 3] }])
  eq('anciens triés jours décroissants (fallback updated_at inclus)', r.old.map(o => [o.idx, o.days]), [[6, 300], [5, 250], [4, 200]])

  // frontière : 180 jours PILE → pas ancien (« plus vieux que » = strict)
  const rEdge = computeHealth([mk('Pile', 'G7vJq4Lx9Zp2Wn8$', { updated_at: new Date(now - 180 * DAY).toISOString() })], { now })
  eq('180 jours pile : pas ancien', rEdge.old, [])
  eq('180 jours pile : score 100', rEdge.score, 100)

  // plancher : 30 faibles uniques → 100 − 120 → clamp 0
  const many = 'abcdefghijklmnopqrstuvwxyz0123'.split('').map((c, i) => mk('M' + i, 'zz' + c))
  const rMany = computeHealth(many, { now })
  eq('plancher score 0', rMany.score, 0)
  eq('plancher : 30 faibles', rMany.weak.length, 30)

  // ---- SHA-1 : vecteur public HIBP ----
  const h = await sha1Upper('password')
  eq('sha1(password) = vecteur HIBP', h, '5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8')
  eq('suffixe k-anonymité = 35 chars', h.slice(5).length, 35)

  // ---- parsing réponse HIBP ----
  const body = '00A8C9A5F3F8C1A3B4C5D6E7F8A9B0C1D2E3F4A5:12\n1E4C9B93F3F0682250B6CF8331B7EE68FD8:3730471\nFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:1\n'
  eq('hibp match', hibpCountFromResponse('1E4C9B93F3F0682250B6CF8331B7EE68FD8', body), 3730471)
  eq('hibp absent', hibpCountFromResponse('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', body), 0)

  // ---- checkHibp : fetch mocké (aucun réseau réel) ----
  const realFetch = (globalThis as any).fetch
  const calls: string[] = []
  ;(globalThis as any).fetch = async (url: string) => { calls.push(String(url)); return { ok: true, text: async () => '' } as any }
  try {
    let prog: [number, number] = [0, 0]
    const m = await checkHibp([mk('A', 'pw-one'), mk('B', 'pw-one'), mk('C', 'pw-two')],
      (done, total) => { prog = [done, total] })
    eq('hibp dédupliqué par valeur : 2 requêtes', calls.length, 2)
    eq('hibp progression complète', prog, [2, 2])
    eq('hibp résultats propres (count 0)', [...m.entries()].filter(([k, n]) => n === 0).length, 2)

    calls.length = 0
    const big = Array.from({ length: 305 }, (_, i) => mk('X' + i, 'cap-' + i))
    await checkHibp(big)
    eq('hibp cap 300 requêtes/run', calls.length, 300)
  } finally { (globalThis as any).fetch = realFetch }

  // compromis : la réponse contient le suffixe de pw-one → count 42
  const suffixOne = (await sha1Upper('pw-one')).slice(5)
  ;(globalThis as any).fetch = async () => ({ ok: true, text: async () => suffixOne + ':42\n' } as any)
  try {
    const m2 = await checkHibp([mk('A', 'pw-one'), mk('B', 'pw-two')])
    eq('hibp compromis count', m2.get('pw-one'), 42)
    eq('hibp propre count', m2.get('pw-two'), 0)
  } finally { (globalThis as any).fetch = realFetch }

  // panne totale → rejet (l'UI affiche cofHibpError)
  ;(globalThis as any).fetch = async () => { throw new Error('network down') }
  try {
    let threw = false
    try { await checkHibp([mk('A', 'pw-one')]) } catch { threw = true }
    eq('hibp panne totale → throw', threw, true)

    // panne partielle → résultats partiels + onError, pas de rejet
    const pfxTwo = (await sha1Upper('pw-two')).slice(0, 5)
    ;(globalThis as any).fetch = async (url: string) => {
      if (String(url).endsWith(pfxTwo)) throw new Error('boom')
      return { ok: true, text: async () => '' } as any
    }
    let errSeen: unknown = null
    const m3 = await checkHibp([mk('A', 'pw-one'), mk('B', 'pw-two')], undefined, e => { errSeen = e })
    eq('hibp partiel : résultat rendu', m3.get('pw-one'), 0)
    eq('hibp partiel : mot de passe en erreur omis', m3.has('pw-two'), false)
    eq('hibp partiel : onError signalé', errSeen !== null, true)
  } finally { (globalThis as any).fetch = realFetch }

  return failures
}

// Self-tests : exécutables via `runSelfTests()` (mini-runner CJS du
// rapport d'audit). PLUS D'AUTO-EXÉCUTION dans ce fichier : le pattern
// historique `typeof require !== 'undefined' && require.main === module`
// est MORTEL sous bundler — rolldown réécrit `typeof X !== 'undefined'`
// en `X !== void 0` (licencié par `declare const`), et la référence NU à
// `module` jette ReferenceError au module scope ESM navigateur → tout
// le bundle meurt avant React → splash bloquée (incident v1.9.1, corrigé
// v1.9.2 + garde check-boot.mjs qui exécute le bundle réel).
