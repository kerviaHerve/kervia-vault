#!/usr/bin/env node
// check-i18n.mjs — garde de non-régression i18n (v1.8.6, audit UX).
// 1. Parité FR/EN : chaque clé de translations.ts doit exister dans les deux
//    langues (une clé manquante affiche "undefined" — bug réel v1.8.5).
// 2. Usage : chaque `t.<key>` / `tr('<key>')` des sources doit exister en FR.
// Échec => build cassé : la classe d'erreurs "undefined" à l'écran ne reviendra plus.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const trFile = readFileSync(join(root, 'src/i18n/translations.ts'), 'utf8')

// ── extraction des clés par bloc de langue (fr puis en) ─────────────────────
// Plusieurs clés peuvent partager une ligne (ex : cofWeak, cofFair, cofGood…)
// → on repère chaque identifiant immédiatement suivi de : puis d'une valeur
// chaîne/fonction. Les « : » typographiques FR (espace avant) ne matchent pas.
function extractKeys(block) {
  const keys = []
  // Une clé est TOUJOURS en début de ligne ou juste après une virgule (clés
  // multiples par ligne : cofWeak: "…", cofFair: "…"). Jamais au milieu d'une
  // valeur traduite — « Missing required fields: » ne matche pas.
  const re = /(?:^|[,{])[ \t]*([a-zA-Z0-9_]+):[ \t]*(?=["'`(])/gm
  let m
  while ((m = re.exec(block))) keys.push(m[1])
  return keys
}
const frMatch = trFile.match(/fr:\s*\{([\s\S]*?)\n\s{2}\}/)
const enMatch = trFile.match(/en:\s*\{([\s\S]*?)\n\s{2}\}/)
if (!frMatch || !enMatch) {
  console.error('✗ i18n: blocs fr/en introuvables dans translations.ts')
  process.exit(1)
}
const fr = extractKeys(frMatch[1])
const en = extractKeys(enMatch[1])
const frSet = new Set(fr)
const enSet = new Set(en)

// Dictionnaires LOCAUX qui s'appellent aussi `t` mais ne sont PAS l'i18n
// (wizard : dico inline documenté ; picker : objets de template…).
// Ces usages ne sont pas vérifiés contre translations.ts.
const LOCAL_T = {
  'src/components/TemplatePicker.tsx': ['description', 'category', 'key', 'name', 'aliases', 'fields'],
  'src/i18n/index.tsx': ['fn'],
  'src/lib/coffre-import.ts': ['startsWith', 'endsWith', 'includes'],
  'src/pages/wizard.tsx': [
    'weak', 'mismatch', 'loginFailed', 'stepOf', 'welcome', 'sub', 'langTitle',
    'termsTitle', 'termsBody', 'accept', 'stepPw', 'stepPwH', 'pw', 'pw2',
    'stepCodes', 'stepCodesH', 'dlCodes', 'stepAgent', 'stepAgentH', 'createAgent',
    'finish', 'finishH', 'dlKey', 'dlSkill', 'skillHintT', 'skillHint',
    'skillHintOC', 'skillHintH', 'skillHintEnd', 'goLogin', 'keyAck',
  ],
}

const errors = []
for (const k of fr) if (!enSet.has(k)) errors.push(`clé "${k}" absente en EN`)
for (const k of en) if (!frSet.has(k)) errors.push(`clé "${k}" absente en FR`)
if (new Set(fr).size !== fr.length) errors.push('clés dupliquées en FR')

// ── usage : t.<key> et tr('key') dans les sources ───────────────────────────
function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) {
      if (e === 'node_modules' || e === 'dist') continue
      walk(p, out)
    } else if (/\.(tsx?|mts)$/.test(e)) out.push(p)
  }
  return out
}
for (const file of walk(join(root, 'src'))) {
  const src = readFileSync(file, 'utf8')
  const rel = file.replace(root + '/', '')
  const allow = new Set(LOCAL_T[rel] || [])
  let m
  const tUse = /\bt\.([a-zA-Z0-9_]+)/g
  while ((m = tUse.exec(src))) {
    if (allow.has(m[1])) continue
    if (!frSet.has(m[1])) errors.push(`${rel}: t.${m[1]} n'existe pas dans translations.ts`)
  }
  const trUse = /\btr\(\s*['"]([a-zA-Z0-9_]+)['"]/g
  while ((m = trUse.exec(src))) {
    if (!frSet.has(m[1])) errors.push(`${rel}: tr('${m[1]}') n'existe pas dans translations.ts`)
  }
}

if (errors.length) {
  console.error(`✗ i18n: ${errors.length} problème(s)`)
  for (const e of [...new Set(errors)]) console.error('  - ' + e)
  process.exit(1)
}
console.log(`✓ i18n: ${fr.length} clés, parité FR/EN complète, usages valides`)
