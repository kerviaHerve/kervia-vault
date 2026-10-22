// Coffre v2 — imports / exports de gestionnaires de mots de passe.
// TOUT se passe côté navigateur : le fichier lu ne transite JAMAIS par
// le serveur, il est converti puis chiffré localement (E2E).
//
// Formats supportés à l'import :
//   - Bitwarden / Vaultwarden : JSON non chiffré (logins, notes, cartes,
//     identités, champs personnalisés, dossiers, favoris)
//   - Bitwarden CSV et CSV génériques : Chrome, Edge, Firefox, Safari,
//     LastPass, Dashlane, KeePass, Proton Pass, NordPass… (détection
//     automatique des colonnes)
//   - 1Password : 1PUX (.1pux = ZIP contenant export.data, format
//     officiel non chiffré) et 1PIF (legacy 1Password 7)
//   - Kervia : notre format complet (round-trip fidèle : tags, champs
//     personnalisés, historiques)
// À l'export : Kervia JSON (fidelity maximale) et Bitwarden JSON
// (ré-importable dans Vaultwarden).
//
// AUCUNE dépendance externe : le ZIP 1PUX est lu par API natives
// (DataView + DecompressionStream('deflate-raw')).

import type { CoffreField, CoffreItemData, FieldKind } from './coffre-schema'
import { normalizeItem } from './coffre-schema'

// ================= helpers =================

function f(k: FieldKind, l: string, v: string): CoffreField {
  return { k, l, v: (v ?? '') }
}

function base(lang: 'fr' | 'en' = 'fr'): Partial<CoffreItemData> {
  return { v: 2, fields: [], notes: '', folder: '', tags: [], favorite: false, history: [] }
}

function mk(type: CoffreItemData['type'], name: string, fields: CoffreField[], extra: Partial<CoffreItemData> = {}): CoffreItemData {
  return { ...(base() as CoffreItemData), type, name: name || '(sans nom)', fields, ...extra }
}

// ================= 1. Bitwarden JSON =================

export interface BitwardenExport {
  encrypted?: boolean
  folders?: { id: string; name: string }[]
  items?: {
    id?: string
    folderId?: string
    favorite?: boolean
    type?: number // 1 login, 2 note, 3 carte, 4 identité
    name?: string
    notes?: string
    fields?: { name?: string; value?: string; type?: number }[]
    login?: { username?: string; password?: string; uris?: { uri?: string }[]; totp?: string }
    card?: { cardholderName?: string; brand?: string; number?: string; expMonth?: string; expYear?: string; code?: string }
    identity?: {
      title?: string; firstName?: string; middleName?: string; lastName?: string
      email?: string; phone?: string; address1?: string; address2?: string; address3?: string
      city?: string; state?: string; postalCode?: string; country?: string; ssn?: string
      passportNumber?: string; licenseNumber?: string; username?: string
    }
  }[]
}

const BW_EXTRA_KIND: Record<number, FieldKind> = { 0: 'text', 1: 'secret', 2: 'text', 3: 'link' }

