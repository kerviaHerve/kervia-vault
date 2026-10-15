// Coffre crypto — zero-knowledge, tout se passe dans le navigateur.
// Le mot de passe maître et la clé du coffre ne quittent JAMAIS la
// mémoire de cette page (aucun localStorage, aucun sessionStorage) :
// un rechargement verrouille le coffre. Le serveur ne voit que des
// blobs chiffrés (AES-256-GCM via WebCrypto).
//
// Schéma : masterPassword --PBKDF2-SHA256 600k--> masterKey
//          coffreKey (32 B aléatoires) scellée par masterKey (wrapped_key)
//          verifier = constante scellée par coffreKey (mauvais mdp détectable)

// ---- état en mémoire (le seul) ----
let session: { key: CryptoKey; raw: Uint8Array } | null = null

export function coffreUnlocked(): boolean { return session !== null }
export function lockCoffre(): void {
  if (session) session.raw.fill(0) // zeroize — bonne hygiène
  session = null
}

export const VERIFIER_PLAINTEXT = 'kervia-coffre-verifier-v1'
export const KDF_ITERATIONS = 600_000 // OWASP 2023+ pour PBKDF2-SHA256

export interface CoffreEnvelope {
  kdf_algo: string
  kdf_params: string
  kdf_salt_b64: string
  wrapped_key_b64: string
  verifier_b64: string
}

export interface CoffreItemData {
  v: number
  type: 'login' | 'note'
  name: string
  username?: string
  password?: string
  uris?: string[]
  totp?: string
  notes?: string
  folder?: string
  favorite?: boolean
  history?: { password: string; changed_at: string }[]
  password_updated_at?: string
}

export interface DecryptedItem extends CoffreItemData {
  id: string
  version: number
  created_at: string
  updated_at: string
  deleted_at: string | null
  _broken?: boolean // décryptage impossible (ex. rekey raté) — conservé tel quel
}

// ---- base64 helpers ----

function b64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

function unb64(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n)
  crypto.getRandomValues(b)
  return b
}

// Typage précis : TS 5.7+ distingue Uint8Array<ArrayBuffer> (acceptable
// par WebCrypto) de Uint8Array<ArrayBufferLike> — toutes nos données
// sont allouées en ArrayBuffer local, jamais SharedArrayBuffer.
function te(s: string): Uint8Array<ArrayBuffer> { return new TextEncoder().encode(s) }
function td(b: Uint8Array): string { return new TextDecoder().decode(b) }

// ---- KDF + scellement ----

async function deriveMasterKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', te(password), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

async function seal(key: CryptoKey, plaintext: Uint8Array): Promise<Uint8Array> {
  const nonce = randomBytes(12)
  const ct = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce as BufferSource }, key, plaintext as BufferSource))
  const out = new Uint8Array(12 + ct.length)
  out.set(nonce, 0); out.set(ct, 12)
  return out
}

async function open(key: CryptoKey, sealed: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: sealed.slice(0, 12) as BufferSource },
    key, sealed.slice(12) as BufferSource))
}

// ---- cycle de vie du coffre ----

// createCoffre : première initialisation — génère la clé du coffre et
// l'enveloppe scellée par le mot de passe maître. La clé reste en
// mémoire (session ouverte).
export async function createCoffre(password: string): Promise<CoffreEnvelope> {
  const salt = randomBytes(16)
  const masterKey = await deriveMasterKey(password, salt, KDF_ITERATIONS)
  const raw = randomBytes(32)
  const key = await crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt'])
  const wrapped = await seal(masterKey, raw)
  const verifier = await seal(key, te(VERIFIER_PLAINTEXT))
  session = { key, raw }
  return {
    kdf_algo: 'pbkdf2',
    kdf_params: JSON.stringify({ iterations: KDF_ITERATIONS }),
    kdf_salt_b64: b64(salt),
    wrapped_key_b64: b64(wrapped),
    verifier_b64: b64(verifier),
  }
}

// unlockCoffre : dérive la masterKey, ouvre la clé scellée, VÉRIFIE via
// le verifier. Mauvais mot de passe → exception 'wrong_password'.
export async function unlockCoffre(header: CoffreEnvelope, password: string): Promise<void> {
  const salt = unb64(header.kdf_salt_b64)
  const params = JSON.parse(header.kdf_params || '{}')
  const iterations = Number(params.iterations) || KDF_ITERATIONS
  const masterKey = await deriveMasterKey(password, salt, iterations)
  let raw: Uint8Array
  try {
    raw = await open(masterKey, unb64(header.wrapped_key_b64))
  } catch {
    throw new Error('wrong_password')
  }
  const key = await crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt'])
  try {
    const check = td(await open(key, unb64(header.verifier_b64)))
    if (check !== VERIFIER_PLAINTEXT) throw new Error()
  } catch {
    throw new Error('wrong_password')
  }
  session = { key, raw }
}

