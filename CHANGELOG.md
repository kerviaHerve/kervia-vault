# Changelog

## v1.8.2 (2026-10-25)

- **Extension Firefox — exigences AMO (publication).** Conformité au
  consentement de collecte intégré à Firefox (obligatoire pour toute
  nouvelle extension depuis le 3 nov. 2025) : déclaration
  `browser_specific_settings.gecko.data_collection_permissions` avec
  `authenticationInfo` en requis — l'extension transmet le token
  d'extension vers le serveur du coffre (service à compte de
  l'utilisateur) ; rien d'autre ne quitte le navigateur (aucune
  télémétrie, aucune donnée de navigation envoyée, remplissage purement
  local). `js/lucide.js` construit désormais les SVG via `DOMParser`
  (document inert) au lieu d'une affectation `innerHTML` : plus aucun
  avertissement du validateur AMO sur ce point. Avertissement restant,
  sans impact : `permissions.request` non implémentée sur Firefox pour
  Android 115 — l'extension vise le desktop (raccourcis clavier,
  popup) ; le fallback Android reste la configuration manuelle.

## v1.8.1 (2026-10-22)

- **Extension Firefox — refonte visuelle.** Le popup et les réglages
  passent au design system Kervia : tokens exacts de
  `kervia.tokens.json` v1.0.0 (charbon, citron, menthe), police
  **Space Grotesk** embarquée (woff2 local, 22 Ko — aucune requête
  externe), anneaux de focus menthe, états survol/actif, défilement
  fin. **Uniquement des icônes Lucide (celles de shadcn/ui) en SVG
  inline — zéro image, zéro emoji** : géométrie exacte de
  lucide-static v0.548.0 (ISC) via `js/lucide.js`, hydratation
  `data-lucide` pour les gabarits statiques et helper `lucide()` pour
  les lignes dynamiques. Écran verrouillé repensé (tuile citron, œil
  afficher/masquer), TOTP en pastille mono menthe, liste avec états
  survol, générateur en carte, toasts avec icône, réglages avec cartes
  titrées et verrouillage auto en contrôle segmenté.
- **Correctif popup.** `no_token` : l'élément `#session-url` inexistant
  faisait planter le handler avant l'ouverture des paramètres webui ;
  l'onglet s'ouvre désormais via l'URL du serveur configuré.

## v1.8.0 (2026-10-22)

- **Extension Firefox pour le Coffre.** Remplis tes sites directement
  depuis ton coffre : l'extension détecte les formulaires et y colle
  identifiant, mot de passe et code TOTP — **uniquement sur ton clic**
  (bouton « Remplir » ou `Ctrl+Shift+L` ; `Ctrl+Shift+K` ouvre le
  coffre). **Aucune interface n'est jamais injectée dans les pages** —
  exactement le comportement des extensions classiques qui cassait la
  webui est exclu par conception. Popup : déverrouillage, éléments
  correspondant à la page, recherche, copie (effacement presse-papier
  30 s), TOTP vivant, générateur, synchronisation, auto-lock. Le coffre
  déverrouillé ne vit qu'en mémoire du processus d'arrière-plan.
- **Token d'extension dédié** (nouvelle surface serveur minimale).
  Paramètres → Extension : *Créer le token* (affiché une seule fois,
  seul son hash Argon2id est stocké — même schéma que les clés agents),
  statut dernière utilisation, révocation, régénération. Le token
  n'ouvre **qu'une** route : `GET /ext/coffre` (Bearer) qui renvoie
  enveloppe + blobs chiffrés en un aller-retour. Aucune surface admin,
  aucune surface agent (/v1, MCP) — testé, tripwire intact. Sans le
  mot de passe maître, le token ne révèle rien : zero-knowledge
  préservé de bout en bout. Ce modèle remplace la piste « session
  webui » abandonnée : `SameSite=Strict` rend le cookie inutilisable
  depuis une extension (Firefox strippe même un header Cookie manuel —
  vérifié).
