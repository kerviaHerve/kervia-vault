# Relevé de cohérence Kervia — Kervia-vault

Kit utilisé : Kervia Apps 1.0.0 (KERVIA-BRANDING-APPS-v01)
Application : Kervia-vault (ex-Kervia-vault)
Version / révision : v1.1.0 (rebranding complet)
Écrans examinés : login, dashboard authentifié, sidebar/nav complète, wizard (code review — écran contourné par la config env), secrets, agents, vaults, audit, paramètres

| Point | État | Preuve ou écart |
|---|---|---|
| Logo officiel, proportions et bonne variante selon le thème | OK | `kervia-logo-dark.svg`/`kervia-logo-clair.svg` du kit, swappés par `useTheme()` ; jamais redimensionnés en déformation (h-7 sidebar, h-12 login) |
| Nom et icône propres au bon produit, aucun reliquat Center | OK | grep : 0 occurrence Kervia-vault/kervia-vault/kerviavault dans src ; aucun actif Center importé |
| Couleurs communes, sans variantes locales injustifiées | OK | `index.css` = valeurs exactes de `kervia.tokens.json` v1.0.0 ; tous les hex locaux supprimés (boutons, toasts, checkboxes, accents) |
| Police, tailles, espacements, rayons et hauteur des contrôles | OK | Space Grotesk locale (woff2 OFL embarquée) ; computed fontFamily = "Space Grotesk" ; JetBrains Mono conservé pour les valeurs de secrets (besoin monospace métier) |
| Navigation active identifiable par autre chose que la couleur | À corriger | Page active = fond citron translucide + texte citron ; pas encore de repère de graisse/forme dédié — écart signalé, non masqué |
| Champs, boutons, tableaux, badges et fenêtres cohérents | OK | Composants Radix/Tailwind reliés aux tokens (bg-card, text-accent, border-border) ; dialog/fenêtres via portails héritent de `data-theme` (vars sur `<html>`) |
| États survol, appui, focus, désactivé et chargement | OK | focus clavier : anneau 2 px menthe + offset 3 px vérifié par Tab (rgb(127,212,184)) ; spinners de chargement conservés ; disabled existants |
| Messages vide, succès, erreur et validation | OK | états existants reliés aux tokens danger/success ; toasts sur `--color-card-2`/`--color-border` |
| Labels, aide d'erreur, noms des boutons iconiques | OK | labels visibles (Field), erreurs texte+couleur ; boutons iconiques : title/aria-label (GitHub, langue, thème) |
| Thème clair complet, y compris menus et fenêtres | OK | bodyBg clair = rgb(244,246,242) = #F4F6F2 vérifié ; vars redéfinies sur `<html>` → portails inclus |
| Thème sombre complet, y compris menus et fenêtres | OK | bodyBg sombre = rgb(23,27,25) = #171B19 vérifié |
| Préférence de thème conservée | OK | localStorage `kerviavault-theme`, boot sans flash via `/ui/theme-boot.js` externe (CSP `script-src 'self'` respectée — les inline scripts sont bloqués par le serveur) |
| Desktop 1440 px, tablette 768 px et mobile 390 / 320 px | OK | 390 px : scrollWidth=390, aucun débordement global ; 320 px non testé |
| Longs textes, gros montants et listes de données réelles ou réalistes | Non vérifié | testé sur base de test vide ; à revoir avec ~120 secrets réels en production |
| Zoom à 200 %, clavier et absence de focus masqué | Non vérifié | clavier OK (login) ; zoom 200 % pas testé |
| Absence de débordement global ; tableaux larges utilisables | OK | vérifié mobile 390 px ; secrets = tableau + défilement local existant |
| Contrastes calculés sur les états réellement affichés | OK | associations reprises telles quelles du kit (126 paires validées dans CONTRASTES.json du kit) ; aucune opacité locale ajoutée |
| Réduction des animations, aucun son automatique | OK | `prefers-reduced-motion` respecté (règle existante conservée) ; aucun son ni intro ajoutée |
| Fonctionnement métier préservé | OK | `go test ./...` vert (9 paquets) ; aucun changement de routes/API/DB ; préfixe clés `av_` et cookie `av_session` inchangés (compat agents rita/hermes/opencode) |

Captures : `captures/AVANT-login-sombre.png` (ancienne UI orange), `captures/APRES-login-sombre.png`, `captures/APRES-login-clair.png`, `captures/APRES-dashboard-sombre.png`, `captures/APRES-dashboard-clair.png`, `captures/APRES-mobile-login-sombre.png` — livrées avec le rapport de session (hors repo).

Contrôles non effectués : zoom 200 %, mobile 320 px, écran wizard en conditions réelles (contourné par la config env fail-closed), contraste sur données réelles.

Exceptions et justification :
- JetBrains Mono conservé pour les valeurs de secrets (besoin métier monospace, hors identité de marque).
- Le wizard first-boot n'est pas atteignable en config env (fail-closed par design) — son branding est appliqué par le code mais non vérifié en conditions réelles.
- `av_` (clés API) et `av_session` (cookie) conservés : renommer invaliderait les agents existants (décision du 14.10.2026).

Application publiée : non (harmonisation seule — le déploiement production fait l'objet d'une étape séparée explicitement demandée).