// rekeyCoffre : changement de mot de passe maître — la MÊME clé coffre
// est rescellée par la nouvelle masterKey (aucune ré-encryption des
// items nécessaire, c'est l'intérêt du schéma à enveloppe).
export async function rekeyCoffre(newPassword: string): Promise<CoffreEnvelope> {
  if (!session) throw new Error('locked')
  const salt = randomBytes(16)
  const masterKey = await deriveMasterKey(newPassword, salt, KDF_ITERATIONS)
  const wrapped = await seal(masterKey, session.raw)
  const verifier = await seal(session.key, te(VERIFIER_PLAINTEXT))
  return {
    kdf_algo: 'pbkdf2',
    kdf_params: JSON.stringify({ iterations: KDF_ITERATIONS }),
    kdf_salt_b64: b64(salt),
    wrapped_key_b64: b64(wrapped),
    verifier_b64: b64(verifier),
  }
}

// ---- items ----

export async function encryptItem(data: CoffreItemData): Promise<string> {
  if (!session) throw new Error('locked')
  const sealed = await seal(session.key, te(JSON.stringify(data)))
  return b64(sealed)
}

export async function decryptItem(blobB64: string): Promise<CoffreItemData> {
  if (!session) throw new Error('locked')
  return JSON.parse(td(await open(session.key, unb64(blobB64)))) as CoffreItemData
}

// ---- TOTP (RFC 6238, SHA-1, 30 s, 6 chiffres) ----

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function parseTotpSeed(s: string): string {
  const v = (s || '').trim()
  if (/^otpauth:\/\//i.test(v)) {
    try {
      const u = new URL(v.replace(/^otpauth:\/\//i, 'https://'))
      return (u.searchParams.get('secret') || '').toUpperCase().replace(/\s/g, '')
    } catch { return '' }
  }
  return v.toUpperCase().replace(/\s/g, '')
}

function base32Decode(s: string): Uint8Array {
  const clean = s.toUpperCase().replace(/=+$/g, '').replace(/[^A-Z2-7]/g, '')
  let bits = 0, value = 0, out: number[] = []
  for (const c of clean) {
    const idx = B32.indexOf(c)
    if (idx < 0) continue
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      bits -= 8
      out.push((value >>> bits) & 0xff)
    }
  }
  return new Uint8Array(out)
}

export async function totpNow(seed: string): Promise<{ code: string; remaining: number }> {
  const keyBytes = base32Decode(parseTotpSeed(seed))
  if (keyBytes.length === 0) throw new Error('invalid_seed')
  const counter = Math.floor(Date.now() / 1000 / 30)
  const msg = new Uint8Array(8)
  // counter en big-endian 64 bits (JS : Number suffit jusqu'en 2242)
  let n = counter
  for (let i = 7; i >= 0; i--) { msg[i] = n & 0xff; n = Math.floor(n / 256) }
  const key = await crypto.subtle.importKey('raw', keyBytes as BufferSource, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg as BufferSource))
  const off = sig[sig.length - 1] & 0x0f
  const bin = ((sig[off] & 0x7f) << 24) | (sig[off + 1] << 16) | (sig[off + 2] << 8) | sig[off + 3]
  const code = String(bin % 1_000_000).padStart(6, '0')
  return { code, remaining: 30 - (Math.floor(Date.now() / 1000) % 30) }
}

// ---- générateur de mots de passe ----

const G_LOWER = 'abcdefghijkmnopqrstuvwxyz'
const G_UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const G_DIGITS = '23456789'
const G_SYMBOLS = '!@#$%^&*()-_=+[]{};:,.?/' // ambigus retirés (I, l, 0, O, 1)

export function generatePassword(opts: { length: number; upper: boolean; lower: boolean; digits: boolean; symbols: boolean }): string {
  let pool = ''
  if (opts.lower) pool += G_LOWER
  if (opts.upper) pool += G_UPPER
  if (opts.digits) pool += G_DIGITS
  if (opts.symbols) pool += G_SYMBOLS
  if (!pool.length) pool = G_LOWER
  const len = Math.max(opts.length, 8)
  const rand = new Uint32Array(len)
  crypto.getRandomValues(rand)
  let out = ''
  for (let i = 0; i < len; i++) out += pool[rand[i] % pool.length]
  return out
}

