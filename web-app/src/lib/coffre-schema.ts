// Coffre v2 — schéma des items : catégories (modèles), champs typés,
// normalisation v1→v2. TOUT vit dans le blob chiffré côté navigateur ;
// le serveur ne voit jamais ces structures (il ne stocke que du AES-GCM).
//
// Design (inspiré 1Password) : un item = une catégorie + une liste ORDONNÉE
// de champs {k: kind, l: label, v: value}. Les modèles définissent les
// champs préremplis (labels figés dans l'item à la création, selon la
// langue active) ; l'utilisateur peut ajouter ses propres champs.
//
// Migration douce : les items v1 (flat : username/password/uris/totp)
// sont convertis à la lecture ; ils ne sont réécrits en v2 qu'au
// prochain enregistrement — les vieux blobs restent lisibles pour
// toujours.

// ---- kinds de champs ----
export type FieldKind = 'text' | 'secret' | 'totp' | 'link' | 'month' | 'date' | 'multiline'

export interface CoffreField {
  k: FieldKind
  l: string // label (figé à la création, éditable pour les champs perso)
  v: string
}

// ---- catégories (modèles) ----
export type CategoryId =
  | 'login' | 'note' | 'card' | 'bank' | 'identity' | 'passport'
  | 'crypto' | 'ssh' | 'server' | 'db' | 'wifi' | 'license'
  | 'membership' | 'otp'

// un champ de modèle : kind + labels fr/en + option « champ mot de
// passe principal » (history/générateur/strength ciblent ce champ)
interface FieldDef {
  k: FieldKind
  fr: string
  en: string
  pw?: boolean
}

export interface CategoryDef {
  id: CategoryId
  fr: string
  en: string
  fields: FieldDef[]
}

