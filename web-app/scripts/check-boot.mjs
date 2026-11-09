#!/usr/bin/env node
// check-boot.mjs — LA garde du boot réel (v1.9.2).
//
// Incident v1.9.1 : un bloc self-test (`typeof require !== 'undefined' &&
// require.main === module`) a survécu à tsc ET à vite build, puis rolldown
// l'a réécrit en référence nu `module` → ReferenceError au module scope →
// le bundle entier mourait avant React → splash bloquée en prod, pendant
// que CI était « tout vert ». tsc et le build n'EXÉCUTENT pas le code :
// seul un boot réel le vérifie. Cette garde exécute le BUNDLE CONSTRUIT
// (celui servi par le binaire) dans un DOM simulé et échoue si :
//   - le bundle jette à l'import,
//   - React ne monte pas (#root vide),
//   - les fetches de boot ne partent pas.
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { JSDOM } from 'jsdom'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const distDir = join(root, '..', 'internal', 'dist-check')
// Le vrai dist du binaire :
const realDist = join(root, '..', 'internal', 'web', 'dist')
const dist = readFileSync(join(realDist, 'index.html'), 'utf8').includes('assets/index-')
  ? realDist : distDir

const html = readFileSync(join(dist, 'index.html'), 'utf8')
const m = html.match(/src="(\/?[^"]*assets\/index-[^"]+\.js)"/)
if (!m) {
  console.error('✗ boot : aucun bundle index-*.js référencé dans le HTML du dist')
  process.exit(1)
}
const jsPath = m[1].replace(/^\/?ui\//, '').replace(/^\//, '')
const bundlePath = join(dist, jsPath)

// PIÈGE (incident v1.9.1) : importer le bundle .js depuis Node le charge
// en CommonJS s'il n'y a pas de package.json à proximité — et en CJS,
// `module` EXISTE, donc le crash ESM du navigateur est masqué. On force
// le chargement ESM (comme le navigateur) via une copie .mjs temporaire.
const esmPath = join(tmpdir(), `check-boot-${Date.now()}.mjs`)
writeFileSync(esmPath, readFileSync(bundlePath, 'utf8'))

const dom = new JSDOM(html, { url: 'https://vault.kervia.ch/ui/', pretendToBeVisual: true })
const w = dom.window
const fetches = []
w.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : String(input?.url || input)
  fetches.push(url)
  const body = url.includes('/setup/info')
    ? { setup_done: true, listen: '', version: 'v0-test' }
    : []
  // Objet simple suffisant au boot (ok/status/json) — Response de jsdom
  // n'existe pas dans cette version et le constructeur n'est pas nécessaire.
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
}
w.matchMedia ||= (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
w.ResizeObserver ||= class { observe() {} unobserve() {} disconnect() {} }
w.IntersectionObserver ||= class { observe() {} unobserve() {} disconnect() {} }


const g = globalThis
// CRUCIAL : dans le bundle, l'appelle nu `fetch(...)` → résout vers le
// global de l'hôte (Node), PAS window.fetch. On intercepte donc AUSSI
// le global — sinon 0 fetch capté et la garde est aveugle.
Object.defineProperty(g, 'fetch', { value: w.fetch, configurable: true })
Object.defineProperty(g, 'window', { value: w, configurable: true })
Object.defineProperty(g, 'document', { value: w.document, configurable: true })
Object.defineProperty(g, 'navigator', { value: w.navigator, configurable: true })
Object.defineProperty(g, 'localStorage', { value: w.localStorage, configurable: true })
Object.defineProperty(g, 'location', { value: w.location, configurable: true })
Object.defineProperty(g, 'MutationObserver', { value: w.MutationObserver, configurable: true })
Object.defineProperty(g, 'Node', { value: w.Node, configurable: true })
Object.defineProperty(g, 'Element', { value: w.Element, configurable: true })
Object.defineProperty(g, 'SVGElement', { value: w.SVGElement, configurable: true })
Object.defineProperty(g, 'HTMLElement', { value: w.HTMLElement, configurable: true })
Object.defineProperty(g, 'DocumentFragment', { value: w.DocumentFragment, configurable: true })
Object.defineProperty(g, 'CustomEvent', { value: w.CustomEvent, configurable: true })
Object.defineProperty(g, 'Event', { value: w.Event, configurable: true })
Object.defineProperty(g, 'getComputedStyle', { value: w.getComputedStyle, configurable: true })
Object.defineProperty(g, 'screen', { value: w.screen, configurable: true })
Object.defineProperty(g, 'history', { value: w.history, configurable: true })
Object.defineProperty(g, 'URL', { value: w.URL, configurable: true })
Object.defineProperty(g, 'Image', { value: w.Image, configurable: true })
Object.defineProperty(g, 'MessageChannel', { value: w.MessageChannel, configurable: true })
Object.defineProperty(g, 'DOMParser', { value: w.DOMParser, configurable: true })
Object.defineProperty(g, 'atob', { value: w.atob, configurable: true })
Object.defineProperty(g, 'btoa', { value: w.btoa, configurable: true })

let importError = null
try {
  await import(pathToFileURL(esmPath).href)
} catch (e) {
  importError = e
} finally {
  rmSync(esmPath, { force: true })
}

// Laisser React monter et les effets se jouer.
for (let i = 0; i < 60; i++) await new Promise(r => setTimeout(r, 50))

const rootEl = w.document.getElementById('root')
const mounted = rootEl && rootEl.children.length > 0
const bootFetched = fetches.some(u => u.includes('/setup/info'))

const fail = []
if (importError) fail.push(`le bundle jette à l'import : ${importError.message}`)
if (!mounted) fail.push('React ne monte pas — #root vide')
if (!bootFetched) fail.push(`les fetches de boot ne partent pas (${fetches.length} fetch)`)

if (fail.length) {
  console.error(`✗ boot : ${fail.length} échec(s)`)
  for (const f of fail) console.error('  - ' + f)
  process.exit(1)
}
console.log(`✓ boot : bundle exécuté, React monté (${rootEl.children.length} racine(s)), fetches boot partis (${fetches.length})`)
