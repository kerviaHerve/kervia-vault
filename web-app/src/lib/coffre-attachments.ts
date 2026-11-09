// Coffre v1.9.0 — pièces jointes chiffrées (contrat §4, agent 3).
// Zero-knowledge INTACT : un fichier ne quitte JAMAIS le navigateur en
// clair. Chaque pièce jointe = DEUX blobs AES-256-GCM distincts, scellés
// avec la MÊME coffreKey que les items (nonce 12 || ct, base64 —
// conventions de lib/coffre.ts) :
//   meta_b64 = seal({"filename","mime","size"})  — petit : se déchiffre
//              SEUL pour lister sans jamais toucher au contenu
//   data_b64 = seal(contenu binaire)              — déchiffré au download
// Le serveur ne voit que des octets opaques : même le nom du fichier,
// son type et sa taille sont chiffrés.
//
// Clé : la coffreKey vit en PRIVÉ dans lib/coffre.ts (aucun getter n'y
// existe — et ce fichier n'est pas à nous). Toutes les fonctions du
// contrat la reçoivent donc EN PARAMÈTRE (jamais stockée ici). Pour
// l'UI, un petit registre mémoire de ce module sert de relais, rempli
// par l'hôte au déverrouillage OU par <ItemDialog> avec la clé reçue en
// prop : setCoffreKeyForAttachments(). La clé n'est JAMAIS persistée
// (zéro localStorage) — reload = coffre reverrouillé, blobs illisibles,
// c'est voulu.
//
// Endpoints (contrat §4, backend du coordinateur — en place au build) :
//   POST   /admin/coffre/items/{id}/attachments  {meta_b64,data_b64} → {id}
//   GET    /admin/coffre/items/{id}/attachments   → [{id,meta_b64,size,created_at}]
//   GET    /admin/coffre/attachments/{aid}       → {meta_b64,data_b64}
//   DELETE /admin/coffre/attachments/{aid}       → {deleted:true}
// Erreurs serveur : attach_too_big / attach_too_many / attach_not_found
// (l'UI les mappe en messages locaux — voir ItemDialog.tsx).

import { api, ApiError } from './api'

export const ATTACH_MAX_RAW = 2 * 1024 * 1024 // 2 Mo — cap fichier brut (client AVANT upload + serveur)
export const ATTACH_MAX_PER_ITEM = 5

// ---- types (contrat §4) ----

// ligne du listing serveur — meta_b64 opaque, déchiffrable via attachDecryptMeta
export interface AttachmentMeta {
  id: string
  meta_b64: string
  size: number
  created_at: string
}

// meta scellé, une fois déchiffré (nom lisible + taille RÉELLE du fichier,
// pas la taille chiffrée côté serveur)
export interface AttachMetaPlain {
  filename: string
  mime: string
  size: number
}

// fichier du bundle export/import KVCS1 (agent 2) — contenu DÉCHIFFRÉ en base64
export interface AttachBundleFile {
  filename: string
  mime: string
  data_b64: string
}

// ---- registre de la coffreKey (relais UI — voir en-tête) ----
// Rempli par l'hôte (juste après unlockCoffre) ou par <ItemDialog>
// (prop coffreKey, relaie au montage). Lu par la section UI. Clé en
// mémoire module uniquement, jamais persistée, jamais exposée au réseau.
let keyRegistry: CryptoKey | null = null
export function setCoffreKeyForAttachments(key: CryptoKey | null): void { keyRegistry = key }
export function getCoffreKeyForAttachments(): CryptoKey | null { return keyRegistry }

// ---- AES-GCM (mêmes conventions que lib/coffre.ts : nonce 12 || ct) ----
// Helpers dupliqués car privés dans coffre.ts (qui n'est pas à nous) ;
// toute divergence de format rendrait les blobs indéchiffrables.
// Typage précis : TS 5.7+ distingue Uint8Array<ArrayBuffer> (acceptable
// par WebCrypto) de Uint8Array<ArrayBufferLike> — toutes nos données
// sont allouées en ArrayBuffer local.

function b64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

function unb64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function te(s: string): Uint8Array<ArrayBuffer> { return new TextEncoder().encode(s) }

async function seal(key: CryptoKey, plaintext: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce as BufferSource }, key, plaintext as BufferSource))
  const out = new Uint8Array(12 + ct.length)
  out.set(nonce, 0); out.set(ct, 12)
  return out
}

async function open(key: CryptoKey, sealed: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: sealed.slice(0, 12) as BufferSource },
    key, sealed.slice(12) as BufferSource))
}