// passphrase : liste compacte (mots français courts, sans accents,
// sans ambigüité) — l'entropie vient du tirage aléatoire uniforme.
const WORDS = ('abricot aigle ancre arbre argile atome avion bagne bateau bison blé bois bonze bord brume cactus canyon capuce carbone cedre chalet chardon cime citron cobra corail cordage cote crete cristal cygne delta dune eole ecume ecorce effort ember epice etable etoile favon foret fougere gallet givre granite harpe haux hêtre iblee if ile ivoire jade jonc kayak lagon lance lavande lievre lin lotus luge manguier marbre matelot menhir mica mont morne moteur moussu myrte nacre nectar neuve niere noix nord nuage oasis océan ocre onde opale orbit orge oseille ouistiti patate paon passe pavot peuplier phare pilot pin pivoine platane plume pond polaire pommier porte prairie prisme quai quartz quinoa radeau ramier recoin renard rhubarbe rideau rivage romarin rosee rotin rupture safran sagaie sable sagette sel sequoia sirocco socle soie sorbe souffle stèle strate sumac taiga talus tamarin tapis taupe taverne tellure tempe thuya tilleul topo toundra tresor tribune tulipe tuyau ulme vallon vanille velours verjon vigne voleur yucca zebré').split(/\s+/)

export function generatePassphrase(words = 4): string {
  const rand = new Uint32Array(words)
  crypto.getRandomValues(rand)
  const picks: string[] = []
  for (let i = 0; i < words; i++) picks.push(WORDS[rand[i] % WORDS.length])
  // un séparateur aléatoire simple et un chiffre d'appui
  const sep = ['-','_','.'][rand[0] % 3]
  const n = rand[1] % 100
  return picks.join(sep) + sep + String(n)
}

// ---- force d'un mot de passe (entropie estimée) ----

export function passwordStrength(pw: string): { bits: number; label: string } {
  if (!pw) return { bits: 0, label: 'weak' }
  const hasLower = /[a-z]/.test(pw)
  const hasUpper = /[A-Z]/.test(pw)
  const hasDigit = /\d/.test(pw)
  const hasSymbol = /[^a-zA-Z0-9]/.test(pw)
  let pool = 0
  if (hasLower) pool += 26
  if (hasUpper) pool += 26
  if (hasDigit) pool += 10
  if (hasSymbol) pool += 33
  if (pool === 0) pool = 26
  // pénalité répétitions : caractères uniques comptent, répétitions à demi
  const uniq = new Set(pw).size
  const effective = uniq + Math.max(0, pw.length - uniq) * 0.5
  const bits = Math.round(effective * Math.log2(pool))
  const label = bits < 30 ? 'weak' : bits < 50 ? 'fair' : bits < 70 ? 'good' : bits < 90 ? 'strong' : 'excellent'
  return { bits, label }
}

// ---- import/export Bitwarden (Vaultwarden) ----

export interface BitwardenExport {
  encrypted?: boolean
  folders?: { id: string; name: string }[]
  items?: {
    id?: string
    folderId?: string
    type?: number // 1 = login, 2 = note sécurisée
    name?: string
    notes?: string
    login?: { username?: string; password?: string; uris?: { uri?: string }[]; totp?: string }
  }[]
}

// bitwardenToItems : convertit un export JSON Bitwarden en items du
// coffre (les dossiers sont résolus par nom, tout devient E2E chiffré).
export function bitwardenToItems(json: BitwardenExport): CoffreItemData[] {
  const folders = new Map<string, string>()
  for (const f of json.folders || []) folders.set(f.id, f.name)
  const out: CoffreItemData[] = []
  for (const it of json.items || []) {
    if (json.encrypted) continue // refuser les exports chiffrés Bitwarden (clé non disponible)
    const isLogin = (it.type ?? 1) === 1
    out.push({
      v: 1,
      type: isLogin ? 'login' : 'note',
      name: it.name || '(sans nom)',
      username: isLogin ? it.login?.username || '' : '',
      password: isLogin ? it.login?.password || '' : '',
      uris: isLogin ? (it.login?.uris || []).map(u => u.uri || '').filter(Boolean) : [],
      totp: isLogin ? it.login?.totp || '' : '',
      notes: it.notes || '',
      folder: folders.get(it.folderId || '') || '',
      favorite: false,
      history: [],
    })
  }
  return out
}

// itemsToBitwarden : export au format Bitwarden (ré-importable dans
// Vaultwarden). Les items sont en CLAIR — la webui impose une
// confirmation explicite avant d'y arriver.
export function itemsToBitwarden(items: DecryptedItem[]): BitwardenExport {
  const folderNames = [...new Set(items.map(i => i.folder || '').filter(Boolean))]
  const folderIds = new Map(folderNames.map((n, idx) => [n, String(idx)]))
  return {
    encrypted: false,
    folders: folderNames.map(n => ({ id: folderIds.get(n)!, name: n })),
    items: items.map(i => ({
      id: i.id,
      folderId: i.folder ? folderIds.get(i.folder) : undefined,
      type: i.type === 'note' ? 2 : 1,
      name: i.name,
      notes: i.notes || '',
      login: i.type === 'note' ? undefined : {
        username: i.username || '',
        password: i.password || '',
        uris: (i.uris || []).map(uri => ({ uri })),
        totp: i.totp || '',
      },
    })),
  }
}