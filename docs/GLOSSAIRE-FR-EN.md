# Glossaire FR/EN — kervia-vault (v1.8.6)

Source de vérité terminologique, issue de l'audit UX de nov. 2026. Trois mots
désignaient trois choses (« coffre » = le produit ET le gestionnaire perso ET
parfois un vault) ; voici l'arbitrage officiel.

| Concept | FR (cible) | EN (cible) | Note |
|---|---|---|---|
| Conteneur de secrets (entité) | **vault** (non traduit) | vault | assumé officiellement |
| Le produit / l'instance dans son ensemble | **coffre-fort** | vault | `loginTitle`, `dashSub`, `settingsSub` |
| Gestionnaire de mots de passe perso | **Coffre** (majuscule) | Personal vault | nav « Coffre » — jamais « vault » |
| Secret individuel | **secret** | secret | jamais « credential » en FR (sauf « Type de credential » = concept technique des templates) |
| Structure de champs prédéfinie (openai, smtp…) | **modèle** (coffre) / **template** (secrets, clé API) | template | harmoniser à terme sur « modèle » |
| Agent IA + clé API | **agent** | agent | — |
| Permission agent↔vault | **accès** (grant = accès donné) | access / grant | cycle —/RO/RW |
| Phrase secrète de sauvegarde DR | **passphrase** (non traduit) | passphrase | assumé |
| Clé de chiffrement serveur | **master key** | master key | assumé |
| Lien à une consultation | **lien à usage unique** | one-time link | `shareIntro` |
| Rotation de secret | **renouveler** (rotation OK en contexte pro) | rotate | `ageHint` |
| Corbeille (coffre perso) | **corbeille** | trash | soft-delete 30 j |
| Suppression définitive | **purger** (distinct de « supprimer ») | purge | boutons `t.purge` |
| Sauvegarde DR | **sauvegarde (DR)** + aide « reprise après sinistre » | backup (disaster recovery) | `backupTitle` |
| Code 2FA | **code TOTP** | TOTP code | pas « code à usage unique » (le seed ≠ le code) |

## Ton

- **Vouvoiement systématique** en FR. (v1.8.6 : ext*, wizard corrigés.)
- Typographie FR : espace insécable avant `; : ? !` (les clés i18n l'appliquent ;
  dans le JSX dur, écrire `\u00A0`), guillemets français « » en FR, droits `"…"` en EN.
- Messages d'erreur : langage humain + action (« Session expirée — reconnectez-vous. »),
  jamais de code brut (« HTTP 500 ») — le contrat `friendly()` de `lib/api.ts`.
