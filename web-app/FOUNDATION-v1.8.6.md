# Fondation v1.8.6 — contrat pour les refactors de pages

> **RÈGLE ABSOLUE** : ne modifie QUE les fichiers qui te sont assignés. Ne touche NI
> `translations.ts`, NI `lib/*`, NI `components/ui/*`, NI les pages des autres.
> Toutes les traductions nécessaires EXISTENT déjà (liste ci-dessous). Zéro texte
> FR/EN codé en dur (sauf le pattern exceptionnel explicitement autorisé).
> À la fin : `cd /opt/kervia-vault/web-app && npx tsc --noEmit` doit être SANS erreur
> sur tes fichiers (les erreurs d'autres fichiers sont en cours de correction par
> d'autres agents — ignore-les) et `npx vite build` doit passer.

## 1. Erreurs — NOUVEAU contrat (le point noir de l'audit : H9 = 3/10)

```tsx
import { api, friendly, ApiError } from '@/lib/api'

try {
  await api('POST', '/admin/...', body)
  toast.success(t.xxx)
} catch (e) {
  toast.error(friendly(e))   // message localisé + actionnable — JAMAIS "HTTP 500"
}
```

- `friendly(e)` traduit statuts (401/403/404/409/429/5xx/réseau) et codes métier
  (`vault_not_empty`, `not_revoked`, `wrong_password`…). Plus de switch par page.
- Session expirée : gérée GLOBALEMENT par `api()` (toast + retour login) — tu n'as
  rien à faire, mais ne laisse plus de `.catch(() => {})` silencieux.
- **Un état d'erreur n'est JAMAIS déguisé en état vide** : si un load échoue →
  bannière `Alert tone="danger"` + bouton `t.retry`. Vide ≠ erreur.
- Spinner réservé aux boutons ; chargement de page → `<Loading label={t.loading} />`
  (ou `<StatsSkeleton />` pour des stats).

## 2. Presse-papiers — NOUVEAU helper

```tsx
import { copyText } from '@/lib/clipboard'
const ok = await copyText(value)
if (ok) toast.success(t.copied) else toast.error(t.copyFailed)
```

Plus JAMAIS `navigator.clipboard.writeText` direct (muet en HTTP = clé API perdue).

## 3. Composants ui/ — TOUS ré-exportés de `@/components/ui`

| Composant | Usage |
|---|---|
| `Field label help error required` | label ASSOCIÉ (htmlFor auto), aide + erreur liées (aria-describedby/aria-invalid) |
| `PasswordInput` | champ secret avec œil (clavier OK, localisé) |
| `Textarea`, `Select` | mêmes focus/surface que Input — remplace toute textarea/select maison |
| `Button size="lg"` | gros CTA wizard/login ; `variant="link"` pour les liens texte |
| `ConfirmDialog open onOpenChange title message confirmLabel onConfirm busy requireText tone` | LE rituel de confirmation (focus Annuler, conséquence écrite, type-to-confirm si requireText) |
| `SegmentedControl options=[{value,label}] value onChange ariaLabel size` | tout choix exclusif par « chips » — remplace TOUTE chip maison (actif = bg-accent/12 + border-accent-fg/30 + text-accent-fg + aria-pressed) |
| `Table > thead > Th/SortTh > Td` | tout tableau : `overflow-x-auto` inclus, `scope="col"` inclus, `aria-sort` via SortTh |
| `Alert tone="info|warn|danger|success"` | callout unifié (icône incluse) |
| `Loading rows label` / `StatsSkeleton` | chargement de page |
| `SearchInput value onChange placeholder autoFocus` | recherche avec label accessible + bouton clear |
| `CodeReveal value masked` | bloc mono valeur sensible : masqué + œil + copie fiable |
| `EmptyState icon title hint action` | tout état vide guidé |
| `Tip label` + `TooltipProvider` (déjà monté dans app) | tooltip accessible (remplace title=) |
| `PageHeader title sub actions` | en-tête de page (h1) — actions en flex-wrap |
| `Badge` | ok/accent corrigés en thème clair |
| `QRCode data` | SVG QR (uqr) |
| `fmtDate / fmtDateTime` | dates localisées automatiquement — remplace TOUT toLocaleString/localDateString |

## 4. Clés i18n NOUVELLES (fr+en, déjà écrites)

`close, copy, copyFailed, download, back, loading, skipToContent, retry, name,
source, ip, webui, vault, type, version, updated, agentsAllowed, newSecretIn(v),
freeValuePh, valueRequired, verbDeleted, verbMoved, resultsFor(n,q), revealFailed,
searchFailed, loadFailed, fieldKeepNote, dirtyTitle, dirtyMsg, discard, show,
errUnauthorized, errForbidden, errNotFound, errConflict, errRateLimited, errServer,
errNetwork, errNotRevoked, codesSaved, wizardDontClose, skipStep, loginServerErr,
loginRateLimited, totpOptional, capsLock, passwordTitle, changePasswordBtn,
kitConfirmBtn, kitDownloaded, kitInvalidate, updateConfirm, faScan, prev, next,
pageInfo(p,total), exportCsv, grantRemoveTitle, grantRemoveConfirm(a,v),
grantsNoAgents, grantsNoVaults, shareActiveTitle, shareNone, shareRevoke,
shareRevoked, shareExpiresAt, cofTagsHelp, cofOtpPh, cofExportCsv, cofNoName,
cofPurgeItemConfirm(n), cofImportProgress(done,total), cofUriBlocked,
searchLabel, clearSearch, selectRow(k), actions, typeToConfirm(s)`

**Chaînes modifiées (attention)** : `deleteConfirm(k)` mentionne l'irréversibilité ;
`vaultDeleteConfirm(n)` explique la précondition ; `purge` = « Purger/Purge » ;
`cofTrashEmptied(n)`, `cofImportCount(n)`, `cofImportDone(n)`, `cofShowMore(n)` sont
maintenant des FONCTIONS ; `extIntro/extStep1-3/extShownOnce/extCreated` vouvoient.

## 5. Règles a11y non négociables

1. Toute icône décorative : `aria-hidden="true"`. Tout bouton icône-seule :
   `aria-label` (+ `<Tip>` si une rangée d'actions est dense).
2. Tout toggle/chip d'état : `aria-pressed` (SegmentedControl le fait).
3. Pas de `outline-none` sans remplacement ; les composants ui gèrent le focus.
4. Texte utile jamais < 11px ; utiliser `text-2xs` (11px) pour les micro-libellés.
5. `<span onClick>` interdit — tout cliquable est un `<button>`.
6. En français, l'espace avant `:` `?` `!` est insécable : écrire `\u00A0` dans le
   JSX dur le cas échéant (les clés i18n l'ont déjà).
7. Pattern exceptionnel autorisé : table de correspondance bilingue locale
   (`const L = { fr: {...}, en: {...} }[lang]`) pour les libellés techniques
   (codes d'audit, actions serveur) sans clé i18n.