// bitwardenToItems : export JSON Bitwarden non chiffré → items v2.
// Les champs personnalisés deviennent des champs additionnels.
export function bitwardenToItems(json: BitwardenExport): { items: CoffreItemData[]; skippedEncrypted: boolean } {
  const out: CoffreItemData[] = []
  const folders = new Map<string, string>()
  for (const fo of json.folders || []) folders.set(fo.id, fo.name)
  let skippedEncrypted = false
  for (const it of json.items || []) {
    if (json.encrypted) { skippedEncrypted = true; continue }
    const folder = folders.get(it.folderId || '') || ''
    const fav = !!it.favorite
    const extra: CoffreField[] = (it.fields || [])
      .filter(x => x && x.name && x.type !== 2) // boolean → inutile en v2
      .map(x => f(BW_EXTRA_KIND[x.type ?? 0] || 'text', x.name!, x.value || ''))
    const notes = it.notes || ''
    switch (it.type ?? 1) {
      case 1: {
        const uris = (it.login?.uris || []).map(u => u.uri || '').filter(Boolean)
        out.push(mk('login', it.name || '', [
          f('text', 'Identifiant', it.login?.username || ''),
          f('secret', 'Mot de passe', it.login?.password || ''),
          ...uris.map((u, i) => f('link', i === 0 ? 'Site web' : 'Site web', u)),
          ...(it.login?.totp ? [f('totp', 'TOTP', it.login.totp)] : []),
          ...extra,
        ], { folder, favorite: fav, notes }))
        break
      }
      case 2:
        out.push(mk('note', it.name || '', extra, { folder, favorite: fav, notes }))
        break
      case 3: {
        const c = it.card || {}
        out.push(mk('card', it.name || '', [
          f('text', 'Banque / Réseau', c.brand || ''),
          f('text', 'Titulaire', c.cardholderName || ''),
          f('secret', 'Numéro', c.number || ''),
          f('month', 'Expire', c.expMonth && c.expYear ? `${c.expYear}-${c.expMonth.padStart(2, '0')}` : ''),
          f('secret', 'CVV', c.code || ''),
          ...extra,
        ], { folder, favorite: fav, notes }))
        break
      }
      case 4: {
        const i = it.identity || {}
        const addr = [i.address1, i.address2, i.address3, i.postalCode && `${i.postalCode} `, i.city, i.state, i.country]
          .filter(Boolean).join(', ')
        out.push(mk('identity', it.name || '', [
          f('text', 'Prénom', i.firstName || ''),
          f('text', 'Nom', i.lastName || ''),
          f('text', 'Email', i.email || ''),
          f('text', 'Téléphone', i.phone || ''),
          ...(addr ? [f('multiline', 'Adresse', addr)] : []),
          ...(i.ssn ? [f('text', 'N° AVS', i.ssn)] : []),
          ...(i.passportNumber ? [f('secret', 'N° passeport', i.passportNumber)] : []),
          ...(i.licenseNumber ? [f('text', 'N° permis', i.licenseNumber)] : []),
          ...extra,
        ], { folder, favorite: fav, notes }))
        break
      }
      default: {
        // type inconnu (5 ssh…) → note avec les champs en clair
        out.push(mk('note', it.name || '', extra, { folder, favorite: fav, notes }))
      }
    }
  }
  return { items: out, skippedEncrypted }
}

// itemsToBitwarden : export JSON Bitwarden (ré-importable Vaultwarden).
// Les champs non mappables (ssh, wifi, tags…) finissent en champs
// personnalisés — rien n'est perdu silencieusement.
export function itemsToBitwarden(items: CoffreItemData[]): BitwardenExport {
  const folderNames = [...new Set(items.map(i => i.folder || '').filter(Boolean))]
  const folderIds = new Map(folderNames.map((n, i) => [n, String(i + 1)]))
  const bwItems: Extract<BitwardenExport, { items?: any }>['items'] = []
  for (const it of items) {
    const custom = it.fields
      .filter(x => !['Identifiant', 'Mot de passe', 'Site web', 'TOTP'].includes(x.l) || x.k === 'multiline')
      .filter(x => x.v || x.l)
      .map(x => ({ name: x.l, value: x.v, type: x.k === 'secret' ? 1 : x.k === 'link' ? 3 : 0 }))
    const common = {
      folderId: it.folder ? folderIds.get(it.folder) : undefined,
      favorite: !!it.favorite,
      name: it.name,
      notes: it.notes || '',
      fields: custom.length ? custom : undefined,
    }
    switch (it.type) {
      case 'note':
        bwItems.push({ ...common, type: 2 })
        break
      case 'card': {
        const get = (l: string) => it.fields.find(x => x.l === l)?.v || ''
        const month = /^(\d{4})-(\d{2})$/.exec(get('Expire'))
        bwItems.push({
          ...common, type: 3,
          card: {
            cardholderName: get('Titulaire'),
            brand: get('Banque / Réseau'),
            number: get('Numéro'),
            expMonth: month ? month[2] : '',
            expYear: month ? month[1] : '',
            code: get('CVV'),
          },
        })
        break
      }
      case 'identity': {
        const get = (l: string) => it.fields.find(x => x.l === l)?.v || ''
        bwItems.push({
          ...common, type: 4,
          identity: {
            firstName: get('Prénom'), lastName: get('Nom'),
            email: get('Email'), phone: get('Téléphone'),
            address1: get('Adresse'),
          },
        })
        break
      }
      default: {
        // login, et toutes les catégories dégradées en login (ssh, server,
        // db, wifi, license, membership, crypto, otp, passport, bank…)
        const username = it.fields.find(x => x.l === 'Identifiant' || x.l === 'Utilisateur' || x.l === 'User')?.v || ''
        const password = it.fields.find(x => x.k === 'secret')?.v || ''
        const uris = it.fields.filter(x => x.k === 'link' && x.v).map(u => ({ uri: u.v }))
        const totp = it.fields.find(x => x.k === 'totp')?.v || ''
        bwItems.push({ ...common, type: 1, login: { username, password, uris, totp } })
      }
    }
  }
  return {
    encrypted: false,
    folders: folderNames.map(n => ({ id: folderIds.get(n)!, name: n })),
    items: bwItems,
  }
}