- **Installable depuis la webui.** L'XPI est construit par CI, embarqué
  dans le binaire (servi par la carte Paramètres → Extension) et joint
  à la release GitHub. Installation : *Télécharger l'extension* →
  ouvrir le fichier dans Firefox. Sans signature AMO, Firefox le
  charge comme extension temporaire (about:debugging) ; la signature
  one-click (compte AMO requis) sera ajoutée en option.
- **Validation.** Go : tests du cycle de vie complet (création → statut
  → usage → 401s, clé agent refusée sur /ext, token refusé sur /admin,
  révocation) + forme /ext/coffre. Extension : crypto vérifiée (même
  schéma que la webui, mauvais mot de passe → message clair) ;
  **E2E sur vrai Firefox 158.0.1 (macOS, Apple Silicon)** — install
  XPI, auto-déverrouillage par token (3 éléments déchiffrés),
  correspondance URL → formulaire, remplissage complet vérifié champ
  par champ + soumission. E2E webui complet toujours 21/21.

## v1.7.3 (2026-10-22)

- **Perf gros coffres (6 500 items et plus).** Le coffre rendait TOUTES
  les lignes d'un coup (6 500 lignes DOM) et chaque ligne avec TOTP
  montait son propre timer — des centaines d'intervalles par seconde
  saturaient le navigateur ; chaque sauvegarde re-téléchargeait et
  re-déchiffrait l'intégralité du coffre. Tout cela est corrigé :
  - **Pagination de la liste** : 100 lignes rendues, bouton « Afficher
    les suivants » par paliers de 500 — le DOM reste léger quel que
    soit la taille du coffre.
  - **Un SEUL timer TOTP pour toute la page** (ticker partagé) au lieu
    d'un interval par ligne.
  - **Sauvegarde/corbeille = mise à jour locale** de l'élément : plus
    de re-téléchargement + re-décryptage des 6 500 items à chaque
    enregistrement. Le rechargement complet reste pour l'import en lot.
  - **Recherche précalculée** (`_search` indexé au chargement) et
    filtres/dossiers/tags mémoïsés ; spinner « Chargement du coffre… »
    pendant le déverrouillage.
  - Mesuré sur un coffre de 3 000 items (chromium) : déverrouillage
    complet 260 ms, clic « Nouveau » → picker 138 ms, recherche 18 ms,
    création complète d'un item 533 ms, ouverture d'un item 86 ms.
    E2E complet 21/21 toujours vert.

## v1.7.2 (2026-10-22)

- **Dialogs : peinture instantanée, zéro animation.** Dernier maillon
  du bug « premier clic → flou, deuxième clic → ça marche » (Firefox
  158/macOS) : l'animation d'entrée `popin` partait de `opacity: 0` —
  dans cet environnement, la progression vers l'état final ne se
  peignait pas au premier rendu (GPU/extension), laissant le contenu
  invisible derrière le scrim. Toutes les animations des dialogs
  (entrée ET sortie) sont retirées : l'overlay et le contenu n'ont plus
  JAMAIS d'état initial invisible — ils se peignent d'emblée à l'état
  final. Structurellement impossible d'avoir un dialog invisible ou un
  scrim suspendu, quel que soit l'environnement. Le blur du scrim et
  l'ombrage du panneau restent (statiques). Validé : E2E chromium
  complet 21/21, Firefox 158.0.1 réel — premier clic : dialog peint
  immédiatement (`animationName: none`, opacité 1), fermetures Échap et
  × en boucle propres.

## v1.7.1 (2026-10-22)

