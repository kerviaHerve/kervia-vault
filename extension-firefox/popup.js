// Kervia-vault Coffre — popup (contrat v1.8.7).
// Déverrouillage, correspondances de la page, recherche, copies via
// background, TOTP vivant (page uniquement), générateur, remplissage,
// navigation clavier complète, L10N fr/en.
//
// Sécurité : les listes (itemsFor/search) ne contiennent JAMAIS de
// secrets — lignes enrichies {idx,name,subtitle,username,hasTotp,uri,
// favorite,lastUsedAt} (l'ancien secretsCache global est supprimé).
// TOUTES les copies passent par le background, qui programme
// l'effacement 30 s dans SON contexte persistant. Le seed TOTP ne
// transite que pour le TOTP vivant des correspondances de page (≤ 8).
'use strict'

// ---- icônes popup-only (runtime) -----------------------------------
// js/lucide.js est un fichier partagé (popup + options) assigné à un
// autre agent : on étend sa table ici — géométrie exacte lucide-static
// v0.548.0 — au lieu de modifier le fichier. Si la table venait à
// disparaître, lucide() rendrait son icône de repli (dégradation
// visuelle, pas de crash).
if (typeof LUCIDE_PATHS !== 'undefined') {
  LUCIDE_PATHS.star =
    '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.88 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.879-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>'
  LUCIDE_PATHS['loader-circle'] = '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>'
}

// ---- L10N (contrat : dict local fr/en, libellés webui en référence) --
const FR = {
  appTitle: 'Coffre',
  resync: 'Resynchroniser depuis le coffre',
  lock: 'Verrouiller',
  settings: 'Réglages',
  syncedNow: 'synchronisé à l’instant',
  syncedAgo: (n) => 'synchronisé il y a ' + n + ' min',
  syncFail: 'Échec de la synchronisation',
  lockedTitle: 'Coffre verrouillé',
  lockedHint: 'Déverrouillez le coffre avec votre mot de passe maître.',
  masterPw: 'Mot de passe maître',
  showHide: 'Afficher / masquer',
  capsOn: 'Majuscules activées',
  unlockBtn: 'Déverrouiller',
  needPw: 'Saisissez votre mot de passe maître.',
  unlockFail: 'Mot de passe maître incorrect.',
  noToken: 'Pas de token d’extension.',
  noTokenHint: 'Token manquant — créez-le dans la webui (Paramètres → Extension), puis collez-le dans les réglages de l’extension.',
  invalidToken: 'Token invalide ou révoqué — recréez-le dans la webui.',
  noCoffre: 'Aucun coffre sur ce serveur — créez-le dans la webui.',
  openSettings: 'Ouvrir les réglages',
  unavailable: 'Extension injoignable — rouvrez le popup.',
  errPrefix: 'Erreur',
  unlockedMsg: (n) => 'Déverrouillé — ' + n + (n !== 1 ? ' éléments' : ' élément'),
  searchPh: 'Rechercher…',
  kbdHint: 'Appuyez sur / pour rechercher',
  genTitle: 'Générateur de mots de passe',
  pageSection: 'Cette page',
  allItems: 'Tous les éléments',
  favFirst: 'Favoris en tête de liste',
  favorite: 'Favori',
  fill: 'Remplir',
  code: 'Code',
  codeTitle: 'Coller le code TOTP sur la page',
  copyUser: 'Copier l’identifiant',
  copyPass: 'Copier le mot de passe',
  copyTotp: 'Copier le code TOTP',
  openUri: 'Ouvrir le site',
  copied: 'Copié',
  copied30: 'Copié — effacé dans 30 s',
  copyFail: 'Copie impossible',
  filled: 'Rempli',
  totpPasted: 'Code collé',
  totpLeft: (n) => 'Expire dans ' + n + ' s',
  noForm: 'Aucun champ sur cette page',
  noCreds: 'Aucun identifiant dans cet élément',
  no2fa: 'Aucun champ 2FA trouvé',
  fieldsNotFound: 'Champs introuvables',
  emptySearch: 'Aucun résultat.',
  emptyVault: 'Coffre vide.',
  openVault: 'Ouvrir le coffre dans la webui',
  sessionExpired: 'Session webui expirée — reconnectez-vous',
  lockedToast: 'Coffre verrouillé',
  syncedMsg: (n) => 'Synchronisé — ' + n + (n !== 1 ? ' éléments' : ' élément'),
  genLen: 'Longueur',
  genRegen: 'Régénérer',
  genCopy: 'Copier',
}
const EN = {
  appTitle: 'Vault',
  resync: 'Resync from the vault',
  lock: 'Lock',
  settings: 'Settings',
  syncedNow: 'synced just now',
  syncedAgo: (n) => 'synced ' + n + ' min ago',
  syncFail: 'Sync failed',
  lockedTitle: 'Vault locked',
  lockedHint: 'Unlock the vault with your master password.',
  masterPw: 'Master password',
  showHide: 'Show / hide',
  capsOn: 'Caps Lock is on',
  unlockBtn: 'Unlock',
  needPw: 'Enter your master password.',
  unlockFail: 'Incorrect master password.',
  noToken: 'No extension token.',
  noTokenHint: 'Missing token — create one in the webapp (Settings → Extension), then paste it in the extension settings.',
  invalidToken: 'Invalid or revoked token — recreate it in the webapp.',
  noCoffre: 'No vault on this server — create one in the webapp.',
  openSettings: 'Open settings',
  unavailable: 'Extension unreachable — reopen the popup.',
  errPrefix: 'Error',
  unlockedMsg: (n) => 'Unlocked — ' + n + (n !== 1 ? ' items' : ' item'),
  searchPh: 'Search…',
  kbdHint: 'Press / to search',
  genTitle: 'Password generator',
  pageSection: 'This page',
  allItems: 'All items',
  favFirst: 'Favorites listed first',
  favorite: 'Favorite',
  fill: 'Fill',
  code: 'Code',
  codeTitle: 'Paste the TOTP code into the page',
  copyUser: 'Copy username',
  copyPass: 'Copy password',
  copyTotp: 'Copy TOTP code',
  openUri: 'Open website',
  copied: 'Copied',
  copied30: 'Copied — clears in 30 s',
  copyFail: 'Copy failed',
  filled: 'Filled',
  totpPasted: 'Code pasted',
  totpLeft: (n) => 'Expires in ' + n + ' s',
  noForm: 'No fields on this page',
  noCreds: 'This item has no credentials',
  no2fa: 'No 2FA field found',
  fieldsNotFound: 'Fields not found',
  emptySearch: 'No results.',
  emptyVault: 'Vault empty.',
  openVault: 'Open the vault in the webapp',
  sessionExpired: 'Webapp session expired — log in again',
  lockedToast: 'Vault locked',
  syncedMsg: (n) => 'Synced — ' + n + (n !== 1 ? ' items' : ' item'),
  genLen: 'Length',
  genRegen: 'Regenerate',
  genCopy: 'Copy',
}
const L = (navigator.language || '').toLowerCase().startsWith('en') ? EN : FR

