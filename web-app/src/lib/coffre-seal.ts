// Coffre — sauvegarde chiffrée KVCS1 (v1.9.0).
// Scelle TOUT le coffre (items v2 déchiffrés + pièces jointes en clair)
// derrière une passphrase propre à CE fichier : le .kvc est autonome,
// indépendant du mot de passe maître et de la clé du coffre — restaurable
// dans n'importe quelle instance. Même schéma que lib/coffre.ts :
// passphrase --PBKDF2-SHA256 600k--> clé fichier → AES-256-GCM
// (nonce 12 || ct, base64). Zero-knowledge intact : scellement comme
// déscellement se font dans le navigateur — le fichier quitte (ou
// arrive) déjà chiffré, le serveur n'intervient jamais.
//
// Fichier .kvc (JSON UTF-8) :
//   { "format": "kvcs1",
//     "kdf": { "algo": "PBKDF2-SHA256", "iterations": 600000,
//              "salt_b64": "<16 octets+>" },
//     "blob_b64": "<base64(nonce(12) || AES-256-GCM-ct)>" }
// Contenu scellé : {"v":1,"exported_at":"<RFC3339>","items":[…]} où
// chaque item = l'objet v2 complet sans id, PLUS "attachments" (liste
// de pièces jointes déchiffrées, ou null).

export const KVCS1 = 'kvcs1'

// OWASP 2023+ pour PBKDF2-SHA256 — même coût que le coffre lui-même.
// La valeur réellement utilisée est écrite DANS le fichier (kdf) : un
// futur relèvement ne rend pas les vieilles sauvegardes illisibles.
const KDF_ITERATIONS = 600_000
const KDF_ALGO = 'PBKDF2-SHA256'

// ---- structure du fichier (documentation typée du format) ----

export interface KvcBackup {
  format: string
  kdf: { algo: string; iterations: number; salt_b64: string }
  blob_b64: string
}

// pièce jointe transportée dans le scellé (mêmes champs que la lib
// pièces jointes — agent 3) : filename + mime + contenu base64
export interface SealedAttachment {
  filename: string
  mime: string
  data_b64: string
}

export interface SealedPayload {
  v: 1
  exported_at: string
  items: any[] // objets v2 sans id, chacun avec "attachments" en plus
}

// ---- base64 helpers (mêmes que coffre.ts) ----

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

// ---- KDF + scellement (pattern de coffre.ts) ----

async function deriveFileKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', te(passphrase), 'PBKDF2', false, ['deriveKey'])
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

// ---- API (contrat v1.9.0 §2) ----

// sealVault : chiffre le payload (items v2 + pièces jointes) avec la
// passphrase → texte du fichier .kvc, prêt à être téléchargé tel quel.
export async function sealVault(passphrase: string, payload: object): Promise<string> {
  const salt = randomBytes(16)
  const key = await deriveFileKey(passphrase, salt, KDF_ITERATIONS)
  const blob = await seal(key, te(JSON.stringify(payload)))
  const file: KvcBackup = {
    format: KVCS1,
    kdf: { algo: KDF_ALGO, iterations: KDF_ITERATIONS, salt_b64: b64(salt) },
    blob_b64: b64(blob),
  }
  return JSON.stringify(file)
}

// unsealVault : ouvre un fichier .kvc. TOUT échec — JSON cassé, format
// étranger, passphrase fausse, GCM altéré — se résout en
// 'bad_passphrase' : l'UI n'affiche qu'UNE seule key
// (cofSealImportBad) et rien ne fuit sur le contenu du fichier.
export async function unsealVault(passphrase: string, fileText: string): Promise<{ items: any[]; exported_at: string }> {
  try {
    const file = JSON.parse(fileText) as KvcBackup
    if (!file || file.format !== KVCS1 || !file.kdf || file.kdf.algo !== KDF_ALGO) throw new Error()
    const iterations = Number(file.kdf.iterations) || KDF_ITERATIONS
    const key = await deriveFileKey(passphrase, unb64(file.kdf.salt_b64 || ''), iterations)
    const data = JSON.parse(td(await open(key, unb64(file.blob_b64 || '')))) as SealedPayload
    if (!data || data.v !== 1 || !Array.isArray(data.items)) throw new Error()
    return { items: data.items, exported_at: data.exported_at || '' }
  } catch {
    throw new Error('bad_passphrase')
  }
}

// isSealedBackup : le texte parse-t-il en un JSON .format kvcs1 ?
// Sert de détection rapide à l'import (avant même de demander la
// passphrase à l'utilisateur).
export function isSealedBackup(text: string): boolean {
  try {
    const json = JSON.parse(text)
    return !!json && typeof json === 'object' && (json as KvcBackup).format === KVCS1
  } catch { return false }
}