- **Robustesse dialogs : plus jamais de page floue figée.** Les overlays
  Radix attendaient l'événement `animationend` des animations de sortie
  pour se démonter — si cet événement ne part jamais (extension du
  navigateur qui interfère, quirk de rendu), le scrim restait suspendu à
  vie : écran flou et page morte, sans aucune erreur console. Les
  animations de sortie sont retirées : Radix voit `animationName: none`
  et démonte immédiatement à la fermeture. Les animations d'entrée sont
  conservées. Validé sur Firefox 158.0.1 réel (binaire officiel via
  geckodriver) : fermetures Escape et bouton × en boucle, overlay
  proprement retiré à chaque fois ; E2E chromium complet toujours 21/21.
- **Filet de sécurité : écran d'erreur au lieu de page blanche.** Un
  boundary React englobe l'application — tout crash de rendu affiche
  désormais une carte claire avec le message d'erreur et un bouton
  « Recharger » (auto-contenu, aucun import : le crash peut venir de
  n'importe quel module). Les données ne risquent jamais rien : tout est
  chiffré côté serveur.
- **Diagnostic coffre (informatif)** : le « flou bloquant » constaté sur
  un poste (Firefox 158/macOS, profil normal) ne se reproduit ni en
  fenêtre privée, ni sur le même Firefox officiel headless avec
  l'artefact release exact — la cause est une extension du navigateur
  (probablement le gestionnaire de mots de passe) qui injecte son
  autofill dans les dialogs. Exclure vault.kervia.ch dans les réglages
  de l'extension.

## v1.7.0 (2026-10-22)

- **Le Coffre v2 — un vrai gestionnaire de mots de passe.** Le coffre
  personnel (zero-knowledge, agents JAMAIS accès — inchangé) passe du
  « login + note » à une organisation type 1Password : **14 modèles**
  d'éléments, **imports Bitwarden / 1Password / CSV** et **TOTP avancé**.
  Tout reste côté navigateur : le serveur ne voit toujours que des
  blobs AES-256-GCM opaques — **aucune modification de l'API ni du
  schéma serveur**, aucune nouvelle dépendance npm (WebCrypto +
  DecompressionStream natifs).
  - **14 modèles** : Identifiant, Note, Carte bancaire, Compte bancaire,
    Identité, Passeport, Wallet crypto, Clé SSH, Serveur, Base de
    données, Wi-Fi, Licence logicielle, Abonnement/Membre, Code TOTP.
    Chaque modèle pré-remplit ses champs (numéro masqué, expiration,
    CVV, IBAN, seed…) ; des **champs personnalisés** (7 types : texte,
    secret, TOTP, lien, mois, date, multiligne) complètent n'importe
    quel élément ; **étiquettes** (tags) et dossiers.
  - **Imports** (détection automatique du format) : Bitwarden /
    Vaultwarden **JSON** (identifiants, notes, cartes, identités,
    champs personnalisés), **1Password .1pux** (ZIP officiel, lu par
    DecompressionStream natif — zip zéro dépendance) et **1PIF**
    (legacy 1Password 7), **CSV** de Chrome, Firefox, Safari, LastPass,
    Dashlane, KeePass, Proton, NordPass… (colonnes auto-détectées,
    cartes bancaires reconnues), et le **format Kervia** (round-trip
    complet). Exports : **Kervia JSON** (fidèle à 100 %) et **Bitwarden
    JSON** (ré-importable dans Vaultwarden).
  - **TOTP v2** : plusieurs seeds par élément, URI `otpauth://`
    complètes (SHA-1/SHA-256/SHA-512, 6-8 chiffres, périodes 30/60 s)
    validées contre les vecteurs RFC 6238 ; code vivant en liste et en
    vue détaillée.
  - **Migration douce** : les items v1 existants sont normalisés v2 à
    la lecture et réécrits au prochain enregistrement — les vieux
    blobs restent lisibles pour toujours, aucune action requise.
  - **E2E navigateur** (chromium headless) : 21 étapes vertes —
    création, 14 modèles, carte bancaire (sous-titre •••• 4242), filtre
    par catégorie, import CSV + Bitwarden, TOTP SHA-256 8 chiffres
    vivant, export Kervia + round-trip, verrouillage/déverrouillage.
    Suite lib Node : 31 tests (schéma, migration, imports, exports,
    vecteurs RFC 6238).

## v1.6.3 (2026-10-22)

- **Coffre réparé : écran blanc au premier clic.** Le coffre personnel était
  cassé depuis sa naissance (v1.2.0) : les cinq dialogs (nouvel item,
  générateur, import, export, réglages) étaient rendus sans le `<Dialog>`
  Root de Radix — Radix jette « must be used within Dialog » au premier
  rendu et React démonte l'arbre complet. Résultat : déverrouiller le
  coffre marchait, mais cliquer « Nouveau » (ou tout autre bouton ouvrant
  un dialog) provoquait un écran blanc. Personne ne l'avait vu car la
  validation E2E de l'époque couvrait la crypto (Node/WebCrypto) et les
  API (HTTP) — jamais l'UI au clic. Chaque dialog est désormais enveloppé
  dans son `<Dialog open onOpenChange>`, le même pattern que les pages
  secrets/agents. Validé par un parcours complet en navigateur headless :
  création du coffre, nouvel item, vue détaillée, générateur, import,
  export, réglages, verrouillage/déverrouillage, item TOTP — 12/12 verts,
  zéro erreur console.

## v1.6.2 (2026-10-22)

- **Journal des versions dans Paramètres.** Un panneau à droite affiche les
  **trois dernières releases** (tag, date, notes complètes) — collant
  (sticky), déroulant, masqué sur petit écran. La release la plus récente
  porte le badge « Mise à jour » quand elle n'est pas encore installée.
  Un seul fetch côté serveur alimente le journal ET les notes de l'update
  à venir (`recent[]` dans le statut, `notes` dérivé) ; URL overridable
  (`KERVIA_VAULT_RECENT_URL`), tolérant aux pannes — pas de réponse =
  pas de panneau, jamais un check cassé.

## v1.6.1 (2026-10-22)

- **i18n : titres de pages enfin traduits.** Les titres `<h1>` étaient codés
  en dur en français dans une webui bilingue — basculer en anglais laissait
  « Paramètres », « Secrets », « Permissions »… en français. Les clés de
  traduction existaient déjà (`settingsTitle`, `agentsTitle`, `vaultsTitle`,
  `secretsTitle`, `grantsTitle`, `auditTitle`) — les `<h1>` ne les
  utilisaient simplement pas.
- **Login : « v1.0 » codé en dur retiré du footer.** La version exacte
  n'est volontairement pas révélée avant authentification (hardening recon
  v1.0.12) — et le chiffre affiché était de toute façon faux depuis
  longtemps.

