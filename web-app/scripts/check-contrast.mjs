#!/usr/bin/env node
// check-contrast.mjs — garde de contraste au niveau des TOKENS (v1.8.6).
//
// Référentiel double, comme le plan de l'audit :
//   · THÈME SOMBRE → APCA 0.1.9 (W3) : perceptuellement uniforme, le WCAG 2.x
//     surestime le contraste des couleurs sombres et est inutilisable en
//     dark mode (cf. git.apcacontrast.com/documentation/APCAeasyIntro).
//     Planchers par rôle : fg ≥ Lc 75 (texte lisible), fg-2 ≥ Lc 60 (texte
//     de contenu), fg-3 ≥ Lc 45 (micro-copy incidente — hints, en-têtes de
//     table 11px semibold), accent-fg ≥ Lc 60, texte sur accent ≥ Lc 60,
//     tons d'alerte ≥ Lc 45, non-texte (focus, bordure de contrôle) ≥ Lc 30.
//   · THÈME CLAIR → WCAG 2.2 AA : 4.5:1 texte, 3:1 composants.
//
// Le bug v1.8.5 (accent citron 1.37:1 en thème clair, 62 usages) ne peut
// plus revenir silencieusement : changer un token sans repasser la barre
// casse le build.
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { APCAcontrast, sRGBtoY } from 'apca-w3'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const css = readFileSync(join(root, 'src/index.css'), 'utf8')

// ── WCAG 2.2 (thème clair) ───────────────────────────────────────────────────
function lum(hex) {
  const c = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map(i => parseInt(c.slice(i, i + 2), 16) / 255)
  const f = v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
function wcagRatio(a, b) {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (l1 + 0.05) / (l2 + 0.05)
}

// ── APCA 0.1.9 (thème sombre) — implémentation officielle Myndex ─────────────
const h2rgb = h => [0, 2, 4].map(i => parseInt(h.replace('#', '').slice(i, i + 2), 16))
function apcaLc(txt, bg) {
  return Math.abs(APCAcontrast(sRGBtoY(h2rgb(txt)), sRGBtoY(h2rgb(bg))))
}

function tokens(block) {
  const out = {}
  const re = /--color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g
  let m
  while ((m = re.exec(block))) out[m[1]] = m[2]
  return out
}
const darkBlock = css.slice(css.indexOf('@theme'), css.indexOf('html[data-theme'))
const lightBlock = css.slice(css.indexOf('[data-theme="light"]'), css.indexOf('html { color-scheme'))
const dark = tokens(darkBlock)
const light = { ...dark, ...tokens(lightBlock) }

// [texte, fond, seuil] — WCAG AA pour le thème clair.
const WCAG_CHECKS = [
  ['fg', 'bg', 4.5], ['fg', 'card', 4.5],
  ['fg-2', 'card', 4.5], ['fg-2', 'bg', 4.5],
  ['fg-3', 'card', 4.5], ['fg-3', 'card-2', 4.5],
  ['accent-fg', 'bg', 4.5], ['accent-fg', 'card', 4.5], ['accent-fg', 'card-2', 4.5],
  ['accent-text', 'accent', 4.5],
  ['focus', 'bg', 3], ['border-2', 'bg', 3], ['link', 'bg', 4.5],
  ['danger', 'danger-bg', 4.5], ['warn', 'warn-bg', 4.5], ['success', 'success-bg', 4.5],
]

// APCA dark — planchers par RÔLE (voir en-tête du script).
const APCA_CHECKS = [
  ['fg', 'bg', 75], ['fg', 'card', 75],            // texte principal, toute taille
  ['fg-2', 'card', 60], ['fg-2', 'bg', 60],        // texte de contenu (labels, secondaire)
  ['fg-3', 'card', 45], ['fg-3', 'card-2', 45],   // micro-copy incidente (hints, th 11px semibold)
  ['accent-fg', 'bg', 60], ['accent-fg', 'card', 60], ['accent-fg', 'card-2', 60],
  ['accent-text', 'accent', 60],                   // texte sur boutons primaires
  ['link', 'bg', 60],
  ['focus', 'bg', 30], ['border-2', 'bg', 30],     // non-texte (WCAG 1.4.11 équiv.)
  ['danger', 'danger-bg', 45], ['warn', 'warn-bg', 45], ['success', 'success-bg', 45],
]

const errors = []
for (const [fg, bg, min] of WCAG_CHECKS) {
  if (!light[fg] || !light[bg]) { errors.push(`thème light: token manquant (${fg} ou ${bg})`); continue }
  const r = wcagRatio(light[fg], light[bg])
  if (r < min) errors.push(`thème light (WCAG): ${fg} sur ${bg} = ${r.toFixed(2)}:1 (< ${min}:1)`)
}
for (const [fg, bg, min] of APCA_CHECKS) {
  if (!dark[fg] || !dark[bg]) { errors.push(`thème dark: token manquant (${fg} ou ${bg})`); continue }
  const lc = apcaLc(dark[fg], dark[bg])
  if (lc < min) errors.push(`thème dark (APCA): ${fg} sur ${bg} = Lc ${lc.toFixed(1)} (< Lc ${min})`)
}

if (errors.length) {
  console.error(`✗ contraste: ${errors.length} échec(s)`)
  for (const e of errors) console.error('  - ' + e)
  process.exit(1)
}
console.log('✓ contraste: WCAG AA en thème clair + APCA (Lc) en thème sombre — tous les tokens passent')