// Hydrate les libellés statiques du HTML (data-i18n / -ph / -aria /
// -title) — tout le visible passe par le dict.
function applyI18n() {
  document.documentElement.lang = (navigator.language || '').toLowerCase().startsWith('en') ? 'en' : 'fr'
  document.title = L.appTitle
  for (const el of document.querySelectorAll('[data-i18n]')) {
    const v = L[el.dataset.i18n]
    if (typeof v === 'string') el.textContent = v
  }
  for (const el of document.querySelectorAll('[data-i18n-ph]')) {
    const v = L[el.dataset.i18nPh]
    if (typeof v === 'string') el.placeholder = v
  }
  for (const el of document.querySelectorAll('[data-i18n-aria]')) {
    const v = L[el.dataset.i18nAria]
    if (typeof v === 'string') el.setAttribute('aria-label', v)
  }
  // boutons icône-seule : aria-label = title
  for (const el of document.querySelectorAll('[data-i18n-title]')) {
    const v = L[el.dataset.i18nTitle]
    if (typeof v === 'string') {
      el.title = v
      if (!el.hasAttribute('aria-hidden')) el.setAttribute('aria-label', v)
    }
  }
}

// COFFRE vient de js/coffre-lib.js chargé avant popup.js dans popup.html
// (var top-level = global). PAS de re-déclaration (SyntaxError Firefox).
const $ = (id) => document.getElementById(id)
const send = (msg) => browser.runtime.sendMessage(msg)

let serverUrl = ''

// ---- toast (aria-live="polite" dans le HTML) ------------------------
function toast(text, icon = 'check', err = false) {
  const t = $('toast')
  t.textContent = ''
  t.classList.toggle('err', err)
  t.appendChild(lucide(icon, 13))
  const span = document.createElement('span')
  span.textContent = text
  t.appendChild(span)
  t.hidden = false
  clearTimeout(toast._t)
  toast._t = setTimeout(() => { t.hidden = true }, 2200)
}