## v1.6.0 (2026-10-22)

- **Mise à jour : le confort du clic.** Deux irritations de la v1.5 corrigées :
  - **Rechargement automatique RÉPARÉ.** La détection de fin de restart
    cherchait la version dans `/setup/info` — or le hardening recon
    (v1.0.12) ne la révèle plus une fois l'installation faite : le
    rechargement ne se déclenchait JAMAIS, rafraîchissement manuel obligatoire.
    Le signal fiable est la **fenêtre down** : l'apply quitte proprement,
    systemd relance en ~3 s — la webui sonde chaque seconde et la première
    réponse APRÈS un échec recharge la page (fallback 15 s pour un restart
    trop rapide pour être vu).
  - **Changelog visible AVANT de cliquer.** Le statut d'update transporte
    désormais les **notes de la release** (markdown extrait du CHANGELOG par
    le workflow) : la carte Version déploie « Ce que cette mise à jour
    apporte » — titres, listes à deux niveaux, gras, sans dépendance
    markdown côté client. Tolérant aux pannes : pas de notes = pas de
    section, jamais un check cassé. URL overridable
    (`KERVIA_VAULT_NOTES_URL`) pour tests et miroirs privés.

## v1.5.0 (2026-10-22)

- **Double authentification (TOTP) sur le login admin.** Second facteur
  opt-in, standard RFC 6238 :
  - enrôlement en deux temps depuis Paramètres — la clé (seed base32)
    s'affiche UNE fois avec son URI `otpauth://` (Google Authenticator,
    1Password, Aegis…) ; un code valide confirme et active.
  - au login : mot de passe + code, **échec uniforme** — rien ne désigne
    le facteur fautif. HMAC-SHA1/30 s/6 chiffres/±1 pas (dérive d'horloge).
  - désactivation exige les DEUX facteurs ; une récupération par code
    réinitialise AUSSI le TOTP (issue de secours officielle du téléphone
    perdu). Persistance fichier `0600` à côté de la DB.
- **Rappels de rotation.** Badge d'âge en jours sur chaque secret (couleur
  par ancienneté : frais < 30 j · à surveiller 30-90 j · à rotationner
  > 90 j) — répond au besoin historique des « rotation prévoir » griffonnés
  à la main dans les noms de clés.