// ================= 2. CSV génériques =================

// parseur RFC 4180 : guillemets, virgules, retours ligne dans les champs
export function parseCSV(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], field = '', inQ = false
  const s = text.replace(/^\uFEFF/, '') // BOM
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inQ) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++ } else inQ = false
      } else field += c
    } else if (c === '"') inQ = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.some(x => x !== '')) rows.push(row)
      row = []
    } else field += c
  }
  row.push(field)
  if (row.some(x => x !== '')) rows.push(row)
  return rows
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '')

function findCol(headers: string[], cands: string[]): number {
  for (const c of cands) {
    const i = headers.indexOf(c)
    if (i >= 0) return i
  }
  return -1
}

// csvToItems : détecte les colonnes par leurs en-têtes (Chrome, Firefox,
// Safari, LastPass, Dashlane, KeePass, Proton, Bitwarden, NordPass…).
// Les cartes bancaires sont reconnues par leurs colonnes dédiées.
export function csvToItems(text: string): CoffreItemData[] {
  const rows = parseCSV(text)
  if (rows.length < 2) return []
  const headers = rows[0].map(norm)
  const col = (cands: string[]) => findCol(headers, cands.map(norm))
  const iName = col(['name', 'title', 'account', 'account name', 'accountname', 'nom', 'titre', 'item', 'login'])
  const iUrl = col(['url', 'login_uri', 'website', 'websiteurl', 'web site', 'site', 'uri', 'login url', 'adresse web', 'login_url', 'location'])
  const iUser = col(['username', 'login_username', 'user name', 'user', 'login', 'email', 'identifiant', 'utilisateur', 'userid', 'login_username', 'username'])
  const iPass = col(['password', 'login_password', 'pass', 'motdepasse', 'pwd', 'passwd', 'password'])
  const iTotp = col(['totp', 'login_totp', 'otp', 'onetimepassword', 'one time password', '2fa', 'totp'])
  const iNotes = col(['notes', 'note', 'extra', 'comment', 'comments', 'remarques', 'note'])
  const iFolder = col(['folder', 'grouping', 'group', 'vault', 'collection', 'dossier', 'folder'])
  const iFav = col(['favorite', 'fav', 'favori'])
  // cartes
  const iCardHolder = col(['cardholder', 'cardholdername', 'cardholder name', 'name on card', 'titulaire'])
  const iCardNum = col(['number', 'cardnumber', 'card number', 'ccnumber', 'numero', 'num'])
  const iCardExpM = col(['expmonth', 'exp month', 'expiry month', 'expmm', 'month'])
  const iCardExpY = col(['expyear', 'exp year', 'expiry year', 'expyy', 'year'])
  const iCardCvv = col(['cvv', 'cvc', 'securitycode', 'security code', 'cvv'])
  if (iPass < 0 && iCardNum < 0 && iUser < 0) return []
  const out: CoffreItemData[] = []
  for (const r of rows.slice(1)) {
    const g = (i: number) => i >= 0 && r[i] ? r[i].trim() : ''
    const name = g(iName) || g(iUrl) || g(iUser) || '(sans nom)'
    const folder = g(iFolder)
    const favorite = ['1', 'true', 'vrai', 'yes', 'oui'].includes(g(iFav).toLowerCase())
    const notes = g(iNotes)
    if (iCardNum >= 0 && g(iCardNum)) {
      out.push(mk('card', name, [
        f('text', 'Titulaire', g(iCardHolder)),
        f('secret', 'Numéro', g(iCardNum)),
        f('month', 'Expire', g(iCardExpM) && g(iCardExpY)
          ? `${g(iCardExpY).length === 2 ? '20' + g(iCardExpY) : g(iCardExpY)}-${g(iCardExpM).padStart(2, '0')}` : ''),
        f('secret', 'CVV', g(iCardCvv)),
      ], { folder, favorite, notes }))
    } else {
      out.push(mk('login', name, [
        f('text', 'Identifiant', g(iUser)),
        f('secret', 'Mot de passe', g(iPass)),
        ...(g(iUrl) ? [f('link', 'Site web', g(iUrl))] : []),
        ...(g(iTotp) ? [f('totp', 'TOTP', g(iTotp))] : []),
      ], { folder, favorite, notes }))
    }
  }
  return out.filter(it => it.fields.some(x => x.v) || it.notes)
}

