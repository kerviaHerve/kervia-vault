# Audit UX & accessibilité — WebUI kervia-vault (nov. 2026)

**Périmètre** : `web-app/src/` — 10 pages, ~4 700 lignes (login, wizard, dashboard, vaults, secrets, coffre, grants, agents, audit, settings) + composants ui/, coffre/, TemplatePicker, i18n (381 clés × 2 langues), extension Firefox.

**Méthode** : 4 audits spécialisés menés en parallèle (accessibilité WCAG 2.2 AA, ergonomie Nielsen + security UX, design system, UX writing/i18n), croisés avec les référentiels 2025-2026 (WCAG 2.2, APCA, NN/g, typographie française, security UX des coffres). Les 8 constats les plus graves ont été **re-vérifiés indépendamment dans le code**.

---

## Verdict global

Les **fondations sont solides** : tokens sémantiques uniques avec 2 thèmes par rôles, reduced-motion géré à 3 niveaux (CSS + `MotionConfig` + `prefers-contrast/transparency` — rare et excellent), Radix Dialog correctement employé (focus piégé, retour de focus), toaster accessible (`aria-live`), cibles tactiles ≥ 24px, et des **patterns de security UX conceptuels remarquablement mûrs** : type-to-confirm (DESTROY/EXPORT), dry-run de restauration DR, corbeille + restauration du coffre, masquage par défaut, re-auth pour désactiver la 2FA, one-time reveals.

Mais **six familles systémiques de défauts** et **8 bugs vérifiés** dégradent l'expérience :

1. **La gestion des échecs** (heuristique Nielsen n°9 : 3/10) — erreurs API brutes, échecs déguisés en états vides, aucune gestion de session expirée, clipboard silencieusement cassé en HTTP.
2. **L'accessibilité systémique** — labels non associés, boutons icône sans nom, états portés par la couleur seule, focus invisible sur les champs.
3. **L'i18n massivement contournée** — ~36 zones de texte FR en dur en mode EN, dates verrouillées `fr-FR`, `lang` jamais mis à jour.
4. **Les rituels destructeurs hétérogènes** — 3 patterns de confirmation cohabitent ; certaines actions graves se déclenchent en un clic, d'autres banales demandent un confirm natif hors charte.
5. **La dérive du design system** — 12 segmented controls réécrits avec 4 sémantiques d'état actif, 67 tailles de texte arbitraires, 0 skeleton, 0 stratégie responsive.
6. **Les moments critiques security UX** — codes de récupération non protégés, mot de passe de récupération sans confirmation, secrets free-form affichés en clair, audit plafonné à 100 lignes.

---

## 1. Bugs vérifiés — P0 absolu

