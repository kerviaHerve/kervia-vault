// Kervia-vault Coffre — popup : déverrouillage, correspondances de la
// page courante, recherche, copie, TOTP vivant, générateur, remplissage.
'use strict'

// COFFRE vient de js/coffre-lib.js chargé avant popup.js dans popup.html
// (var top-level = global). PAS de re-déclaration (SyntaxError Firefox).
const $ = (id) => document.getElementById(id)
const send = (msg) => browser.runtime.sendMessage(msg)

// état popup : correspondances {idx: {username, password, totpSeed, uri}}
const secretsCache = new Map()
let currentPageUrl = ''

function toast(text) {
  const t = $('toast')
  t.textContent = text
  t.hidden = false
  clearTimeout(toast._t)
  toast._t = setTimeout(() => { t.hidden = true }, 1600)
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text)
    toast('Copié — effacé du presse-papier dans 30 s')
    setTimeout(() => {
      if (document.hasFocus()) navigator.clipboard.writeText('').catch(() => {})
    }, 30000)
  } catch (e) { toast('Copie impossible') }
}

// ---- onglet visé : même logique que le background (actif web, sinon
// dernier onglet web utilisé) — le coffre et les pages d'extension
// ne sont jamais des cibles.
async function currentTab() {
  const st = await send({ cmd: 'state' }).catch(() => null)
  const tabs = await browser.tabs.query({})
  let best = null
  for (const t of tabs) {
    if (!t.url || !/^https?:/i.test(t.url) || t.url.startsWith('moz-extension:')) continue
    if (st && t.url.startsWith(st.serverUrl)) continue
    if (t.active) return t
    if (!best || (t.lastAccessed || 0) > (best.lastAccessed || 0)) best = t
  }
  return best
}

// ---- écrans ----
function showUnlocked(on) {
  $('locked').hidden = on
  $('main').hidden = !on
  $('btn-lock').hidden = !on
}

function showErr(msg) {
  const e = $('unlock-err')
  if (!msg) { e.hidden = true; return }
  e.textContent = msg
  e.hidden = false
}

