# Coffre v1.9.0 — contrat de coordination (nov. 2026)

> **Scope validé : manques n° 1 à 9.** Le coffre personnel devient un vrai
> gestionnaire de mots de passe : santé, sauvegarde chiffrée, tri, doublons,
> pièces jointes, rétention corbeille, badges de force, HIBP, raccourcis.
> Zero-knowledge INTACT : tout le chiffrement reste côté navigateur, le
> serveur ne voit que des blobs opaques.

## Règles communes

- Clés i18n : **TOUTES existent déjà** (505 clés, garde check-i18n verte) —
  zéro texte FR/EN codé en dur. Les fonctions : `t.cofHealthOldHint(180)`,
  `t.cofHealthItems(n)`, `t.cofDupDetected(n)`, `t.cofDupImported(k, s)`,
  `t.cofHibpCompromised(n)`, `t.cofAttachTooBig(2)`, `t.cofAttachTooMany(5)`.
- Tu ne modifies QUE tes fichiers. Style : commentaires FR « pourquoi »,
  vanilla, composants `@/components/ui` (Alert, SegmentedControl, Loading,
  ConfirmDialog, EmptyState, Button…), toasts sonner + `friendly()`.
- Vérif finale : `cd /opt/kervia-vault/web-app && npx tsc --noEmit` (tes
  fichiers propres) + `npx vite build`. Affiche les sorties.

## Répartition des fichiers

| Agent | Fichiers (les SEULS) |
|---|---|
| 1 — Santé & liste | `src/lib/coffre-health.ts` (NOUVEAU), `src/pages/coffre.tsx`, `src/components/coffre/parts.tsx` |
| 2 — Scellé & doublons | `src/lib/coffre-seal.ts` (NOUVEAU), `src/lib/coffre-import.ts`, `src/components/coffre/dialogs.tsx` |
| 3 — Pièces jointes | `src/lib/coffre-attachments.ts` (NOUVEAU), `src/components/coffre/ItemDialog.tsx` |
| Backend (moi) | `internal/{model,store,api}` — endpoints ci-dessous, en place AVANT l'intégration |

## 1. Santé du coffre (agent 1) — règles EXACTES

`lib/coffre-health.ts` — pur, testable :

```ts
export interface HealthReport {
  score: number                     // 0-100
  weak: { idx: number; bits: number }[]        // items triés par bits croissant
  reused: { count: number; idxs: number[] }[]  // groupes, count desc
  old: { idx: number; days: number }[]         // jours desc
  checkedCount: number              // items avec mot de passe principal
}
export function computeHealth(items: any[], opts?: { oldDays?: number }): HealthReport
export async function checkHibp(items: any[], onProgress?: (done: number, total: number) => void): Promise<Map<string, number>>
// clé de la Map = le mot de passe (jamais persisté), valeur = count HIBP (>0 = compromis)
```

- **Périmètre** : items non supprimés AVEC mot de passe principal
  (`C.mainSecret` de coffre-lib… en webui : `mainSecret(it)` de
  `lib/coffre-schema.ts`). Les autres types (notes, cartes…) sont exclus du
  scoring mais présents dans la liste générale.
- **faible** : `passwordStrength(pw).bits < 50` (labels weak/fair de
  `lib/coffre.ts`).
- **réutilisé** : mot de passe strictement identique sur ≥ 2 items → un
  groupe par mot de passe.
- **ancien** : `password_updated_at` (fallback `updated_at`) plus vieux que
  `opts.oldDays` (défaut **180**).