// ---- copies : TOUTES via le background (contrat v1.8.7) -------------
// copy{kind,idx} / copy-totp{idx} : le background lit les secrets,
// copie, et programme l'effacement 30 s DANS SON CONTEXTE PERSISTANT —
// un timer côté popup mourrait avec lui à la fermeture (bug
// historique : l'effacement annoncé était une fausse promesse).
// Retour {ok:true}.
//
// fill-totp{idx} : colle le code TOTP courant dans le champ 2FA de la
// page → {filled} ou {error:'no_2fa_field'}.
//
// AJOUT AU CONTRAT (défini ici, côté popup) : copy-text{text} — copie
// un texte LIBRE (générateur) avec le même effacement 30 s, retour
// {ok:true}. Compat : si le background déployé ne connaît pas encore
// copy-text ({error:'unknown_cmd'} pendant la migration), repli LOCAL
// navigator.clipboard SANS promesse d'effacement (le timer du popup ne
// survit pas à sa fermeture) → toast « Copié » nu. Ce repli n'existe
// QUE pour le générateur : les secrets du coffre, eux, ne transitent
// jamais par le popup.
async function copyItem(kind, idx) {
  const res = await send({ cmd: 'copy', kind, idx }).catch(() => null)
  if (res && res.ok) toast(L.copied30, kind === 'username' ? 'user' : 'key-round')
  else toast(L.copyFail, 'x', true)
}

async function copyTotp(idx) {
  const res = await send({ cmd: 'copy-totp', idx }).catch(() => null)
  if (res && res.ok) toast(L.copied30, 'timer')
  else toast(L.copyFail, 'x', true)
}