- **Liens de partage éphémères.** Un secret, un lien à UNE consultation :
  - token 32 octets CSPRNG retourné une seule fois, seul son SHA-256 en
    base (migration 005) ; consommation atomique one-time, TTL borné
    1 min plancher / 24 h plafond (défaut 30 min).
  - page publique autonome **sans JavaScript** (CSP-proof), bilingue,
    no-store, deny-frame ; consommé / expiré / inconnu → la même page,
    l'énumération n'apprend rien. Audit complet, jamais le token.
- **Export DR chiffré + restauration (webui ET CLI).** Paramètres →
  Sauvegarde : un bundle des vaults d'agents scellé par une passphrase
  (PBKDF2-SHA256 600k + AES-256-GCM, format `KVX1`) — **pas la master
  key** : il restaure sur n'importe quelle instance. Le coffre personnel
  n'y figure pas (zero-knowledge : il a son propre export chiffré côté
  navigateur). Restauration en deux temps dans la webui : **vérifier**
  (dry-run : inventaire sans écriture) puis **importer** — seuls les
  vaults MANQUANTS sont restaurés, jamais d'écrasement, jamais de fusion
  silencieuse. CLI pour l'instance neuve :
  `kervia-vault import <fichier.kvx>` (fail-closed). Cycle complet testé
  E2E : export (master key A) → import (master key B différente) → valeur
  intacte ; et le vrai accident — vault supprimé par erreur → restauré.
- **PWA.** L'webui s'installe comme app (iPhone/Android) : manifest
  `standalone`, métas iOS, icône maskable. Pas de service worker — le
  coffre vit avec son serveur, un SW n'apporterait que du cache à
  invalider.