export const CATEGORIES: Record<CategoryId, CategoryDef> = {
  login: {
    id: 'login', fr: 'Identifiant', en: 'Login',
    fields: [
      { k: 'text', fr: 'Identifiant', en: 'Username' },
      { k: 'secret', fr: 'Mot de passe', en: 'Password', pw: true },
      { k: 'link', fr: 'Site web', en: 'Website' },
      { k: 'totp', fr: 'TOTP', en: 'TOTP' },
    ],
  },
  note: {
    id: 'note', fr: 'Note sécurisée', en: 'Secure note',
    fields: [],
  },
  card: {
    id: 'card', fr: 'Carte bancaire', en: 'Payment card',
    fields: [
      { k: 'text', fr: 'Banque / Réseau', en: 'Bank / Network' },
      { k: 'text', fr: 'Titulaire', en: 'Cardholder' },
      { k: 'secret', fr: 'Numéro', en: 'Number' },
      { k: 'month', fr: 'Expire', en: 'Expires' },
      { k: 'secret', fr: 'CVV', en: 'CVV' },
      { k: 'secret', fr: 'Code PIN', en: 'PIN' },
    ],
  },
  bank: {
    id: 'bank', fr: 'Compte bancaire', en: 'Bank account',
    fields: [
      { k: 'text', fr: 'Banque', en: 'Bank' },
      { k: 'text', fr: 'Titulaire', en: 'Account holder' },
      { k: 'text', fr: 'IBAN', en: 'IBAN' },
      { k: 'text', fr: 'BIC / SWIFT', en: 'BIC / SWIFT' },
      { k: 'text', fr: 'Type de compte', en: 'Account type' },
    ],
  },
  identity: {
    id: 'identity', fr: 'Identité', en: 'Identity',
    fields: [
      { k: 'text', fr: 'Prénom', en: 'First name' },
      { k: 'text', fr: 'Nom', en: 'Last name' },
      { k: 'text', fr: 'Email', en: 'Email' },
      { k: 'text', fr: 'Téléphone', en: 'Phone' },
      { k: 'date', fr: 'Date de naissance', en: 'Date of birth' },
      { k: 'multiline', fr: 'Adresse', en: 'Address' },
    ],
  },
  passport: {
    id: 'passport', fr: 'Passeport', en: 'Passport',
    fields: [
      { k: 'text', fr: 'Nom complet', en: 'Full name' },
      { k: 'secret', fr: 'N° passeport', en: 'Passport number' },
      { k: 'text', fr: 'Nationalité', en: 'Nationality' },
      { k: 'date', fr: 'Délivré le', en: 'Issued' },
      { k: 'date', fr: 'Expire le', en: 'Expires' },
    ],
  },
  crypto: {
    id: 'crypto', fr: 'Wallet crypto', en: 'Crypto wallet',
    fields: [
      { k: 'text', fr: 'Réseau', en: 'Network' },
      { k: 'text', fr: 'Adresse publique', en: 'Public address' },
      { k: 'secret', fr: 'Clé privée', en: 'Private key', pw: true },
      { k: 'multiline', fr: 'Phrase seed', en: 'Seed phrase' },
    ],
  },
  ssh: {
    id: 'ssh', fr: 'Clé SSH', en: 'SSH key',
    fields: [
      { k: 'text', fr: 'Hôte', en: 'Host' },
      { k: 'text', fr: 'Utilisateur', en: 'User' },
      { k: 'multiline', fr: 'Clé privée', en: 'Private key' },
      { k: 'multiline', fr: 'Clé publique', en: 'Public key' },
      { k: 'secret', fr: 'Passphrase', en: 'Passphrase', pw: true },
    ],
  },
  server: {
    id: 'server', fr: 'Serveur', en: 'Server',
    fields: [
      { k: 'text', fr: 'Nom d\'hôte', en: 'Hostname' },
      { k: 'text', fr: 'Utilisateur', en: 'User' },
      { k: 'secret', fr: 'Mot de passe', en: 'Password', pw: true },
      { k: 'text', fr: 'Notes d\'accès', en: 'Access notes' },
    ],
  },
  db: {
    id: 'db', fr: 'Base de données', en: 'Database',
    fields: [
      { k: 'text', fr: 'Moteur', en: 'Engine' },
      { k: 'text', fr: 'Hôte', en: 'Host' },
      { k: 'text', fr: 'Base', en: 'Database' },
      { k: 'text', fr: 'Utilisateur', en: 'User' },
      { k: 'secret', fr: 'Mot de passe', en: 'Password', pw: true },
    ],
  },
  wifi: {
    id: 'wifi', fr: 'Wi-Fi', en: 'Wi-Fi',
    fields: [
      { k: 'text', fr: 'SSID', en: 'SSID' },
      { k: 'text', fr: 'Sécurité', en: 'Security' },
      { k: 'secret', fr: 'Mot de passe', en: 'Password', pw: true },
    ],
  },
  license: {
    id: 'license', fr: 'Licence logicielle', en: 'Software license',
    fields: [
      { k: 'text', fr: 'Éditeur', en: 'Publisher' },
      { k: 'text', fr: 'Version', en: 'Version' },
      { k: 'secret', fr: 'Clé de licence', en: 'License key', pw: true },
      { k: 'text', fr: 'Email d\'achat', en: 'Purchase email' },
      { k: 'date', fr: 'Acheté le', en: 'Purchased' },
    ],
  },
  membership: {
    id: 'membership', fr: 'Abonnement / Membre', en: 'Membership',
    fields: [
      { k: 'text', fr: 'Organisation', en: 'Organization' },
      { k: 'text', fr: 'N° de membre', en: 'Member number' },
      { k: 'date', fr: 'Depuis', en: 'Member since' },
      { k: 'date', fr: 'Expire le', en: 'Expires' },
    ],
  },
  otp: {
    id: 'otp', fr: 'Code TOTP', en: 'One-time code',
    fields: [
      { k: 'text', fr: 'Service', en: 'Service' },
      { k: 'text', fr: 'Compte', en: 'Account' },
      { k: 'totp', fr: 'Seed TOTP', en: 'TOTP seed' },
    ],
  },
}

export const CATEGORY_IDS = Object.keys(CATEGORIES) as CategoryId[]
export const CATEGORY_ORDER = CATEGORY_IDS

// ---- item v2 (contenu du blob chiffré) ----
export interface CoffreItemData {
  v: 2
  type: CategoryId
  name: string
  fields: CoffreField[]
  notes?: string
  folder?: string
  tags?: string[]
  favorite?: boolean
  history?: { password: string; changed_at: string }[]
  password_updated_at?: string
}

// item déchiffré côté UI (métadonnées serveur + contenu)
export interface DecryptedItem extends CoffreItemData {
  id: string
  version: number
  created_at: string
  updated_at: string
  deleted_at: string | null
  _broken?: boolean
  _v1?: boolean // encore stocké en v1 — converti à la volée, réécrit au save
}

// ---- création depuis un modèle ----
export function templateFields(cat: CategoryId, lang: 'fr' | 'en'): CoffreField[] {
  return CATEGORIES[cat].fields.map(f => ({ k: f.k, l: lang === 'en' ? f.en : f.fr, v: '' }))
}

