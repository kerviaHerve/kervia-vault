# Kervia-vault — Extension Firefox (Coffre)

Remplissage web depuis le coffre personnel Kervia-vault, **zero-knowledge**
et **sans aucune injection dans les pages** : le remplissage n'agit que sur
ton clic (bouton « Remplir », `Ctrl+Shift+L` ou clic droit), jamais
automatiquement sans ton accord, jamais d'icône dans les champs, jamais de
bulle flottante.

## Fonctions (v1.8.7)

- **Badge sur l'icône** : le nombre d'éléments du coffre correspondant au
  site courant — signal passif, sans injection dans la page.
- **Remplissage multi-frames** : les formulaires de login dans les iframes
  (banques, SSO) sont enfin remplissables ; détection refaite à chaque action
  (formulaires SPA et popups JS rattrapés) ; heuristiques en cascade
  (autocomplete → form → name/id/placeholder → proximité).
- **Code 2FA** : bouton « Code » sur les éléments TOTP — colle le code
  courant dans le champ 2FA de la page (`fill-totp`), ou copie-le.
- **Auto-fill (opt-in)** : Réglages → « Remplissage automatique des pages de
  connexion ». Un seul élément correspondant + champs vides uniquement ;
  plusieurs correspondances → le badge indique, tu choisis. Off par défaut.
- **Ctrl+Shift+L malin** : 1 match → remplit ; 0 ou plusieurs → ouvre le
  coffre pour choisir. Menu contextuel « Remplir depuis le coffre » idem.
- **Copie fiable** : « Copié — effacé dans 30 s » est enfin VRAI : le timer
  vit dans le background, il survit à la fermeture du popup.
- **Popup v2** : favoris et récents d'abord, navigation clavier complète
  (`/`, ↑↓, Entrée), recherche, secrets à la demande (jamais de cache
  plaintext dans le popup), L10N FR/EN.
- **Matching v2** : URIs sans schéma reconnues, suffixes piégés
  (`shop.co.uk` ≠ `random.co.uk`) corrigés.

## Design (v1.8.6)

Le popup est **dark-only** : choix assumé — un popup doit se peindre
instantanément (pas de flash de thème), et son cycle de vie (ouvert/fermé en
quelques secondes) ne justifie pas de persistance de thème. Les tokens sont
doublés localement (`--bg`, `--fg`, `--accent`…) avec les **valeurs exactes**
de `kervia-vault/web-app/src/index.css` (thème dark) ; si la palette WebUI
change, il faut resynchroniser ces variables. Les teintes d'accent dérivent
de `var(--accent)` via `color-mix` (plus aucun `rgba()` codé en dur — si
l'accent bouge, l'extension suit). Le focus des champs utilise le **menthe**
du kit (`--focus`), aligné sur la WebUI v1.8.6.

## Installation

1. **webui → Paramètres → Extension Firefox** → *Télécharger l'extension (.xpi)*.
2. **Firefox** : ouvre le fichier téléchargé → *Installer*. L'XPI servi par
   la webui est **signé AMO** (dès v1.8.3) : installation **permanente**.
   Sans signature (XPI embarqué de secours), Firefox le charge comme
   extension temporaire (rechargée via `about:debugging` après un
   redémarrage de Firefox).
3. **Mises à jour automatiques** : le manifest pointe `update_url` vers
   `vault.kervia.ch/ui/extension-updates.json`, généré par chaque
   release — Firefox propose la mise à jour tout seul. Côté ops, la
   signature post-release : `scripts/amo-sign-extension.sh`
   (identifiants AMO lus dans le vault, XPI signé déposé dans le data
   dir, servi en priorité sans redémarrage).
4. **Crée le token** (webui → Paramètres → Extension) → copie-le → clic
   droit sur l'icône de l'extension → *Gérer l'extension* → colle-le +
   l'URL de ton coffre → *Tester la connexion* → *Enregistrer*.
5. Clique sur l'icône → déverrouille avec ton **mot de passe maître**.

## Utilisation

- **Popup** (`Ctrl+Shift+K`) : éléments correspondant à la page courante,
  recherche dans tout le coffre, copie identifiant/mot de passe (effacés du
  presse-papier après 30 s), code **TOTP vivant** (SHA-1/256/512, 6-8
  chiffres), générateur, synchronisation, verrouillage.
- **`Ctrl+Shift+L`** : remplit la page courante (identifiant + mot de passe
  du meilleur élément correspondant).
- **Auto-lock** : 1/5/15/60 min ou jamais (réglages).

## Design

- **Icônes : Lucide uniquement (shadcn/ui), aucune image, aucun emoji.**
  Chaque icône est un SVG inline (géométrie exacte de
  [lucide-static](https://lucide.dev), ISC) défini dans `js/lucide.js` :
  gabarets statiques via `<span data-lucide="search" data-size="18">`
  (hydratés au chargement), lignes dynamiques via `lucide('copy', 14)`.
  Pour ajouter une icône : ajouter son chemin dans `LUCIDE_PATHS`.
- **Design system** : tokens de `kervia.tokens.json` (charbon / citron /
  menthe) dans `css/popup.css`, police **Space Grotesk** embarquée dans
  `fonts/` (aucun chargement externe).

## Modèle de sécurité

- **Zero-knowledge identique à la webui** : PBKDF2-SHA256 600k → masterKey
  scelle la coffreKey ; AES-256-GCM ; le mot de passe maître et la clé ne
  vivent qu'en mémoire du processus d'arrière-plan. Rien n'est jamais
  écrit sur disque.
- **Token d'accès dédié** (`kvext_…`) créé dans la webui : il n'ouvre qu'une
  seule route — `GET /ext/coffre` (enveloppe + blobs chiffrés). Pas de
  surface admin, pas de surface agent. Seul son hash Argon2id est stocké
  côté serveur ; il est révocable à tout moment. Sans le mot de passe
  maître, le token ne révèle **rien**.
- **Jamais d'injection DOM** : le script de contenu ne remplit des champs
  que sur message explicite du popup/raccourci. Il n'expose rien aux pages.
- **Périmètre réseau** : l'extension ne parle qu'à l'URL de ton coffre
  (host permission) et au site que tu remplis. Aucune télémétrie.

## Compatibilité

Firefox 115+ (Manifest V2). Le remplissage est compatible React/Vue (setter
natif + événements `input`/`change`).