// ================= 3. 1Password 1PUX (ZIP) =================

// lecteur ZIP minimal (lecture seule, STORE + DEFLATE) via API natives —
// DecompressionStream('deflate-raw') est supporté partout depuis 2023.
async function unzipOne(bytes: Uint8Array, wanted: string): Promise<Uint8Array | null> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // EOCD : balayer depuis la fin (22 octets + commentaire éventuel)
  let eocd = -1
  for (let i = bytes.length - 22; i >= 0 && i > bytes.length - 22 - 65536; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('zip_eocd_missing')
  const count = dv.getUint16(eocd + 10, true)
  let p = dv.getUint32(eocd + 16, true) // début du central directory
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('zip_cd_corrupt')
    const method = dv.getUint16(p + 10, true)
    const nameLen = dv.getUint16(p + 28, true)
    const extraLen = dv.getUint16(p + 30, true)
    const commentLen = dv.getUint16(p + 32, true)
    const localOff = dv.getUint32(p + 42, true)
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen))
    if (name === wanted) {
      // local file header : sauter jusqu'aux données
      if (dv.getUint32(localOff, true) !== 0x04034b50) throw new Error('zip_lfh_corrupt')
      const lNameLen = dv.getUint16(localOff + 26, true)
      const lExtraLen = dv.getUint16(localOff + 28, true)
      const dataStart = localOff + 30 + lNameLen + lExtraLen
      // taille compressée : depuis le central directory (data descriptor
      // peut être absent du local header quand le flux est seekable)
      const cSize = dv.getUint32(p + 20, true)
      const data = bytes.subarray(dataStart, dataStart + cSize)
      if (method === 0) return new Uint8Array(data)
      if (method === 8) {
        const ds = new DecompressionStream('deflate-raw')
        const stream = new Blob([data as unknown as BlobPart]).stream().pipeThrough(ds)
        return new Uint8Array(await new Response(stream).arrayBuffer())
      }
      throw new Error('zip_method_unsupported')
    }
    p += 46 + nameLen + extraLen + commentLen
  }
  return null
}

// mapping catégorie 1PUX → catégorie coffre
const PUX_CAT: Record<string, CoffreItemData['type']> = {
  '001': 'login', '002': 'login', '003': 'note', '005': 'card',
  '006': 'membership', '007': 'identity', '010': 'db', '011': 'passport',
  '012': 'license', '013': 'membership', '015': 'login', '016': 'wifi',
  '017': 'server', '018': 'identity', '019': 'note', '101': 'bank',
  '104': 'crypto',
}

// labels 1PUX par id de champ connu (les autres → champs personnalisés)
const PUX_LABEL: Record<string, string> = {
  username: 'Identifiant', password: 'Mot de passe', url: 'Site web',
  totp: 'TOTP', email: 'Email', notes: '', // notes gérées à part
  ccnum: 'Numéro', ccType: 'Banque / Réseau', cardholder: 'Titulaire',
  cvv: 'CVV', pin: 'Code PIN', expiry: 'Expire', validfrom: 'Valide depuis',
  bankName: 'Banque', accountType: 'Type de compte', iban: 'IBAN',
  swift: 'BIC / SWIFT', routing: 'Routing', accountNumber: 'N° de compte',
  server: 'Hôte', port: 'Port', database: 'Base',
  firstname: 'Prénom', lastname: 'Nom', fullname: 'Nom complet',
  address: 'Adresse', birthdate: 'Date de naissance', phone: 'Téléphone',
  ssid: 'SSID', wirelesspassword: 'Mot de passe', network: 'SSID',
  license_version: 'Version', publisher: 'Éditeur', reg_code: 'Clé de licence',
  passportnumber: 'N° passeport', country: 'Pays', nationality: 'Nationalité',
}