- **score** : `100 − (weak×4 + groupes_reused×6 + old×2)`, min 0, arrondi.
  (HIBP n'entre pas dans le score : c'est un état externe, pas une propriété
  du coffre — il s'affiche en section séparée.)
- **HIBP (opt-in)** : localStorage `kerviavault-hibp` = `'on'`/`'off'`
  (défaut off). Si on : bouton « Vérifier maintenant » → pour chaque mot de
  passe UNIQUE (Map par valeur, max 300 requêtes/run, concurrence 6) :
  `SHA-1(pw)` hex majuscule → préfixe 5 → `GET https://api.pwnedpasswords.com/range/{prefix}`
  → cherche le suffixe (35 chars restants) dans la réponse `SUFFIX:count`.
  RÉSULTATS JAMAIS PERSISTÉS (re-run à chaque session). Erreur réseau →
  `cofHibpError`, résultat partiel OK. `role="status"` sur la progression.

### UI santé (pages/coffre.tsx)
- Vue « Santé » : le SegmentedControl de vues gagne `health`
  (Tous / Favoris / **Santé** / Corbeille, icône lucide `HeartPulse`).
- En-tête : score en gros (chiffre + libellé), phrase `cofHealthOk` si
  score 100 sans rien à signaler.
- 3 sections + HIBP : `Alert`/cartes avec titre, hint, `t.cofHealthItems(n)`,
  liste des items (nom + sous-titre) cliquables → ouvre l'ItemDialog
  (`setDialog({kind:'item', item})`). Réutilisés : groupes avec `count`.
- HIBP : carte opt-in (toggle `cofHibpOptIn` + `cofHibpPrivacy` + bouton
  `cofHibpCheck` + résultat `cofHibpCompromised(n)` / `cofHibpClean`).
  Items compromis listés comme les autres sections.
- **Tri de la liste** : petit `SegmentedControl` (nom → `t.name`, modifiés →
  `t.cofSortUpdated`, force → `t.cofSortStrength`) ; `aria-label
  t.cofSortLabel`. name = alpha insensible à la casse, modifiés =
  updated_at desc (tri déjà naturel du serveur), force = bits du mot de
  passe principal desc (items sans mot de passe en fin).
- **Badge de force** dans les rangées (parts.tsx) : `StrengthBadge({ bits,
  label })` — pastille 8px colorée (weak danger / fair warn / good+ accent)
  + `title`/aria-label `t.cofStrengthAria` avec libellé+bits, visible si
  l'item a un mot de passe principal. Utilisé dans coffre.tsx (rangées)
  et ItemDialog (jauge : réutilise `<Strength pw={...}>` existant sous le
  champ mot de passe principal — ItemDialog est à l'agent 3 : PAS TOI).
- **Compteur par dossier** dans le Select dossiers : « Dossier (N) »
  (nombre, pas d'i18n nécessaire).
- **Rétention corbeille** : dans la vue Corbeille, une ligne
  `Alert tone="info"` `t.cofTrashRetention` (le sweep serveur existe déjà —
  backend de mon côté, pars sur le texte seul).
- **Raccourcis clavier** : keydown global quand la page coffre est montée :
  `n` → nouvel item (le flow « Nouveau » existant), `/` → focus recherche,
  en ignorant les frappes dans input/textarea/select (sauf Échap). Hint
  `t.cofShortcutsHint` dans l'état vide de la liste. `aria-keyshortcuts`.

## 2. Sauvegarde chiffrée KVCS1 (agent 2) — format EXACT

`lib/coffre-seal.ts` — pur (WebCrypto), pattern crypto de `lib/coffre.ts`
(PBKDF2-SHA-256 → AES-GCM, nonce 12 || ct, base64) :

```ts
export const KVCS1 = 'kvcs1'
export async function sealVault(passphrase: string, payload: object): Promise<string>  // → contenu fichier .kvc (JSON text)
export async function unsealVault(passphrase: string, fileText: string): Promise<{ items: any[]; exported_at: string }>
export function isSealedBackup(text: string): boolean   // JSON.parse → .format === 'kvcs1'
```

Fichier `.kvc` (JSON UTF-8) :
```json
{ "format": "kvcs1",
  "kdf": { "algo": "PBKDF2-SHA256", "iterations": 600000, "salt_b64": "<16 octets+>" },
  "blob_b64": "<base64(nonce(12) || AES-256-GCM-ct)>" }
```
Contenu scellé (avant chiffrement) : `{"v":1,"exported_at":"<RFC3339>","items":[…]}` où
chaque item = l'objet v2 complet (mêmes champs que le blob d'item, SANS id) PLUS
`"attachments": [{ "filename": string, "mime": string, "data_b64": string } | null]`
(`null` si pas de pièces jointes — voir contrat agent 3).

- **Export** (dialogs.tsx) : nouvelle carte « `t.cofSealExport` » dans le
  dialog d'export existant : intro `cofSealIntro`, warning `Alert warn`
  `cofSealWarning`, champs passphrase `cofSealPass` + `cofSealPass2`
  (PasswordInput, mismatch → `t.backupMismatch` via Field error), bouton
  `cofSealBtn` (désactivé si < 12 chars ou mismatch) → seal → download
  `kervia-coffre-YYYYMMDD.kvc` → toast `cofSealDone`. Les items sont les
  objets déchiffrés en mémoire + leurs pièces jointes DECHIFFRÉES via la
  lib de l'agent 3 (contrat ci-dessous). Les formats plaintext existants
  (Kervia/Bitwarden/CSV) restent — la sauvegarde chiffrée s'ajoute.
- **Import** (lib/coffre-import.ts + dialogs.tsx) : détection
  `isSealedBackup` → le dialog d'import affiche un champ
  `t.cofSealImportPass` (PasswordInput) + badge `cofSealImportOk` →
  `unsealVault` → items (échec → `cofSealImportBad`) → suite du pipeline
  normal (compteurs, dedupe, import par batch) + upload des pièces jointes
  via la lib agent 3.

## 3. Doublons à l'import (agent 2) — règle EXACTE

`lib/coffre-import.ts` : après parsing (n'importe quel format), pour chaque
item importé, un doublon = même `type` + même `name` (trim, insensible
casse) + même `firstUsername` + même host du `firstLink` (host vide ==
vide). API :
```ts
export function findDuplicates(items: any[], existing: any[]): { dup: number[]; fresh: number[] }
```
UI (dialogs.tsx) : si `dup.length > 0` → bannière `cofDupDetected(n)` +
`cofDupHint` + `SegmentedControl` choix : `t.cofDupSkip` (défaut) /
`t.cofDupAll`. Import final → toast `t.cofDupImported(kept, skipped)` ou
`t.cofImportDone(n)` si aucun doublon.

## 4. Pièces jointes (agent 3) — API backend DÉJÀ SPÉCIFIÉE (implémentée en parallèle)

`lib/coffre-attachments.ts` — chiffrement avec la MÊME coffreKey que les
items (importKey AES-GCM déjà en mémoire dans coffre.ts — passe la clé en
paramètre, jamais stockée) :

```ts
export const ATTACH_MAX_RAW = 2 * 1024 * 1024   // 2 Mo
export const ATTACH_MAX_PER_ITEM = 5
export async function attachAdd(key: CryptoKey, itemId: string, file: File): Promise<{ id: string }>
export async function attachList(itemId: string): Promise<AttachmentMeta[]>  // {id, meta_b64, size, created_at}
export async function attachDecryptMeta(key: CryptoKey, meta_b64: string): Promise<{ filename: string; mime: string; size: number }>
export async function attachDownload(key: CryptoKey, att: AttachmentMeta): Promise<{ filename: string; mime: string; data: ArrayBuffer }>
export async function attachRemove(attId: string): Promise<void>
// pour l'agent 2 (export/import KVCS1) :
export async function attachExportBundle(key: CryptoKey, itemId: string): Promise<{ filename: string; mime: string; data_b64: string }[]>
export async function attachImportBundle(key: CryptoKey, itemId: string, files: { filename: string; mime: string; data_b64: string }[]): Promise<number>
```

Scellement : `meta` = AES-GCM de `{"filename","mime","size"}` (petit),
`data` = AES-GCM du contenu binaire. DEUX blobs distincts (le meta se
déchiffre seul pour l'affichage — pas le contenu).

Endpoints backend (MOI — intégrés avant ton build final) :
- `POST /admin/coffre/items/{id}/attachments` body `{"meta_b64","data_b64"}`
  → 201 `{"id"}` — limites : data décodée ≤ 2 Mo, ≤ 5 par item, body ≤ 12 Mo
- `GET /admin/coffre/items/{id}/attachments` → `[{"id","meta_b64","size","created_at"}]`
- `GET /admin/coffre/attachments/{aid}` → `{"meta_b64","data_b64"}`
- `DELETE /admin/coffre/attachments/{aid}` → `{"deleted":true}`
Erreurs : `attach_too_big`, `attach_too_many`, `attach_not_found` → mappe
en toasts via `friendly()` + cas locaux (`t.cofAttachTooBig(2)`,
`t.cofAttachTooMany(5)`).

### UI (ItemDialog.tsx)
- Section « `t.cofAttach` » en bas du dialog (vue ET édition) : liste
  (nom, taille lisible `kB/Mo`, boutons t.download + `t.cofAttachRemove`
  avec ConfirmDialog léger), bouton `t.cofAttachAdd` (input file caché +
  label — cap 2 Mo vérifié côté client AVANT l'upload), état vide
  `t.cofAttachEmpty`, erreurs → toasts, loading pendant upload.
- Download : déchiffre → `URL.createObjectURL(new Blob([data], {type: mime}))`
  → `<a download={filename}>` click programmatique.
- **Bonus scope n°7** : sous le champ mot de passe principal (celui marqué
  `pw: true` dans le schéma), affiche la jauge `<Strength pw={valeur}>`
  existante (parts.tsx) en édition — seulement si le champ est non vide.

## 5. Rétention corbeille + backend (MOI, en parallèle)

Sweep serveur : items en corbeille > 30 jours purgés à chaque listing
(`CoffreListItems`) — le texte `t.cofTrashRetention` (agent 1) l'annonce.