- **Fix interne (attrapé par l'E2E)** : les migrations vivent dans
  `internal/store/migrations/` (le `go:embed` est relatif au package) —
  le résiduel `/migrations/` racine de la v1.0.0 a été supprimé.

## v1.4.0 (2026-10-21)

- **Webui : design system Apple** (skill apple-design — principes WWDC
  *Designing Fluid Interfaces* traduits pour le web, appliqués dans les
  tokens du kit Kervia) :
  - **Springs partout** : navigation en spring amorti critique (bounce 0,
    response ~0.3) — pas d'overshoot sur une action qui n'en porte pas,
    motion interruptible par construction ;
    `MotionConfig reducedMotion="user"` global côté framer-motion.
  - **Press au pointer-down** : feedback `scale(0.97)` avec transition de
    transform 100 ms sur boutons, nav et contrôles — le clic s'enfonce
    instantanément, il ne claque plus.
  - **Dialogs symétriques** : enter/exit le long du même chemin
    (popin/popout en miroir, courbe sheet Apple `cubic-bezier(0.32,0.72,0,1)`) ;
    le scrim se **matérialise** — le blur anime avec l'opacité, la surface
    lit comme un vrai matériau qui arrive.
  - **Matériaux translucides** : toasts en verre `kv-glass`
    (`backdrop-filter: blur + saturate`), le contenu défile dessous —
    couche fonctionnelle flottante, pas un bloc opaque.
  - **Typographie optique** : tracking spécifique à la taille (h1 −0.015em,
    h2 −0.01em, h3 −0.005em, corps 0) — plus de letter-spacing fixe.
  - **Accessibilité** : `prefers-reduced-transparency` (verres rendus
    opaques), `prefers-contrast: more` (fonds solides + bord net),
    reduced-motion en équivalent doux (cross-fades), jamais une absence
    de feedback.

## v1.3.0 (2026-10-21)

- **Support macOS — Apple Silicon & Intel.** Kervia-vault tourne nativement
  sur Mac avec le même modèle de sécurité que sur Linux :
  - **Binaires darwin** (arm64 + amd64) publiés dans chaque release GitHub,
    vérifiés sha256 comme les autres plateformes. L'auto-mise à jour de la
    webui détecte l'OS et télécharge `kervia-vault-darwin-*.tar.gz`.
  - **Installeur macOS** : `curl … | sudo bash` détecte macOS et installe le
    même parcours que Linux — binaire sha256-vérifié, compte de service
    dédié `_kerviavault` (dscl, sans shell, masqué de l'écran de login),
    LaunchDaemon `ch.kervia.vault` avec `KeepAlive` (l'équivalent exact de
    `Restart=always` : la self-update quitte proprement, launchd relance
    le nouveau binaire).
  - **Mêmes propriétés de sécurité** : le daemon ne tourne pas en root,
    la master key ne vit que dans le plist `600` root:wheel, le binaire
    réside dans le data dir (`/usr/local/var/kervia-vault/bin`) pour que la
    self-update puisse écrire SON propre binaire — symlink root-owned dans
    `/usr/local/bin`.
  - **Updater cross-OS** : résolution du binaire réel sur darwin via
    `os.Executable` + `EvalSymlinks` (`/proc/self/exe` n'existe pas sur
    macOS) ; le mode `launchd` est reporté à la webui à la place de
    `systemd`.
  - **install.sh compatible bash 3.2** (macOS stock) — `mapfile` retiré ;
    réseau via `ifconfig`, checksums via `shasum`, port via `lsof`.
    La source des releases est overridable (`KERVIA_VAULT_RELEASES_URL`)
    pour les tests et les miroirs privés, en miroir de
    `KERVIA_VAULT_UPDATE_URL` côté binaire.
  - La config par défaut de la DB devient OS-aware (`/usr/local/var` sur
    macOS) — l'installeur la fixe explicitement, le défaut ne sert qu'aux
    lancements manuels.

## v1.2.0 (2026-10-15)

- **Coffre personnel : un vrai gestionnaire de mots de passe, invisible des agents.**
  Un coffre pour vos identifiants personnels, chiffré **de bout en bout dans le
  navigateur** (zero-knowledge, comme Bitwarden) — les agents n'y ont
  **jamais** accès, même en théorie :
  - **Chiffrement client** : mot de passe maître → PBKDF2-SHA256 600k
    (WebCrypto natif, pas de WASM, CSP stricte inchangée) → masterKey qui
    scelle la coffreKey (32 B aléatoire). Le serveur ne stocke **que des
    blobs opaques** : une compromission totale du serveur ne révèle rien,
    et aucun mot de passe maître ne transite jamais.
  - **Triple isolation agents** : routes uniquement dans l'API admin
    (session), zéro surface `/v1`/MCP (testée en intégration + tripwire
    source), audit actions + IDs opaques uniquement.
  - Fonctionnalités : logins + notes sécurisées, dossiers, favoris,
    recherche locale, TOTP 2FA générés dans la webui (seed chiffré),
    générateur (caractères / passphrase) + indicateur de force, historique
    des mots de passe, corbeille (restauration + purge), import/export JSON
    Bitwarden/Vaultwarden, concurrence optimiste par version, copie
    presse-papier avec effacement auto (30 s).
  - **Verrouillage** : auto-lock paramétrable (1/5/15/60 min, défaut 5),
    la clé ne vit qu'en mémoire JS — un rechargement de page reverrouille.
  - **Aucune récupération possible** (zero-knowledge) : mot de passe maître
    perdu = coffre perdu — c'est la contrepartie de la garantie
    d'inaccessibilité. Warning explicite à la création.

## v1.1.0 (2026-10-14)

- **Rebranding complet vers Kervia-vault** (kit KERVIA-BRANDING-APPS-v01) :
  - Palette Kervia officielle (charbon #171B19, citron #B8E263, menthe #7FD4B8) —
    les valeurs hexadécimales locales sont remplacées par des rôles de tokens.
  - **Thème clair ajouté** : bascule sombre/clair (persistée, `data-theme` sur
    `<html>`, boot sans flash via `theme-boot.js` servi en externe — CSP stricte
    inchangée), logo Kervia officiel swapé par thème.
  - Typographie : Space Grotesk locale (OFL, embarquée — aucun chargement
    externe) ; JetBrains Mono conservé pour les valeurs de secrets.
  - Logo Kervia intact + nom produit séparé dans la sidebar, le login et le
    wizard (règle du kit) ; favicons/manifest/android-chrome remplacés.
  - Fixes de service embarqué : les fichiers racine de la WebUI (favicon,
    manifest, theme-boot.js) sont maintenant servis avec leur vrai type MIME
    (ils étaient avalés par le fallback SPA en `text/html`).
  - Focus clavier : anneau 2 px menthe, espacement 3 px, respecté par les
    transitions existantes.
  - Identité technique : module `github.com/kerviaHerve/kervia-vault`, binaire
    `kervia-vault`, variables `KERVIA_VAULT_*`. Le préfixe des clés API `av_`
    et le cookie `av_session` sont inchangés (compatibilité des agents
    existants).

## v1.0.12 (2026-09-22)

- **[strix vuln-0001, CWE-200, CVSS 5.3] `/setup/info` recon hardening**:
  once setup is done, the public endpoint returns only `{"setup_done":true}` —
  the internal listen address and exact version are no longer disclosed
  unauthenticated (they were only ever needed by the first-boot wizard).
  Verified by a first autonomous pentest (Strix + DeepSeek V4 Pro) against
  the production instance; 18 attack surfaces covered, 1 finding, fixed.

## v1.0.11 (2026-09-22)

- **Security audit (full code Sentinel pass).** All surfaces reviewed —
  auth chains, per-secret grant re-verification, crypto, webui, MCP,
  installer, CI, dependencies (govulncheck/npm: clean).
- **Fix [audit trail]**: the webui secret reveal now leaves a `read`
  trace in the append-only audit (SPEC: repudiation — every decrypted
  read is an action; agents were audited, the admin reveal wasn't).
- **Fix [memory hygiene]**: expired admin sessions are swept every hour
  — the in-memory session map grew forever before (one leaked entry
  per login on a long-lived process).

## v1.0.10 (2026-09-22)

- **Quick copy from the list.** A copy button next to the eye on every
  secret row (and in search results): copies the main credential
  (token/password/key field for templated secrets, the value for
  free-form) straight to the clipboard with a toast — no dialog needed.

## v1.0.9 (2026-09-22)

- **Eye toggle in edit fields.** Editing a sensitive field (API token,
  password, secret…) now shows a small eye in the input to reveal the
  value while editing — both in the secret dialog and the create form.

## v1.0.8 (2026-09-22)

- **No JSON anywhere in the UI.** Secret reveal and edit moved to a
  proper dialog: labeled field cards (masked sensitive values, per-field
  copy) and one input PER template field for editing — the client sends
  `{values: {field: value}}`, the server validates against the template
  and stores the new version. Free-form secrets edit in a plain textarea.

## v1.0.7 (2026-09-22)

- **WebUI: elegant secret reveal.** Templated secrets now show a labeled
  field card (the template's human labels — "API token", not "api_token"),
  sensitive fields masked until clicked, per-field copy on hover, and a
  discreet "copy raw JSON" for machine use. Free-form secrets unchanged.

## v1.0.6 (2026-09-22)

- **SECURITY: the generated skill never contains the API key anymore.**
  The wizard's SKILL.md used to embed the live key in 9 places (YAML,
  stdio, curl, OpenCode CLI+jsonc, Hermes prompt). A key inside a stored/
  logged/shared file is a burned key. Now:
  - the skill documents the connection (URLs, tools, rules) with
    placeholders only (`Bearer ${MCP_AG_VAULT_API_KEY}` interpolation);
  - install is out-of-band: the agent asks the user for the key via the
    client's masked prompt (`hermes mcp add`), or a user-owned 0600 file;
  - the key lives only in the one-time displayed screen + the .txt file
    (with chmod 600 instructions), and the client's own store.
- Generated skill + wizard hint + key file: bilingual FR/EN.
- README/docs skill: interpolation-only examples (no `Bearer av_...`).

## v1.0.5 (2026-09-22)

- README: technical ASCII architecture diagram + release badge.
- Repo description/version kept in sync.

## v1.0.4 (2026-09-22)

- **Update check cache: 6h → 5min** — a freshly published release is
  visible in the webui within minutes instead of hours.

## v1.0.3 (2026-09-22)

- **Auto-reload after self-update** — the settings page polls the
  service and reloads automatically when the new binary is up; the
  "restarting…" screen never stays stuck anymore.

## v1.0.2 (2026-09-22)

- WebUI sidebar footer: clickable AGPL-3.0-or-later license link.

## v1.0.1 (2026-09-22)

- **Setup wizard (first boot)**: language → terms of use → admin
  password → recovery codes → first agent (API key + ready-to-paste
  skill with the instance's real URLs, OpenCode/Hermes install commands).
- **Self-update from the webui**: version badge in the sidebar, one
  click downloads the sha256-verified release, sanity-checks the binary
  and swaps it — data untouched. Docker installs get a clear message
  (read-only filesystem).
- **Installer (install.sh)**: VPN-aware address picker (NetBird/
  Tailscale), red warning + confirmation on public IPs, automated mode
  via `KERVIA_VAULT_BIND`/`KERVIA_VAULT_PORT`, sha256-verified download,
  hardened systemd service (dedicated user, ProtectSystem=strict,
  Restart=always).
- AGPL-3.0 distribution compliance: full license text, module path
  `github.com/kerviaHerve/kervia-vault` (`go install` works).

### Fixed

- Setup takeover window on upgrades: an instance with a real admin
  password is never re-opened in wizard mode (Reconcile at boot).
- Cookie `Secure` is transport-aware — HTTP wizard works on LAN/VPN.
- Login screen rendered again after logout (users were stuck).
- Empty instances: JSON lists are `[]` not `null` (no SPA crash).
- CSP allows embedded woff2 fonts.
- install.sh works over `curl | bash` and actually matches CGNAT/VPN
  ranges.

## v1.0.0 (2026-09-21)

Initial public release.

- One Go binary: REST API + MCP server (stdio + streamable HTTP) +
  embedded WebUI (React SPA).
- SQLite embedded, AES-256-GCM per secret, Argon2id API keys,
  per-vault grants, immutable versioning, append-only audit.
- 51 credential templates.
- CI (test -race, lint, gosec, govulncheck, shellcheck) + release
  workflow (amd64 + arm64 + checksums).

---

AGPL-3.0-or-later — see [LICENSE](LICENSE).