async function copyText(text) {
  if (!text) return
  const res = await send({ cmd: 'copy-text', text }).catch(() => null)
  if (res && res.ok) { toast(L.copied30, 'copy'); return }
  try {
    await navigator.clipboard.writeText(text)
    toast(L.copied, 'copy')
  } catch (e) { toast(L.copyFail, 'x', true) }
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

// ---- écrans ---------------------------------------------------------
function showUnlocked(on) {
  $('locked').hidden = on
  $('main').hidden = !on
  $('btn-lock').hidden = !on
}

function showErr(msg) {
  const e = $('unlock-err')
  const inp = $('master')
  if (!msg) {
    e.hidden = true
    e.textContent = ''
    inp.removeAttribute('aria-invalid')
    return
  }
  // texte AVANT affichage : role="alert" annonce le message une fois
  e.textContent = msg
  e.hidden = false
  inp.setAttribute('aria-invalid', 'true')
  inp.focus()
}

function showNoTokenHint(on) {
  $('session-hint').hidden = !on
  $('btn-open-options').hidden = !on
}

async function refreshState() {
  const st = await send({ cmd: 'state' }).catch(() => null)
  if (!st) return
  serverUrl = st.serverUrl || ''
  $('server-label').textContent = serverUrl.replace(/^https?:\/\//, '')
  // lastSyncAt (contrat) : « synchronisé il y a X min » en info-bulle
  const mins = st.lastSyncAt ? Math.floor((Date.now() - st.lastSyncAt) / 60000) : -1
  const syncTxt = mins < 0 ? '' : (mins < 1 ? L.syncedNow : L.syncedAgo(mins))
  $('server-label').title = serverUrl + (syncTxt ? ' — ' + syncTxt : '')
  if (st.unlocked) {
    showUnlocked(true)
    await renderMatches()
    await renderAll($('search').value)
  } else {
    showUnlocked(false)
    showNoTokenHint(st.hasToken === false)
    $('master').focus()
  }
}

// ---- tri (contrat) : favoris d'abord (étoile), puis récemment
// utilisés (lastUsedAt desc), puis alphabétique. Les correspondances
// de la page suivent la même clé (favoris, puis usage récent).
const favRank = (m) => (m && m.favorite) ? 1 : 0
const usedAt = (m) => (m && m.lastUsedAt) || 0
const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' })
const byRow = (a, b) => (favRank(b) - favRank(a)) || (usedAt(b) - usedAt(a)) || byName(a, b)

function setListRole(el, on) {
  if (on) el.setAttribute('role', 'list')
  else el.removeAttribute('role')
}

// titre de section : étoile favori (légende) + compteur d'éléments
function sectionTitle(el, label, count, star) {
  el.textContent = ''
  if (star) {
    const s = lucide('star', 11, 'fav')
    s.title = L.favFirst
    s.setAttribute('aria-hidden', 'true')
    el.appendChild(s)
  }
  const t = document.createElement('span')
  t.textContent = label
  el.appendChild(t)
  const c = document.createElement('span')
  c.className = 'count'
  c.textContent = String(count)
  c.setAttribute('aria-hidden', 'true')
  el.appendChild(c)
  el.setAttribute('aria-label', label + ' — ' + count)
}

// ---- correspondances de la page courante (≤ 8) ----------------------
async function renderMatches() {
  stopPageTotp()
  const tab = await currentTab()
  const res = await send({ cmd: 'itemsFor', url: tab ? tab.url : '' }).catch(() => null)
  const list = ((res && res.matches) || []).slice(0, 8)
  const box = $('page-section')
  const el = $('matches')
  el.textContent = ''
  if (!tab || !list.length) {
    box.hidden = true
    setListRole(el, false)
    return
  }
  box.hidden = false
  setListRole(el, true)
  sectionTitle($('page-title'), L.pageSection, list.length, false)
  for (const m of list.slice().sort(byRow)) {
    const row = itemRow(m, { forPage: true })
    el.appendChild(row)
    // secrets{idx} : UNIQUEMENT pour le TOTP vivant des correspondances
    // de page (≤ 8) — jamais pour la liste générale.
    if (m.hasTotp) {
      const sec = await send({ cmd: 'secrets', idx: m.idx }).catch(() => null)
      if (row._totpBtn && sec && sec.totpSeed) tickTotp(row._totpBtn, sec.totpSeed)
      else if (row._totpBtn) row._totpBtn.remove()
    }
  }
}

// ---- liste complète (triée, sans secrets) ---------------------------
async function renderAll(q) {
  const res = await send({ cmd: 'search', q }).catch(() => null)
  const list = (res && res.matches) || []
  const el = $('all-items')
  el.textContent = ''
  if (!list.length) {
    setListRole(el, false)
    const empty = document.createElement('div')
    empty.className = 'empty'
    if (q) {
      // aucun résultat de recherche — message simple
      empty.appendChild(lucide('search', 22))
      const p = document.createElement('span')
      p.textContent = L.emptySearch
      empty.appendChild(p)
    } else {
      // coffre vide — CTA vers la webui
      empty.appendChild(lucide('vault', 22))
      const p = document.createElement('span')
      p.textContent = L.emptyVault
      empty.appendChild(p)
      if (serverUrl) {
        const cta = document.createElement('button')
        cta.className = 'cta'
        cta.textContent = L.openVault
        cta.onclick = () => browser.tabs.create({ url: serverUrl + '/ui/#coffre' })
        empty.appendChild(cta)
      }
    }
    el.appendChild(empty)
    sectionTitle($('all-title'), L.allItems, 0, true)
    return
  }
  setListRole(el, true)
  sectionTitle($('all-title'), L.allItems, list.length, true)
  for (const m of list.slice().sort(byRow).slice(0, 100)) {
    el.appendChild(itemRow(m, { forPage: false }))
  }
}

// ---- une ligne d'élément (aucun secret ici) -------------------------
function actionBtn(icon, label, fn) {
  const b = document.createElement('button')
  b.className = 'icon-btn'
  b.title = label
  b.setAttribute('aria-label', label)
  b.appendChild(lucide(icon, 14))
  b.onclick = fn
  return b
}

function itemRow(m, opts) {
  const row = document.createElement('div')
  row.className = 'item'
  row.tabIndex = -1
  row.setAttribute('role', 'listitem')
  row.setAttribute('aria-label',
    String(m.name || '') +
    (m.favorite ? ' — ' + L.favorite : '') +
    (m.subtitle ? ' — ' + m.subtitle : ''))

  if (m.favorite) {
    const s = lucide('star', 13, 'fav')
    s.title = L.favorite
    s.setAttribute('aria-hidden', 'true')
    row.appendChild(s)
  }

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

  // Remplir — PRIMAIRE citron, correspondances de page uniquement.
  let fillBtn = null
  const doFill = async () => {
    const res = await send({ cmd: 'fill', idx: m.idx }).catch(() => null)
    if (!res || res.error === 'no_form_page') { toast(L.noForm, 'x', true); return }
    if (res.error === 'no_credentials') { toast(L.noCreds, 'x', true); return }
    const f = res.filled
    const ok = f === true || !!(f && (f.username || f.password))
    if (!ok) { toast(L.fieldsNotFound, 'x', true); return }
    toast(L.filled, 'check')
    // fill réussi + TOTP → bouton « Code » : remplit le champ 2FA de
    // la page via fill-totp (background → content script).
    if (m.hasTotp && !row._codeBtn) {
      const cb = document.createElement('button')
      cb.className = 'btn-code'
      cb.textContent = L.code
      cb.title = L.codeTitle
      cb.setAttribute('aria-label', L.codeTitle)
      row._codeBtn = cb
      cb.onclick = async () => {
        const r = await send({ cmd: 'fill-totp', idx: m.idx }).catch(() => null)
        if (r && r.error === 'no_2fa_field') toast(L.no2fa, 'x', true)
        else if (r && r.error === 'no_form_page') toast(L.noForm, 'x', true)
        else if (r && r.filled) toast(L.totpPasted, 'check')
        else toast(L.no2fa, 'x', true)
      }
      actions.insertBefore(cb, fillBtn.nextSibling)
    }
  }

  if (opts.forPage) {
    fillBtn = document.createElement('button')
    fillBtn.className = 'primary small'
    fillBtn.textContent = L.fill
    fillBtn.onclick = doFill
    actions.appendChild(fillBtn)
    row._main = doFill
  } else {
    row._main = () => copyItem('password', m.idx)
  }

  if (m.username) actions.appendChild(actionBtn('user', L.copyUser, () => copyItem('username', m.idx)))
  actions.appendChild(actionBtn('key-round', L.copyPass, () => copyItem('password', m.idx)))

  if (m.hasTotp) {
    if (opts.forPage) {
      // TOTP vivant (page uniquement) : bouton cliquable, la copie
      // passe par copy-totp (background). Le seed est injecté ensuite
      // par renderMatches (≤ 8 lignes).
      const t = document.createElement('button')
      t.className = 'totp mono'
      t.textContent = '···'
      t.title = L.copyTotp
      t.setAttribute('aria-label', L.copyTotp)
      t.onclick = () => copyTotp(m.idx)
      actions.appendChild(t)
      row._totpBtn = t
    } else {
      // liste générale : copie du code courant via le background,
      // jamais de seed ni de code vivant dans la liste.
      actions.appendChild(actionBtn('timer', L.copyTotp, () => copyTotp(m.idx)))
    }
  }

  if (m.uri && /^https?:/i.test(m.uri)) {
    actions.appendChild(actionBtn('external-link', L.openUri, () => browser.tabs.create({ url: m.uri })))
  }

  row.appendChild(actions)

  // Entrée sur la ligne = action principale : Remplir (page), sinon
  // copier le mot de passe. Les boutons restent focusables (Tab).
  row.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && ev.target === row && row._main) {
      ev.preventDefault()
      row._main()
    }
  })
  return row
}