| # | Bug | Localisation | Preuve |
|---|-----|--------------|--------|
| 1 | **Bouton « undefined »** — le bouton Fermer du SecretDialog affiche littéralement `undefined` (clé `close` manquante dans translations.ts ; seule `cofClose` existe) | `secrets.tsx:196` | vérifié |
| 2 | **Navigation du dashboard cassée** — les stat-cards routent sur le libellé traduit : « Activité récente » → `#activité`, « Active agents » → `#active` : 4 cartes cassées selon la langue | `dashboard.tsx:51` | vérifié |
| 3 | **Bouton copie invisible** dans SecretDialog — `opacity-0 group-hover:opacity-100` sans ancêtre `group` : jamais visible (et focus invisible au clavier) | `secrets.tsx:139` | vérifié |
| 4 | **`text-accent` illisible en thème clair** — l'accent citron `#B8E263` n'est pas redéfini en light : **1,37:1** sur `#F4F6F2` (exigé : 4,5:1). 62 usages : nav active, badges, chips actives, tri, TOTP, codes de récupération… | `index.css:59` | vérifié (calcul) |
| 5 | **Aucune gestion de session expirée** — `api()` jette `HTTP 401` en brut, 0 occurrence de « 401 » dans src/ ; `dashboard` → page blanche à vie, `secrets` → « Aucun vault » mensonger, `coffre` → écran « Créer votre coffre » trompeur | `api.ts:12` + 6 pages | vérifié |
| 6 | **Clipboard sans fallback** — 12 usages `navigator.clipboard` : en HTTP (déploiement LAN/VPN prévu par le produit), le bouton ne fait rien, sans feedback ; pire cas : clé API affichée une seule fois + toast de faux succès | `secrets/agents/settings/coffre/parts/dialogs` | vérifié |
| 7 | **Codes de récupération perdus pour toujours** — à l'étape 3 du wizard, un refresh/fermeture d'onglet détruit les codes (affichés une seule fois, aucun `beforeunload`, aucune case « j'ai sauvegardé ») | `wizard.tsx:305-370` | vérifié (grep : 0 beforeunload) |
| 8 | **Récupération de mot de passe sans confirmation** — un seul champ, garde `length ≥ 12` : une faute de frappe = mot de passe inconnu + code à usage unique brûlé → lockout total si dernier code | `login.tsx:126-136` | vérifié |

---

## 2. Familles systémiques — constats détaillés

### F1 — Gestion des échecs (Nielsen H9 : 3/10)

- **[CRITIQUE]** `api.ts:12` remonte `data.message \|\| data.error \|\| HTTP ${status}` : les codes métier (`vault_not_empty`, `not_revoked`) et les « HTTP 500 » arrivent tels quels dans les toasts ; 3-4 codes traduits à la main par page, le reste fuit.
- **[CRITIQUE]** Échec déguisé en état vide : reveal d'un secret → affiché « vide » (`secrets.tsx:77` : `.catch(() => setData({value:''})` — l'utilisateur peut ressaisir une valeur et écraser le secret) ; recherche → « Aucun résultat » (`secrets.tsx:316`) ; boot coffre → écran de setup (`coffre.tsx:59`).
- **[MAJEUR]** Toute erreur non-OK au login = « Identifiants invalides » (`login.tsx:57`) : un 429/5xx pousse l'utilisateur vers des codes de récupération inutiles.
- **[MAJEUR]** `catch(() => {})` et mutations sans try/catch : `agents.tsx:35` (revoke), `secrets.tsx:245` (del), `grants.tsx:24` (cycle), `dashboard.tsx:23` — échecs silencieux.
- **[MAJEUR]** Erreurs 2FA ambiguës (`settings.tsx:121,132`) : un serveur down se lit « Code invalide ».

### F2 — Accessibilité (WCAG 2.2 AA : 5 bloquants, 39 majeurs, 54 mineurs)