const PUX_KIND: Record<string, FieldKind> = {
  string: 'text', concealed: 'secret', totp: 'totp', url: 'link',
  email: 'text', date: 'date', monthYear: 'month', phone: 'text',
  address: 'multiline', menu: 'text',
}

// onepuxToItems : export.data (JSON du ZIP 1PUX) → items v2.
export async function onepuxToItems(zipBytes: Uint8Array): Promise<CoffreItemData[]> {
  const data = await unzipOne(zipBytes, 'export.data')
  if (!data) throw new Error('export_data_missing')
  const json = JSON.parse(new TextDecoder().decode(data))
  return puxJsonToItems(json)
}

function puxJsonToItems(json: any): CoffreItemData[] {
  const out: CoffreItemData[] = []
  for (const acc of json.accounts || []) {
    for (const vault of acc.vaults || []) {
      const vaultName = vault.attrs?.name || ''
      for (const it of vault.items || []) {
        if (!it || !it.title) continue
        const type = PUX_CAT[it.category || ''] || 'note'
        const fields: CoffreField[] = []
        let notes = ''
        for (const fl of it.fields || []) {
          if (!fl) continue
          const kind = PUX_KIND[fl.type] || 'text'
          if (fl.id === 'notes' || fl.value === 'NotesPlain') { notes = fl.value || ''; continue }
          if (!fl.value) continue
          if (kind === 'totp') { fields.push(f('totp', 'TOTP', fl.value)); continue }
          const label = PUX_LABEL[fl.id] || fl.label || fl.id || ''
          fields.push(f(kind, label, String(fl.value)))
        }
        for (const u of it.urls || []) {
          if (u?.href) fields.push(f('link', 'Site web', u.href))
        }
        const tags: string[] = Array.isArray(it.tags) ? it.tags.filter(Boolean).map(String) : []
        out.push(mk(type, String(it.title), fields, {
          folder: vaultName,
          tags,
          favorite: !!it.favorite,
          notes,
        }))
      }
    }
  }
  return out
}

// ================= 4. 1Password 1PIF (legacy) =================

const PIF_SEP = '***506160475***'

// onepifToItems : format texte 1Password 7 (séparateur ***506160475***,
// lignes key: value, JSON dans contents). Best-effort, sans perte : les
// clés inconnues finissent en champs personnalisés.
export function onepifToItems(text: string): CoffreItemData[] {
  const chunks = text.split(PIF_SEP)
  const folders = new Map<string, string>()
  interface PifRec { typeName?: string; title?: string; url?: string; username?: string; password?: string; notesPlain?: string; folderUuid?: string; uuid?: string; contents?: string; [k: string]: any }
  const recs: PifRec[] = []
  for (const ch of chunks) {
    const rec: PifRec = {}
    for (const line of ch.split(/\r?\n/)) {
      const i = line.indexOf(':')
      if (i > 0) rec[line.slice(0, i).trim()] = line.slice(i + 1).trim()
    }
    if (rec.typeName === 'system.folder.Folder' && rec.uuid) {
      folders.set(rec.uuid, rec.title || rec.name || '')
      continue
    }
    if (rec.typeName && rec.title !== undefined) recs.push(rec)
  }
  const out: CoffreItemData[] = []
  for (const r of recs) {
    let contents: any = {}
    try { contents = r.contents ? JSON.parse(r.contents) : {} } catch { /* best-effort */ }
    const g = (k: string): string => (contents[k] ?? r[k] ?? '') + ''
    const tn = r.typeName || ''
    const urls: string[] = (contents.URLs || []).map((u: any) => u.url || u).filter(Boolean)
    const fields: CoffreField[] = []
    let notes = g('notesPlain') || ''
    let type: CoffreItemData['type'] = 'note'
    if (tn.startsWith('passwords.Password')) {
      type = 'login'
      fields.push(f('text', 'Identifiant', g('username')))
      fields.push(f('secret', 'Mot de passe', g('password')))
      for (const u of urls) fields.push(f('link', 'Site web', u))
      const totp = (contents.fields || []).find((x: any) => /totp/i.test(x.id || x.designation || ''))?.value
      if (totp) fields.push(f('totp', 'TOTP', totp))
    } else if (tn.startsWith('wallet.financial.CreditCard')) {
      type = 'card'
      fields.push(f('text', 'Banque / Réseau', g('ccType')))
      fields.push(f('text', 'Titulaire', g('cardholder')))
      fields.push(f('secret', 'Numéro', g('ccnum')))
      fields.push(f('month', 'Expire', g('expiry')))
      fields.push(f('secret', 'CVV', g('cvv')))
      fields.push(f('secret', 'Code PIN', g('pin')))
    } else if (tn.startsWith('identities.Identity')) {
      type = 'identity'
      fields.push(f('text', 'Prénom', g('firstname')))
      fields.push(f('text', 'Nom', g('lastname')))
      fields.push(f('date', 'Date de naissance', g('birthdate')))
      if (g('address')) fields.push(f('multiline', 'Adresse', g('address')))
    } else if (tn.startsWith('securenotes.SecureNote')) {
      type = 'note'
    } else if (tn.startsWith('wallet.computer.License') || tn.startsWith('wallet.membership.Membership')) {
      type = 'license'
      fields.push(f('secret', 'Clé de licence', g('reg_code')))
    } else {
      // type inconnu → note avec champs
      for (const [k, v] of Object.entries(contents)) {
        if (typeof v === 'string' && v && k !== 'notesPlain') fields.push(f('text', k, v))
      }
    }
    if (r.url && !fields.some(x => x.v === r.url)) fields.push(f('link', 'Site web', r.url))
    out.push(mk(type, r.title || '(sans nom)', fields, {
      folder: folders.get(r.folderUuid || '') || '',
      favorite: r.fave === '1',
      notes,
    }))
  }
  return out
}