export function newItem(cat: CategoryId, lang: 'fr' | 'en', name = ''): CoffreItemData {
  return { v: 2, type: cat, name, fields: templateFields(cat, lang), notes: '', folder: '', tags: [], favorite: false, history: [] }
}

// ---- migration v1 → v2 ----
// v1 (flat) : {v:1, type:'login'|'note', name, username, password, uris,
//              totp, notes, folder, favorite, history, password_updated_at}
// La conversion est pure : les vieux blobs restent intacts tant que
// l'utilisateur n'édite pas l'item.
export function normalizeItem(raw: any): CoffreItemData {
  if (!raw || typeof raw !== 'object') {
    return { v: 2, type: 'note', name: '???', fields: [] }
  }
  if ((raw as CoffreItemData).v === 2) {
    const it = raw as CoffreItemData
    // défense : fields toujours array, tags toujours array
    return { ...it, fields: Array.isArray(it.fields) ? it.fields : [], tags: Array.isArray(it.tags) ? it.tags : [] }
  }
  // v1 → v2
  const fields: CoffreField[] = []
  if (raw.type === 'login') {
    fields.push({ k: 'text', l: 'Identifiant', v: raw.username || '' })
    fields.push({ k: 'secret', l: 'Mot de passe', v: raw.password || '' })
    const uris: string[] = Array.isArray(raw.uris) ? raw.uris.filter(Boolean) : []
    if (uris.length > 0) fields.push({ k: 'link', l: 'Site web', v: uris[0] })
    for (const u of uris.slice(1)) fields.push({ k: 'link', l: 'Site web', v: u })
    if (raw.totp) fields.push({ k: 'totp', l: 'TOTP', v: raw.totp })
  }
  return {
    v: 2,
    type: raw.type === 'note' ? 'note' : 'login',
    name: raw.name || '(sans nom)',
    fields,
    notes: raw.notes || '',
    folder: raw.folder || '',
    tags: [],
    favorite: !!raw.favorite,
    history: Array.isArray(raw.history) ? raw.history : [],
    password_updated_at: raw.password_updated_at,
  }
}

// ---- helpers d'affichage ----

// le champ « mot de passe principal » : celui marqué pw dans le modèle,
// retrouvé par label ; fallback = premier champ secret
export function mainPasswordField(it: CoffreItemData): CoffreField | undefined {
  const def = CATEGORIES[it.type]
  const pwLabels = def ? def.fields.filter(f => f.pw).map(f => [f.fr, f.en]).flat() : []
  const byLabel = it.fields.find(f => f.k === 'secret' && pwLabels.includes(f.l))
  if (byLabel) return byLabel
  return it.fields.find(f => f.k === 'secret' && f.v)
}

// ligne de sous-titre sous le nom dans la liste : le champ le plus
// parlant selon la catégorie
export function itemSubtitle(it: CoffreItemData): string {
  const first = (kinds: FieldKind[]): string => {
    for (const f of it.fields) if (f.v && kinds.includes(f.k)) return f.v
    return ''
  }
  switch (it.type) {
    case 'card': {
      const num = first(['secret'])
      return num ? '•••• ' + num.replace(/\s/g, '').slice(-4) : first(['text'])
    }
    case 'login': return first(['text', 'link'])
    case 'bank': case 'identity': case 'server': case 'db':
    case 'wifi': case 'license': case 'membership': case 'crypto':
      return first(['text'])
    default: return ''
  }
}

// texte indexé par la recherche : tout, tags et dossier inclus
export function itemSearchText(it: CoffreItemData): string {
  return [
    it.name,
    ...it.fields.map(f => f.l + '\u0000' + f.v),
    it.notes || '',
    it.folder || '',
    ...(it.tags || []),
  ].filter(Boolean).join(' ').toLowerCase()
}

// premier champ totp de l'item (pour l'afficher en liste)
export function firstTotp(it: CoffreItemData): CoffreField | undefined {
  return it.fields.find(f => f.k === 'totp' && f.v)
}

// formatage des champs date/moth pour l'affichage
export function fmtField(kind: FieldKind, v: string): string {
  if (!v) return ''
  if (kind === 'month') {
    const m = /^(\d{4})-(\d{2})$/.exec(v)
    if (m) return `${m[2]}/${m[1]}`
    return v
  }
  if (kind === 'date') {
    const d = new Date(v)
    if (!isNaN(d.getTime())) return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
    return v
  }
  return v
}