- **[BLOQUANT]** `Field` n'associe pas le label à l'input (`input.tsx:46-53` : pas de `htmlFor`/`id`) — **~40 champs anonymes** pour les lecteurs d'écran. Fix : `useId` + cloneElement.
- **[BLOQUANT]** Checkbox de sélection par ligne sans nom accessible (`secrets.tsx:471-476`).
- **[BLOQUANT]** Révélation de champ sensible par `<span onClick>` — souris uniquement (`secrets.tsx:160-164`).
- **[BLOQUANT]** Modale de remise de clé API **non-Radix** (`agents.tsx:115-157`) : pas de `role="dialog"`, focus non piégé, pas d'Escape — un utilisateur AT ne peut pas récupérer sa clé de façon fiable.
- **[BLOQUANT]** `text-accent` en light (bug #4).
- **[MAJEUR]** Boutons icône sans nom accessible : close de **chaque** dialog (`ui/dialog.tsx:37`), clears, copies, poubelle de grant (`vaults.tsx:232`), œil du coffre (`coffre.tsx:302`) — lucide-react n'ajoute pas `aria-hidden` par défaut (vérifié dans node_modules).
- **[MAJEUR]** `PasswordInput` : l'œil a `tabIndex={-1}` (inatteignable au clavier, `input.tsx:36`) + `aria-label` FR en dur (`:37`).
- **[MAJEUR]** État par couleur seule, sans `aria-pressed` : ~12 segmented controls (filtres audit, tabs vaults, accès vault, TTL, langue, générateur, export, auto-lock, LangSwitch) — WCAG 1.4.1.
- **[MAJEUR]** Nav active sans `aria-current` (`app.tsx:186`) ; pas de skip-link (2.4.1) ; pas de `<h1>` login/wizard/settings (les 7 cartes de settings n'ont aucun titre — `CardTitle` existe mais jamais utilisé) ; tableaux sans `scope` ni `aria-sort` (dashboard : pas de `thead` du tout).
- **[MAJEUR]** Focus invisible sur les champs : `outline-none focus:ring-accent/20` ≈ 2:1 (`input.tsx:12`), textareas et recherche du picker **sans aucun remplacement** (`ItemDialog.tsx:163,185`, `TemplatePicker.tsx:190`) — 2.4.7.
- **[MAJEUR]** `document.documentElement.lang` jamais mis à jour au changement de langue — 3.1.1 (fix : 1 ligne dans `i18n/index.tsx`).
- **[MAJEUR]** Reflow 320px : tables sans `overflow-x-auto` (dashboard, vaults, agents, secrets ×2), sidebar `w-56` fixe, wizard `w-[480px]` — 1.4.10.
- **[MINEUR]** Bordures de champs à 1,80:1 (dark) / 1,40:1 (light) — 1.4.11 (utiliser `border-2`). Compteurs de résultats sans `role="status"` — 4.1.3. `autocomplete` manquant (`new-password` wizard, `one-time-code` settings, `current-password` unlock coffre) — 1.3.5.

### F3 — i18n contournée (en mode EN, ces pages sont à ~40 % françaises)

- **[MAJEUR]** ~36 zones en dur : en-têtes de tableaux (`agents.tsx:65` — avec le ternaire mort `t.agents ? 'Nom' : ''`, `vaults.tsx:82`, `audit.tsx:46`), sous-titre audit **alors que `t.auditSub` existe déjà** (`audit.tsx:27`), « Sécurité » (`settings.tsx:419`, clé morte), verbes `'supprimés'/'déplacés'` injectés dans `bulkPartial` (EN cassé : « 2/5 supprimés — others failed »), aria-label de l'œil, `TemplatePicker` keyword-stuffing rendu à l'écran (« libre free-form »).
- **[MAJEUR]** Dates verrouillées `fr-FR` (`utils.ts:7,12`, `coffre-schema.ts:310`) ; `toLocaleString()` brut par ailleurs — deux formats de date sur une même page.
- **[MAJEUR]** Fichiers téléchargés générés en FR quelle que soit la langue (codes de récupération `wizard.tsx:167`, kit DR `settings.tsx:250-259`) alors que le pattern `K[lang]` existe déjà 10 lignes plus loin.
- **[MAJEUR]** ErrorBoundary franglais (« Something went wrong… Tes données ne risquent rien ») + tutoiement isolé (`extIntro`, wizard) dans une app qui vouvoie partout.
- **[MAJEUR]** Matching fonctionnel sur libellé traduit : `coffre.tsx:268` cherche `'Identifiant' || 'Utilisateur'` — un item créé en EN perd son bouton copier-identifiant.
- **[MINEUR]** 24 clés mortes dont **8 correspondent exactement** aux endroits contournés (`status`, `lastAccess`, `created`, `copyKey`, `allAgents`, `manageAccess`, `auditSub`, `security`) — la moitié du travail est déjà écrite dans translations.ts.
- **[MINEUR]** Typo FR : 0 NBSP (le « : » peut se retrouver orphelin en fin de ligne), « ex : » → « ex. : », « le lien mourra » → « expirera », « magasin de votre client » (contresens de vault). EN : guillemets « » en EN (8 occurrences), « Memorise » UK isolé, « the link dies ».

### F4 — Rituels destructeurs hétérogènes (même action, 3 protections différentes)

- **[MAJEUR]** 9 `window.confirm()` natifs hors charte (`secrets.tsx:244,277`, `agents.tsx:34,41`, `vaults.tsx:56,205`, `settings.tsx:70,82`, `coffre.tsx:176`).
- **[MAJEUR]** **Aucune** confirmation : purge d'un item de corbeille (`coffre.tsx:172`), cycle de grants RW→none en un clic (`grants.tsx:23-27` — coupe un agent en production), alors que la même action (révoquer) demande un confirm dans `vaults.tsx:205`.
- **[MAJEUR]** `deleteConfirm` d'un secret n'explique ni l'irréversibilité ni la perte d'historique (« Supprimer X ? ») ; `vaultDeleteConfirm` apprend la précondition *après* l'action (parenthèse).
- **[MAJEUR]** Édition : dialogs ferment sur Escape/clic overlay **sans garde dirty** — une saisie longue de secret est détruite silencieusement (`secrets.tsx:111,655`, `ItemDialog.tsx:77`).
- **[MAJEUR]** Modale clé API : clic backdrop = clé perdue (pas de téléchargement, contrairement au wizard qui a le pattern `dl`).

### F5 — Dérive du design system

- **[MAJEUR]** 12 segmented controls réécrits avec **4 sémantiques visuelles d'état actif** différentes et des hauteurs h-7→h-11 (`secrets.tsx:354,590`, `audit.tsx:30`, `vaults.tsx:127-167`, `coffre.tsx:228`, `dialogs.tsx:42,288`, `settings.tsx:486`…).
- **[MAJEUR]** Typographie contournée : **67 `text-[Npx]`** dont du texte utile à 9-10px (tri `secrets.tsx:43`, footer, hints TOTP) — sous le minimum lisible, aggravé en light (fg-3/card-2 = 4,90:1).
- **[MAJEUR]** **0 skeleton** : `return null` au chargement (dashboard, agents, vaults, audit) → flash de layout à chaque navigation ; dashboard compte les secrets en série N+1 avant d'afficher quoi que ce soit.
- **[MAJEUR]** **0 responsive** : 7 classes de breakpoint dans toute l'app ; sidebar `w-56` fixe (≈96px de contenu à 320px), pas de drawer, login `w-[360px]`, wizard `w-[480px]` > viewport 390px.
- **[MOYEN]** 10 tailles d'icônes cohabitent (11→32px) ; glyphes non-lucide (⚠ ▲▼ ✓) dont le tri à 9px ; `text-accent/6→/20` (6 opacités arbitraires) ; densités de lignes non normalisées entre tables ; largeur de contenu non bornée (2560px : tables illisibles) ; Toaster dupliqué 3× ; `keyModal` (agents) = 4e design d'overlay, animé alors que la règle v1.7.2 impose l'immobilité ; keyframes mortes `index.css:107-121`.
- **[MOYEN]** Hover des boutons secondary : `hover:bg-muted` peint le bouton **couleur bordure** en dark ; focus input divergent WebUI vs extension Firefox (citron vs menthe).
- **[MINEUR]** Rôles redondants (`muted` ≡ `border`), Badge `ok` ≡ `accent`, 2 formes de badge, boutons lien stylés à la main 6×, `aria-label` figé FR.

### F6 — Moments critiques security UX

- **[CRITIQUE]** Wizard étape 3-5 : recharger = perdre codes **et** clé API pour toujours (aucun garde).
- **[CRITIQUE]** Recovery sans confirmation (bug #8) ; erreur login générique → consommation inutile de codes.
- **[MAJEUR]** Secrets free-form affichés **en clair** dès l'ouverture du dialog (les templated sont masqués, contradiction avec `secretsSub` « ne s'affichent que sur clic ») — `secrets.tsx:191` ; création en `type="text"` — `:723`.
- **[MAJEUR]** Historique des mots de passe du coffre affiché non masqué (`ItemDialog.tsx:102-117`).
- **[MAJEUR]** Enrôlement TOTP **sans QR code** (seed base32 à recopier) — `settings.tsx:462-481` ; régénération des codes : bouton « OK » ferme sans vérifier le téléchargement, pas de mention de l'invalidation des anciens codes.
- **[MAJEUR]** Audit plafonné à 100 entrées, sans pagination ni filtres — l'outil forensique du produit est inutilisable après un incident.
- **[MAJEUR]** Toast « effacement auto du presse-papiers 30 s » pas toujours vrai (uniquement si `document.hasFocus()`) — mauvaise promesse de sécurité.
- **[MINEUR]** Champs vidés en édition **non envoyés** : l'ancienne valeur est conservée silencieusement (`secrets.tsx:95`) ; liens d'items sans validation de schéma (`javascript:` exécutable via CSV importé) ; `beforeunload` absent du coffre déverrouillé (logout = perte de saisie zero-knowledge).

---

## 3. Plan d'action

### Vague 0 — Hotfixes (≈ 1-2 jours, impact maximal)

1. Clé `close` (bug « undefined ») — 5 min
2. `dashboard.tsx:51` : router sur des ids, pas sur les libellés — 15 min
3. `group` sur le wrapper de champ `secrets.tsx:135` (bouton copie visible) — 5 min
4. `--color-accent-fg` : dark `#19251A` → light `#166D4C`, sweep des 62 `text-accent`
5. Util `copyToClipboard()` avec fallback `execCommand` + toast d'échec (12 sites)
6. Interception 401 globale dans `api()` (toast + retour login) + `errorMap` code → clé i18n (fin des « HTTP 401/500 », « Failed to fetch »)
7. Wizard : `beforeunload` étapes 3-5 + case « J'ai sauvegardé mes codes » + bannière
8. Login recovery : champ de confirmation + désactivation jusqu'à correspondance
9. One-liners a11y : `document.documentElement.lang = lang` ; `tabIndex={-1}` retiré de l'œil + i18n de l'aria-label ; `<span onClick>` → `<button>` ; `aria-label` sur checkboxes ; `aria-current` nav ; `scope="col"` + `aria-sort` ; `aria-label` sur le close des dialogs
10. `beforeunload` + confirm sur purge d'item coffre ; confirmation sur transition grants → none

### Vague 1 — Sprint sécurité UX + a11y (≈ 1-2 semaines)

- **`Field` accessible** : `useId` + `htmlFor` + `aria-describedby` (débloque ~40 champs) + `aria-invalid` sur les erreurs (login, wizard, coffre, settings).
- **`ConfirmDialog` maison** (danger, focus sur Annuler, conséquences affichées, variante type-to-confirm) : remplace les 9 `confirm()`, protège purge item, grants, self-update (« le service va redémarrer »).
- **État d'erreur ≠ état vide** partout : reveal secret, recherche, boot coffre, load des 5 pages (retry + message).
- **Modale clé API sur Radix Dialog** + bouton Télécharger (mutualiser le générateur .txt du wizard) + désactivation du clic backdrop.
- **Masquage par défaut** : free-form secrets (reveal + création), historique mots de passe coffre.
- **Garde dirty** sur les dialogs d'édition (confirm inline « Abandonner les modifications ? »).
- **`aria-pressed` sur les 12 segmented controls** + `aria-hidden` sur les icônes décoratives + noms accessibles sur tous les boutons icône + focus visible (`ring-focus` plein, suppression des `outline-none`).
- **`<TableSkeleton>` + skeletons de pages** ; **`overflow-x-auto`** sur les 4 tables ; **`<main>`/`<h1>`/skip-link** ; **`CardTitle`** sur les 7 cartes settings.
- **Sweep i18n** : 12 tableaux/dialogues en dur (les clés existent déjà pour la moitié), dates par locale active, fichiers téléchargés bilingues, vouvoiement, ErrorBoundary.
- **Distinguer 401/429/5xx** au login et sur la 2FA ; **QR code TOTP** ; **« J'ai téléchargé le kit »** + mention d'invalidation des anciens codes.
- Login : champ TOTP tri-state si `/totp/status` échoue ; autocomplete complet.

### Vague 2 — Chantiers design system (2-3 semaines)

- **Composants** : `SegmentedControl`, `ConfirmDialog`, `Table`/`Th`/`SortTh`, `Alert`, `Skeleton`, `Select`, `SearchInput` (icône+clear), `CodeReveal`, `EmptyState`, `Tooltip` (Radix), `PageHeader`, `Textarea`, `BrandBlock`.
- **Typo** : échelle réelle (`--text-2xs` 11px, bannir 9-10px pour du texte), 3 tailles d'icônes (14/16/32), remplacement ⚠▲▼✓ par lucide.
- **Responsive** : sidebar → drawer < lg, `max-w-6xl` sur le contenu, `flex-wrap` sur les barres d'actions, actions de ligne → kebab sous md, `grid-cols-2 md:grid-cols-4` au dashboard.
- **Audit** : pagination + filtres action/agent/statut + export CSV.
- **Partage** : clé API révocable depuis l'UI (liste des partages actifs + « Révoquer »), partage one-time avec heure d'expiration au toast.
- **Extension** : focus menthe unifié, `color-mix` pour les teintes d'accent.
- **Gouvernance** : glossaire FR/EN (coffre-fort/vault/coffre ; modèle/template), règle « overlays sans animation » documentée, CI de contraste au niveau des tokens (APCA dark + WCAG light), test de non-régression i18n (clé manquante → build error).

---

## 5. Résolution — v1.8.6 (2026-11-08)

Les trois vagues ont été appliquées intégralement (commit v1.8.6). Suivi des
points qui ont fait l'objet d'un arbitrage :

- **Kebab des actions de ligne** : implémenté sur les deux tables denses
  (`secrets`, `coffre`) via `ui/rowactions.tsx` — boutons inline avec tooltips
  en desktop (md+), menu kebab Radix (libellé + icône, clavier, Escape) sous
  md. Les autres tables (agents, vaults, audit) ont 1-3 actions par ligne :
  `overflow-x-auto` + aria-labels suffisent, le kebab n'y apporterait que du
  bruit.
- **Garde de contraste** : double référentiel conformément au plan — **APCA
  0.1.9 officielle** (package `apca-w3` de Myndex, implémentation W3) pour le
  thème sombre avec planchers par rôle (fg ≥ Lc 75, fg-2 ≥ 60, fg-3 ≥ 45
  micro-copy, accent-fg ≥ 60, non-texte ≥ 30), **WCAG 2.2 AA** pour le thème
  clair. Valeur de contrôle : blanc/noir = Lc −107,9 (conforme au published ±106-108).
- **BrandBlock** : créé (`ui/brandblock.tsx`, tailles sm/md/lg), déduplique
  les trois blocs marque (sidebar, login — où la tagline reste le h1 unique
  de la page —, wizard).
- **Type-to-confirm EXPORT/DESTROY du coffre** : mécanisme d'origine conservé
  (déjà conforme à l'audit) ; le `ConfirmDialog` avec `requireText` est la
  brique réutilisable pour les prochains besoins.
- **Chips non exclusives du générateur** : conservées en chips maison avec
  `aria-pressed` — le `SegmentedControl` est réservé aux choix exclusifs.

---

## 4. Scores de synthèse

**Nielsen (audit ergonomie)** : H1 statut 5/10 · H2 vocabulaire 5/10 · H3 contrôle 5/10 · H4 cohérence 5/10 · H5 prévention 6/10 · H6 reconnaissance 8/10 · H7 efficience 7/10 · H8 minimalisme 8/10 · **H9 récupération d'erreurs 3/10** (point noir) · H10 aide 7/10.

**WCAG 2.2 AA (audit accessibilité)** : 5 bloquants · 39 majeurs · 54 mineurs — les 5 bloquants se corrigent en quelques heures.

**Points forts à préserver** (cités par les 4 audits) : reduced-motion/transparency/contrast (3 niveaux), sonner `aria-live`, Radix Dialog (sauf keyModal), cibles ≥ 24px, type-to-confirm DESTROY/EXPORT, dry-run de restore DR, corbeille du coffre, re-auth 2FA, masquage par défaut des templated, TemplatePicker (recherche, alias, `<mark>`), keyframes gel documentées, `theme-boot.js` (zéro FOUC).

---

*Audit réalisé par 4 agents spécialisés en parallèle + recherche des référentiels (WCAG 2.2/WAI, APCA, NN/g, WebAIM Million 2026, typographie française). Les 8 bugs du §1 sont vérifiés indépendamment dans le code source.*