async function refreshState() {
  const st = await send({ cmd: 'state' })
  $('server-label').textContent = st.serverUrl.replace(/^https?:\/\//, '')
  if (st.unlocked) {
    showUnlocked(true)
    await renderMatches()
    await renderAll('')
  } else {
    showUnlocked(false)
    $('master').focus()
  }
}

// ---- correspondances de la page courante ----
async function renderMatches() {
  const tab = await currentTab()
  currentPageUrl = tab ? tab.url : ''
  const res = await send({ cmd: 'itemsFor', url: currentPageUrl })
  const box = $('page-section')
  const list = $('matches')
  list.textContent = ''
  if (!tab || !res.matches.length) { box.hidden = true; return }
  box.hidden = false
  for (const m of res.matches.slice(0, 8)) {
    list.appendChild(await itemRow(m, { forPage: true }))
  }
}

async function renderAll(q) {
  const res = await send({ cmd: 'search', q })
  const box = $('all-items')
  box.textContent = ''
  if (!res.matches.length) {
    const p = document.createElement('p')
    p.className = 'hint small'
    p.textContent = q ? 'Aucun résultat.' : 'Coffre vide.'
    box.appendChild(p)
    return
  }
  for (const m of res.matches.slice(0, 100)) {
    box.appendChild(await itemRow(m, { forPage: false }))
  }
}

// ---- une ligne d'élément ----
async function itemRow(m, opts) {
  const secrets = await send({ cmd: 'secrets', idx: m.idx }).catch(() => null)
  if (!secrets) return document.createElement('div')
  secretsCache.set(m.idx, secrets)

  const row = document.createElement('div')
  row.className = 'item'

  const info = document.createElement('div')
  info.className = 'item-info'
  const name = document.createElement('div')
  name.className = 'item-name'
  name.textContent = m.name
  const sub = document.createElement('div')
  sub.className = 'item-sub'
  sub.textContent = m.subtitle || m.uri || ''
  info.appendChild(name)
  info.appendChild(sub)
  row.appendChild(info)

  const actions = document.createElement('div')
  actions.className = 'item-actions'

  // remplissage (page courante uniquement)
  if (opts.forPage && (secrets.password || secrets.username)) {
    const b = document.createElement('button')
    b.className = 'primary small'
    b.textContent = 'Remplir'
    b.onclick = async () => {
      const res = await send({ cmd: 'fill', idx: m.idx })
      if (res && res.error === 'no_form_page') toast('Aucun champ de formulaire sur cette page')
      else if (res && (res.filled || res.password)) toast('Rempli')
      else toast('Champs introuvables')
    }
    actions.appendChild(b)
  }

  if (secrets.username) {
    actions.appendChild(actionBtn('⧉', 'Copier l\'identifiant', () => copy(secrets.username)))
  }
  if (secrets.password) {
    actions.appendChild(actionBtn('🔑', 'Copier le mot de passe', () => copy(secrets.password)))
  }
  if (secrets.totpSeed) {
    const totp = document.createElement('span')
    totp.className = 'totp mono'
    actions.appendChild(totp)
    tickTotp(totp, secrets.totpSeed)
  }
  if (secrets.uri) {
    actions.appendChild(actionBtn('↗', 'Ouvrir', () => browser.tabs.create({ url: secrets.uri })))
  }
  row.appendChild(actions)
  return row
}

function actionBtn(label, title, fn) {
  const b = document.createElement('button')
  b.className = 'icon-btn'
  b.textContent = label
  b.title = title
  b.onclick = fn
  return b
}

// TOTP vivant (tant que le popup est ouvert)
function tickTotp(el, seed) {
  const spec = COFFRE.parseTotp(seed)
  let alive = true
  const run = async () => {
    if (!alive) return
    try {
      const { code, remaining } = await COFFRE.totpNow(spec)
      if (!alive) return
      const half = Math.ceil(spec.digits / 2)
      el.textContent = code.slice(0, half) + ' ' + code.slice(half)
      el.title = remaining + ' s'
    } catch (e) { el.textContent = '—' }
  }
  run()
  const i = setInterval(run, 1000)
  addEventListener('unload', () => { alive = false; clearInterval(i) })
  tickTotp._timers = (tickTotp._timers || []).concat([i, () => { alive = false }])
}
tickTotp._timers = []

// ---- déverrouillage ----
async function doUnlock() {
  const pw = $('master').value
  if (!pw) return
  $('btn-unlock').disabled = true
  showErr('')
  const res = await send({ cmd: 'unlock', password: pw })
  $('btn-unlock').disabled = false
  if (res.error === 'wrong_password') { showErr('Mot de passe maître incorrect.'); return }
  if (res.error === 'no_token') {
    showErr('Pas de token d\'extension.')
    $('session-hint').hidden = false
    $('session-url').textContent = 'webui → Paramètres → Extension'
    browser.tabs.create({ url: 'https://vault.kervia.ch/ui/#settings' })
    return
  }
  if (res.error === 'invalid_token') { showErr('Token invalide ou révoqué — recrée-le dans la webui.'); return }
  if (res.error === 'no_coffre') { showErr('Aucun coffre sur ce serveur — crée-le dans la webui.'); return }
  if (res.error) { showErr('Erreur : ' + res.error); return }
  $('master').value = ''
  await refreshState()
}

$('btn-unlock').onclick = doUnlock
$('master').addEventListener('keydown', e => { if (e.key === 'Enter') doUnlock() })

$('btn-lock').onclick = async () => { await send({ cmd: 'lock' }); showUnlocked(false) }
$('btn-options').onclick = () => browser.runtime.openOptionsPage()
$('btn-sync').onclick = async () => {
  const res = await send({ cmd: 'syncNow' })
  if (res && !res.error) { toast('Synchronisé (' + res.count + ')'); await renderMatches(); await renderAll($('search').value) }
  else if (res && res.error === 'no_session') toast('Session webui expirée — reconnecte-toi')
  else if (res && res.error === 'locked') { showUnlocked(false); toast('Coffre verrouillé') }
}

let searchT = null
$('search').addEventListener('input', () => {
  clearTimeout(searchT)
  searchT = setTimeout(() => renderAll($('search').value), 150)
})

// ---- générateur ----
const genOpts = () => ({
  length: Number($('gen-len').value),
  upper: $('gen-upper').checked, lower: true,
  digits: $('gen-digits').checked, symbols: $('gen-symbols').checked,
})
function regen() {
  $('gen-out').textContent = COFFRE.generatePassword(genOpts())
  $('gen-len-val').textContent = $('gen-len').value
}
$('btn-generator').onclick = () => {
  const g = $('generator')
  g.hidden = !g.hidden
  if (!g.hidden) regen()
}
$('gen-len').addEventListener('input', regen)
$('gen-regen').onclick = regen
$('gen-copy').onclick = () => copy($('gen-out').textContent)

refreshState()