// ---- API (signatures EXACTES du contrat §4) ----

// ajoute un fichier : cap 2 Mo vérifiée LOCALEMENT avant tout scellement
// et tout upload (le serveur revérifie — défense en profondeur). Le quota
// 5/item reste au serveur (source de vérité) et à l'UI (liste en main).
export async function attachAdd(key: CryptoKey, itemId: string, file: File): Promise<{ id: string }> {
  if (file.size > ATTACH_MAX_RAW) {
    // même code que le serveur → l'UI mappe en t.cofAttachTooBig(2)
    throw new ApiError(413, 'attach_too_big', 'file too large')
  }
  const raw = new Uint8Array(await file.arrayBuffer())
  const meta: AttachMetaPlain = {
    filename: file.name || 'file',
    mime: file.type || 'application/octet-stream',
    size: file.size,
  }
  const meta_b64 = b64(await seal(key, te(JSON.stringify(meta))))
  const data_b64 = b64(await seal(key, raw))
  return api<{ id: string }>('POST', `/admin/coffre/items/${itemId}/attachments`, { meta_b64, data_b64 })
}

export async function attachList(itemId: string): Promise<AttachmentMeta[]> {
  const raw = await api('GET', `/admin/coffre/items/${itemId}/attachments`)
  // une réponse inattendue est une ERREUR — jamais déguisée en liste vide
  if (!Array.isArray(raw)) throw new ApiError(500, 'bad_response', 'unexpected attachments payload')
  return raw
}

export async function attachDecryptMeta(key: CryptoKey, meta_b64: string): Promise<AttachMetaPlain> {
  return JSON.parse(new TextDecoder().decode(await open(key, unb64(meta_b64))))
}

// download : fetch des DEUX blobs puis déchiffrement local — le contenu
// clair ne vit que dans la mémoire de la page, jamais sur le réseau.
export async function attachDownload(key: CryptoKey, att: AttachmentMeta): Promise<{ filename: string; mime: string; data: ArrayBuffer }> {
  const rec = await api<{ meta_b64: string; data_b64: string }>('GET', `/admin/coffre/attachments/${att.id}`)
  const meta = await attachDecryptMeta(key, rec.meta_b64)
  const plain = await open(key, unb64(rec.data_b64))
  return { filename: meta.filename, mime: meta.mime, data: plain.buffer }
}

export async function attachRemove(attId: string): Promise<void> {
  await api('DELETE', `/admin/coffre/attachments/${attId}`)
}

// ---- export/import KVCS1 (consommé par l'agent 2 — signatures figées) ----

// toutes les pièces jointes d'un item, DÉCHIFFRÉES (sauvegarde chiffrée
// kvcs1). Toute pièce illisible fait échouer l'export : un backup doit
// être complet, pas silencieusement partiel — l'appelant toaste.
export async function attachExportBundle(key: CryptoKey, itemId: string): Promise<AttachBundleFile[]> {
  const out: AttachBundleFile[] = []
  for (const att of await attachList(itemId)) {
    const rec = await api<{ meta_b64: string; data_b64: string }>('GET', `/admin/coffre/attachments/${att.id}`)
    const meta = await attachDecryptMeta(key, rec.meta_b64)
    const plain = await open(key, unb64(rec.data_b64))
    out.push({ filename: meta.filename, mime: meta.mime, data_b64: b64(plain) })
  }
  return out
}

// import d'un bundle : re-scelle chaque fichier avec la clé courante et
// l'uploade sur l'item cible (déjà créé par le pipeline d'import).
// Retour = nombre RÉELLEMENT importés : les fichiers au-delà du quota
// 5/item ou > 2 Mo (bundle corrompu/forgé) ne partent jamais — l'appelant
// compare avec files.length pour informer.
export async function attachImportBundle(key: CryptoKey, itemId: string, files: AttachBundleFile[]): Promise<number> {
  const existing = await attachList(itemId)
  const room = ATTACH_MAX_PER_ITEM - existing.length
  let n = 0
  for (const f of files) {
    if (n >= room) break
    const raw = unb64(f.data_b64)
    if (raw.length > ATTACH_MAX_RAW) continue // cap locale : rien ne part
    const meta: AttachMetaPlain = {
      filename: f.filename || 'file',
      mime: f.mime || 'application/octet-stream',
      size: raw.length,
    }
    const meta_b64 = b64(await seal(key, te(JSON.stringify(meta))))
    const data_b64 = b64(await seal(key, raw))
    await api('POST', `/admin/coffre/items/${itemId}/attachments`, { meta_b64, data_b64 })
    n++
  }
  return n
}
