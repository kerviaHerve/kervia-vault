# Composants ui/ — règles du dossier (v1.8.6)

## Règles non négociables

1. **Overlays sans animation d'entrée** (v1.7.2). Un bug de peinture réel
   (Firefox 158/macOS + extension) rendait le contenu des dialogs invisibles
   dès qu'une animation d'entrée partait de `opacity: 0`. Un overlay Radix se
   peint à l'état final, toujours. Les micro-motions de page (transitions,
   stagger) restent autorisées — ce sont les OVERLAYS qui restent immobiles.
2. **Couleurs = rôles uniquement.** Jamais de hex arbitraire dans un composant
   (l'ErrorBoundary inline est l'exception documentée : auto-contenance au
   crash). Le citron utilisé COMME TEXTE passe par `text-accent-fg` ( Olive
   foncé en thème clair) — jamais `text-accent` seul.
3. **Focus : le ring global** (`*:focus-visible`, menthe 2px). Les champs de
   saisie utilisent `focus:outline-focus` — jamais `outline-none` sans
   remplacement, jamais de ring à faible opacité (accent/20 ≈ 2:1).
4. **États annoncés.** Toggle = `aria-pressed` (SegmentedControl), page
   active = `aria-current`, tri = `aria-sort` (SortTh), chargement =
   `aria-busy` + `role="status"` (Loading). L'état n'est JAMAIS porté par la
   couleur seule.
5. **Texte minimum 11px** (`text-2xs`). Les `text-[9px]`/`text-[10px]` sont
   interdits pour du texte utile.
6. **Icônes lucide uniquement**, `aria-hidden="true"` quand décoratives ;
   tout bouton icône-seule a un `aria-label`.

## Inventaire

button (variants primary/secondary/ghost/destructive/link · sizes sm/md/lg/icon/iconSm) ·
badge · input (Input/PasswordInput/Label/Field/Textarea/Select) · dialog (close accessible,
garde Escape/overlay, description liée) · card · confirm (ConfirmDialog — LE rituel
destructeur, focus Annuler, requireText pour l'irréversible total) · segmented
(SegmentedControl) · table (Table/Th/SortTh/Td — overflow + scope + aria-sort) ·
alert · skeleton (Skeleton/Loading/StatsSkeleton) · searchinput · codereveal
(CodeReveal — masqué + œil + copie fiable) · emptystate · tooltip (Tip + Provider) ·
pageheader (h1 par page) · brandblock (BrandBlock — logo + nom + slogan, sm/md/lg) ·
rowactions (RowActions — actions de ligne : inline + tooltips md+, kebab accessible
sous md) · qr (uqr, zero-dep)

## Garde CI

`npm run check` (câblé dans `build`) : parité i18n FR/EN + usages de clés
(scripts/check-i18n.mjs) et contraste des tokens — **APCA 0.1.9 en thème
sombre** (planchers par rôle Lc 75/60/45/30), **WCAG 2.2 AA en thème
clair** (scripts/check-contrast.mjs — le bug « accent 1.37:1 en light » ne
peut plus revenir silencieusement).
