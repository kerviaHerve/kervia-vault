# Extension Firefox v1.8.7 — contrat de coordination (nov. 2026)

> **Contexte** : l'extension est jugée faible en UX et en fonction (remplissage
> défaillant, pas de pré-remplissage). Overhaul complet. Charte SACRÉE :
> **le script de contenu n'injecte JAMAIS d'interface dans les pages** (ni
> icône dans les champs, ni bulle, ni overlay) — c'est le contrat produit
> (README + manifest). Toutes les améliorations respectent cette règle :
> badge d'icône, auto-fill silencieux, menus contextuels, popup.

## Contraintes techniques (NON NÉGOCIABLES)

- **Manifest V2** (Firefox + AMO), `strict_min_version` 115. Pas de migration MV3.
- **Vanilla JS ES2020**, aucun bundler, aucune dépendance. `browser.*` (pas `chrome.*`).
- Vérification minimale : `node --check <fichier.js>` passe sur chaque fichier.
- Zéro stockage disque de secrets : la clé et les items restent en mémoire du
  background (zero-knowledge). `storage.local` ne contient QUE la config.
- Ne modifie QUE tes fichiers assignés (liste par agent). Les contracts ci-dessous
  font foi — ne casse pas une API qu'un autre agent consomme.

## Clés storage.local (contrat partagé)

| Clé | Type | Défaut | Sens |
|---|---|---|---|
| `serverUrl` | string | `https://vault.kervia.ch` | serveur (existant) |
| `extToken` | string | '' | token Bearer (existant) |
| `autoLockMin` | number | 5 | 0 = jamais (existant) |
| `autoFill` | string | `'off'` | **NOUVEAU** : `'off'` \| `'fill'` — auto-remplissage à l'ouverture de la page |
| `lastUsed` | object | `{}` | **NOUVEAU** : `{ [itemId]: epochMs }` — usage des éléments (max ~100 entrées), pour les « Récents » du popup |

## API de messages (contrat partagé background ↔ popup/options)

Existant (inchangé) : `unlock{password}`, `lock`, `state`, `syncNow`,
`itemsFor{url}`, `search{q}`, `secrets{idx}`, `fill{idx}`.

**Nouveau** :
- `{cmd:'copy', kind:'username'|'password', idx}` → le background lit les
  secrets, copie au presse-papiers, **programme l'effacement 30 s dans SON
  contexte persistant** (le popup meurt en se fermant — son timer ne
  survivait pas : c'est le bug à corriger), retourne `{ok:true}`.
- `{cmd:'copy-totp', idx}` → calcule le code TOTP courant, copie, efface à 30 s
  (le code est de toute façon éphémère), retourne `{ok, code?}`.
- `{cmd:'copy-text', text}` → texte libre (générateur du popup) : même
  effacement 30 s — un mot de passe fraîchement généré ne traîne pas non
  plus au presse-papiers. Le popup garde un repli local (sans effacement)
  si le background déployé ne connaît pas la cmd.
- `{cmd:'fill-totp', idx}` → background → content script : colle le code
  TOTP courant dans le champ 2FA de la page. Retourne `{filled}` ou
  `{error:'no_2fa_field'}`.
- `state` retourne EN PLUS : `autoFill`, `lastSyncAt` (epoch), `count`.
- `itemsFor`/`search` retournent des lignes ENRICHIES :
  `{idx, id, name, subtitle, username, hasTotp, uri, favorite, lastUsedAt}`
  (`favorite` bool, `lastUsedAt` epoch ou 0). **Jamais de secrets** dans ces
  listes — le popup les demande à la demande.
- `secrets{idx}` inchangé (le popup ne l'appelle QUE pour le TOTP vivant des
  correspondances de page, ≤ 8 éléments).

## Protocole content script (contrat A ↔ B)

- `{cmd:'fill', username?, password?, onlyIfEmpty?}` → **pattern « responder-only »** :
  le frame qui TROUVE des champs répond `{filled:{username,password}}` ; les
  frames sans champs pertinents répondent **`undefined`** (pas de réponse).
  Raison : `all_frames: true` + `tabs.sendMessage` sans frameId → toutes les
  frames reçoivent ; la première réponse non-undefined gagne. Répondre
  `{hasForm:false}` depuis chaque frame casserait le fill d'iframe (course).
- `{cmd:'fill-totp', code}` → même pattern.
- `{cmd:'probe'}` → répond UNIQUEMENT si champs de login détectés :
  `{userFieldType, pwFieldType}` (types pour le debug/badge).
- `onlyIfEmpty` : l'auto-fill ne remplace JAMAIS une valeur déjà saisie
  (champs non vides ignorés). Le fill manuel (popup/raccourci) écrase.

## L10N (contrat C + D)

`const L = (navigator.language || '').toLowerCase().startsWith('en') ? EN : FR`
— petit dict local par page (~30-40 chaînes), pas de système complet.
Les libellés serveur de référence : ceux de la webui
(`web-app/src/i18n/translations.ts`, chercher `ext*`, `cof*`).

## Charte visuelle

Tokens dark de la webui (`popup.css` les redéfinit localement — c'est assumé,
documenté README). Accent citron `#B8E263`, texte sur accent `#171B19`,
focus menthe `#7FD4B8`. Badge d'icône : fond `#B8E263`, texte `#171B19`.
Icons lucide via `js/lucide.js` (déjà chargé).