// ---- TOTP vivant (page uniquement, tant que le popup est ouvert) ----
const pageTotpTimers = new Set()
function stopPageTotp() {
  for (const i of pageTotpTimers) clearInterval(i)
  pageTotpTimers.clear()
}
addEventListener('unload', stopPageTotp)

function tickTotp(el, seed) {
  let spec
  try { spec = COFFRE.parseTotp(seed) } catch (e) { el.textContent = '—'; return }
  let alive = true
  let i = 0
  const run = async () => {
    if (!alive) return
    try {
      const { code, remaining } = await COFFRE.totpNow(spec)
      if (!alive) return
      const half = Math.ceil(spec.digits / 2)
      el.textContent = code.slice(0, half) + ' ' + code.slice(half)
      el.title = L.totpLeft(remaining)
    } catch (e) {
      alive = false
      clearInterval(i)
      el.textContent = '—'
    }
  }
  run()
  i = setInterval(run, 1000)
  pageTotpTimers.add(i)
}

// ---- déverrouillage --------------------------------------------------
async function doUnlock() {
  const inp = $('master')
  const pw = inp.value
  if (!pw) { showErr(L.needPw); return }
  $('btn-unlock').disabled = true
  showErr('')
  try {
    const res = await send({ cmd: 'unlock', password: pw }).catch(() => null)
    if (!res) { showErr(L.unavailable); return }
    if (res.error === 'wrong_password') { showErr(L.unlockFail); return }
    if (res.error === 'no_token') { showErr(L.noToken); showNoTokenHint(true); return }
    if (res.error === 'invalid_token') { showErr(L.invalidToken); return }
    if (res.error === 'no_coffre') { showErr(L.noCoffre); return }
    if (res.error) { showErr(L.errPrefix + ' : ' + res.error); return }
    inp.value = ''
    showNoTokenHint(false)
    await refreshState()
    toast(L.unlockedMsg(res.count || 0), 'lock-open')
  } finally {
    $('btn-unlock').disabled = false
  }
}

