# Kervia-vault — Extension Firefox (Coffre)

Remplissage web depuis le coffre personnel Kervia-vault, **zero-knowledge**
et **sans aucune injection dans les pages** : le remplissage n'agit que sur
ton clic (bouton « Remplir » ou `Ctrl+Shift+L`), jamais automatiquement,
jamais d'icône dans les champs, jamais de bulle flottante.

## Installation

1. **webui → Paramètres → Extension Firefox** → *Télécharger l'extension (.xpi)*.
2. **Firefox** : ouvre le fichier téléchargé → *Installer* (extension
   temporaire : rechargée via `about:debugging` après un redémarrage de
   Firefox, tant que la signature AMO n'est pas activée).
3. **Crée le token** (même carte) → copie-le → clic droit sur l'icône de
   l'extension → *Gérer l'extension* → colle-le + l'URL de ton coffre →
   *Tester la connexion* → *Enregistrer*.
4. Clique sur l'icône → déverrouille avec ton **mot de passe maître**.

## Utilisation

- **Popup** (`Ctrl+Shift+K`) : éléments correspondant à la page courante,
  recherche dans tout le coffre, copie identifiant/mot de passe (effacés du
  presse-papier après 30 s), code **TOTP vivant** (SHA-1/256/512, 6-8
  chiffres), générateur, synchronisation, verrouillage.
- **`Ctrl+Shift+L`** : remplit la page courante (identifiant + mot de passe
  du meilleur élément correspondant).
- **Auto-lock** : 1/5/15/60 min ou jamais (réglages).

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