// ================= 5. format kervia (round-trip) =================

export const KERVIA_FORMAT = 'kervia-coffre'

export function itemsToKervia(items: (CoffreItemData & { id?: string; created_at?: string; updated_at?: string })[]): string {
  return JSON.stringify({
    format: KERVIA_FORMAT,
    version: 2,
    exported_at: new Date().toISOString(),
    items: items.map(i => ({ ...i })),
  }, null, 2)
}

export function kerviaToItems(json: any): CoffreItemData[] {
  if (!json || json.format !== KERVIA_FORMAT || !Array.isArray(json.items)) throw new Error('not_kervia')
  return json.items.map((i: any) => normalizeItem(i))
}

// ================= 6. détection automatique =================

export interface DetectedImport {
  format: 'bitwarden' | 'csv' | '1pux' | '1pif' | 'kervia'
  items: CoffreItemData[]
  skippedEncrypted?: boolean
}

// detectAndParse : lit le fichier (Uint8Array + nom) et choisit le
// parseur. Aucune donnée ne quitte le navigateur.
export async function detectAndParse(bytes: Uint8Array, filename = ''): Promise<DetectedImport> {
  const head = bytes.subarray(0, 4)
  const isZip = head[0] === 0x50 && head[1] === 0x4b // PK
  if (isZip || /\.1pux$/i.test(filename)) {
    return { format: '1pux', items: await onepuxToItems(bytes) }
  }
  const text = new TextDecoder().decode(bytes.subarray(0, 8 << 20))
  const t = text.trimStart()
  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      const json = JSON.parse(t)
      if (json?.format === KERVIA_FORMAT) return { format: 'kervia', items: kerviaToItems(json) }
      // export.data brut (1PUX dézippé à la main) ?
      if (json?.accounts?.some?.((a: any) => a?.vaults)) {
        return { format: '1pux', items: puxJsonToItems(json) }
      }
      if (json?.items !== undefined || json?.folders !== undefined) {
        const { items, skippedEncrypted } = bitwardenToItems(json)
        return { format: 'bitwarden', items, skippedEncrypted }
      }
    } catch {
      // JSON invalide → tenter CSV (certaines webuis exportent du
      // « json » cassé) puis abandonner
    }
  }
  if (text.includes(PIF_SEP)) return { format: '1pif', items: onepifToItems(text) }
  const items = csvToItems(text)
  if (items.length > 0) return { format: 'csv', items }
  throw new Error('format_not_recognized')
}