$('btn-unlock').onclick = doUnlock
$('master').addEventListener('keydown', (e) => { if (e.key === 'Enter') doUnlock() })

// Caps Lock (getModifierState) — uniquement quand le champ est masqué
function capsCheck(e) {
  if (typeof e.getModifierState !== 'function') return
  const on = e.getModifierState('CapsLock') && $('master').type === 'password'
  $('caps-hint').hidden = !on
}
$('master').addEventListener('keydown', capsCheck)
$('master').addEventListener('keyup', capsCheck)

// afficher / masquer le mot de passe maître
$('btn-eye').onclick = () => {
  const inp = $('master')
  const show = inp.type === 'password'
  inp.type = show ? 'text' : 'password'
  $('btn-eye').setAttribute('aria-pressed', String(show))
  $('btn-eye').replaceChildren(lucide(show ? 'eye-off' : 'eye', 14))
  inp.focus()
}

$('btn-open-options').onclick = () => browser.runtime.openOptionsPage()
$('btn-lock').onclick = async () => {
  await send({ cmd: 'lock' }).catch(() => {})
  showUnlocked(false)
  $('master').focus()
}
$('btn-options').onclick = () => browser.runtime.openOptionsPage()

// synchro : état busy (spinner + disabled), toast « Synchronisé — N »
$('btn-sync').onclick = async () => {
  const b = $('btn-sync')
  if (b.disabled) return
  b.disabled = true
  b.replaceChildren(lucide('loader-circle', 16, 'spin'))
  try {
    const res = await send({ cmd: 'syncNow' }).catch(() => null)
    if (res && !res.error) {
      toast(L.syncedMsg(res.count || 0), 'check')
      await refreshState()
    } else if (res && res.error === 'no_session') {
      toast(L.sessionExpired, 'x', true)
    } else if (res && res.error === 'locked') {
      showUnlocked(false)
      toast(L.lockedToast, 'lock', true)
    } else {
      toast(L.syncFail, 'x', true)
    }
  } finally {
    b.disabled = false
    b.replaceChildren(lucide('refresh-cw'))
  }
}

// ---- recherche (debounce) -------------------------------------------
let searchT = null
$('search').addEventListener('input', () => {
  clearTimeout(searchT)
  searchT = setTimeout(() => renderAll($('search').value), 150)
})

// ---- clavier complet -------------------------------------------------
// « / » focus la recherche ; ↑/↓ parcourent les lignes (roving focus,
// class .focused) ; Échap vide la recherche ; Entrée sur une ligne =
// action principale. Les boutons restent focusables (Tab).
function visibleRows() {
  return Array.from(document.querySelectorAll('#matches .item, #all-items .item'))
}

document.addEventListener('keydown', (e) => {
  if ($('main').hidden) return
  if (e.key === '/' && !(e.target.closest && e.target.closest('input'))) {
    e.preventDefault()
    const s = $('search')
    s.focus()
    s.select()
    return
  }
  if (e.key === 'Escape') {
    const s = $('search')
    if (s.value) { s.value = ''; renderAll('') }
    else if (document.activeElement === s) s.blur()
    return
  }
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
  const inSearch = e.target === $('search')
  const inRows = !!(e.target.closest && e.target.closest('.items'))
  if (!inSearch && !inRows) return
  const rows = visibleRows()
  if (!rows.length) return
  e.preventDefault()
  const cur = inSearch ? -1 : rows.indexOf(e.target.closest('.item'))
  const next = e.key === 'ArrowDown' ? cur + 1 : cur - 1
  if (next < 0) { $('search').focus(); return }
  if (next >= rows.length) return
  rows[next].focus()
  rows[next].scrollIntoView({ block: 'nearest' })
})

// roving focus : la ligne (ou le bouton focusé) porte .focused
document.addEventListener('focusin', (e) => {
  const it = e.target.closest && e.target.closest('.item')
  for (const r of document.querySelectorAll('.item.focused')) r.classList.remove('focused')
  if (it) it.classList.add('focused')
})

// ---- générateur ------------------------------------------------------
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
$('gen-copy').onclick = () => copyText($('gen-out').textContent)

// ---- init ------------------------------------------------------------
applyI18n()
refreshState()
