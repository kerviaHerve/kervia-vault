// Kervia-vault Coffre — script d'arrière-plan.
// ÉTAT : la clé du coffre ne vit QUE dans la mémoire de ce script.
// Rien n'est jamais persisté sur disque (pas même le coffre déchiffré).
// Session : l'extension réutilise la session webui de l'onglet
// connecté à vault.kervia.ch (cookie av_session, host permission) —
// si elle a expiré, le popup invite à se reconnecter à la webui.
'use strict'

// COFFRE vient de js/coffre-lib.js (chargé en premier dans le manifest
// — un var top-level y devient global). PAS de re-déclaration ici :
// un const COFFRE serait une redeclaration SyntaxError sous Firefox.

const state = {
  key: null,          // CryptoKey (unwrapped)
  items: null,        // éléments déchiffrés (mémoire uniquement)
  unlockedAt: 0,
  serverUrl: 'https://vault.kervia.ch',
  extToken: '',       // token d'extension (créé dans la webui → Paramètres)
  autoLockMin: 5,     // 0 = jamais
}

// ---- préférences ----
async function loadPrefs() {
  const p = await browser.storage.local.get(['serverUrl', 'autoLockMin', 'extToken'])
  if (p.serverUrl) state.serverUrl = p.serverUrl.replace(/\/+$/, '')
  if (typeof p.autoLockMin === 'number') state.autoLockMin = p.autoLockMin
  if (typeof p.extToken === 'string') state.extToken = p.extToken.trim()
}

// ---- verrou ----
function lock() {
  state.key = null
  state.items = null
}
function unlocked() { return state.key !== null && state.items !== null }

// ---- auto-lock : inactivité mesurée depuis la dernière utilisation ----
setInterval(() => {
  if (unlocked() && state.autoLockMin > 0 &&
      Date.now() - state.unlockedAt > state.autoLockMin * 60000) {
    lock()
  }
}, 10000)

// ---- API (token d'extension — Bearer) ----
// Le token est créé dans la webui (Paramètres → Extension) et collé
// dans les options de l'extension. Il ne donne accès qu'aux blobs
// chiffrés du coffre (GET /ext/coffre) — aucune surface admin.
async function apiGet(path) {
  const res = await fetch(state.serverUrl + path, {
    credentials: 'omit',
    headers: state.extToken ? { 'Authorization': 'Bearer ' + state.extToken } : {},
  })
  if (res.status === 401 || res.status === 403) throw new Error(state.extToken ? 'invalid_token' : 'no_token')
  if (res.status === 404) {
    // distinguer coffre_not_created (mauvaise conf URL → route absente)
    const j = await res.json().catch(() => null)
    throw new Error(j && j.error === 'coffre_not_created' ? 'no_coffre' : 'server_404')
  }
  if (!res.ok) throw new Error('server_' + res.status)
  return res.json()
}

// ---- déverrouillage : enveloppe + items en UN aller-retour ----
async function unlock(password) {
  const pack = await apiGet('/ext/coffre')
  const key = await COFFRE.unlockEnvelope(pack.envelope, password) // throw wrong_password
  const items = []
  for (const it of (pack.items || [])) {
    try {
      const data = await COFFRE.decryptItem(key, it.blob_b64)
      items.push({ ...data, id: it.id, updated_at: it.updated_at })
    } catch (e) { /* blob illisible : ignoré (jamais affiché) */ }
  }
  state.key = key
  state.items = items
  state.unlockedAt = Date.now()
  return { count: items.length }
}

async function syncNow() {
  if (!unlocked()) throw new Error('locked')
  const pack = await apiGet('/ext/coffre')
  const items = []
  for (const it of (pack.items || [])) {
    try {
      const data = await COFFRE.decryptItem(state.key, it.blob_b64)
      items.push({ ...data, id: it.id, updated_at: it.updated_at })
    } catch (e) { /* ignore */ }
  }
  state.items = items
  state.unlockedAt = Date.now()
  return { count: items.length }
}

// ---- correspondances pour une URL ----
function itemsFor(url) {
  if (!unlocked()) return []
  const matched = []
  const items = state.items || []
  for (let i = 0; i < items.length; i++) {
    if (COFFRE.itemMatchesUrl(items[i], url)) matched.push(i)
  }
  return matched.map(i => ({
    idx: i,
    name: items[i].name,
    subtitle: COFFRE.itemSubtitle(items[i]),
    username: COFFRE.firstUsername(items[i]),
    hasTotp: !!COFFRE.firstTotp(items[i]),
    uri: COFFRE.firstLink(items[i]),
  }))
}

function itemSecrets(idx) {
  if (!unlocked()) throw new Error('locked')
  const it = (state.items || [])[idx]
  if (!it) throw new Error('bad_index')
  return {
    name: it.name,
    username: COFFRE.firstUsername(it),
    password: COFFRE.mainSecret(it),
    totpSeed: COFFRE.firstTotp(it),
    uri: COFFRE.firstLink(it),
  }
}

function search(q) {
  if (!unlocked()) return []
  const query = String(q || '').trim().toLowerCase()
  const items = state.items || []
  const out = []
  for (let i = 0; i < items.length; i++) {
    if (!query || COFFRE.itemSearchText(items[i]).includes(query)) {
      out.push({
        idx: i,
        name: items[i].name,
        subtitle: COFFRE.itemSubtitle(items[i]),
        username: COFFRE.firstUsername(items[i]),
        hasTotp: !!COFFRE.firstTotp(items[i]),
        uri: COFFRE.firstLink(items[i]),
      })
    }
  }
  return out.slice(0, 200) // popup : jamais plus de 200 lignes
}

// ---- remplissage : l'onglet visé (jamais une page du coffre ni une
// page d'extension — le vault lui-même n'est jamais rempli pour
// éviter la confusion admin/maître) ----
// ---- onglet visé : jamais le coffre lui-même ni une page d'extension.
// Préférence : l'onglet actif du navigateur ; sinon (popup ouvert en
// onglet, tests automatisés) l'onglet web le plus récemment utilisé.
async function pickTargetTab() {
  const tabs = await browser.tabs.query({})
  let best = null
  for (const t of tabs) {
    if (!t.url || !/^https?:/i.test(t.url) || t.url.startsWith('moz-extension:')) continue
    if (t.url.startsWith(state.serverUrl)) continue // jamais remplir le coffre lui-même
    if (t.active) return t // usage réel : l'onglet visité est l'actif
    if (!best || (t.lastAccessed || 0) > (best.lastAccessed || 0)) best = t // popup en onglet
  }
  return best
}

async function fill(idx) {
  const secrets = itemSecrets(idx)
  const tab = await pickTargetTab()
  if (!tab) throw new Error('no_form_page')
  if (!secrets.password && !secrets.username) throw new Error('no_credentials')
  try {
    const res = await browser.tabs.sendMessage(tab.id, {
      cmd: 'fill', username: secrets.username, password: secrets.password,
    })
    state.unlockedAt = Date.now()
    return res || { filled: false }
  } catch (e) {
    throw new Error('no_form_page')
  }
}

// ---- routeur de messages (popup / options) ----
browser.runtime.onMessage.addListener((msg) => {
  const done = loadPrefs().then(async () => {
    state.unlockedAt = Date.now() // toute interaction retarde l'auto-lock
    switch (msg.cmd) {
      case 'unlock': return unlock(msg.password)
      case 'lock': lock(); return { ok: true }
      case 'state': return {
        unlocked: unlocked(),
        count: state.items ? state.items.length : 0,
        serverUrl: state.serverUrl,
        hasToken: !!state.extToken,
        autoLockMin: state.autoLockMin,
      }
      case 'syncNow': return syncNow()
      case 'itemsFor': return { matches: itemsFor(msg.url) }
      case 'search': return { matches: search(msg.q) }
      case 'secrets': return itemSecrets(msg.idx)
      case 'fill': return fill(msg.idx)
      default: throw new Error('unknown_cmd')
    }
  })
  return done.catch(e => ({ error: e.message }))
})

// ---- raccourci Ctrl+Shift+L : remplir la page courante ----
// (le coffre doit être déverrouillé ; sinon rien — ouvre-le via Ctrl+Shift+K)
async function doFillShortcut() {
  if (!unlocked()) return { skipped: 'locked' }
  const tabs = await browser.tabs.query({ active: true })
  const tab = (tabs || []).find(t => t.url && /^https?:/i.test(t.url) && !t.url.startsWith('moz-extension:'))
  if (!tab || tab.url.startsWith(state.serverUrl)) return { skipped: 'no_target' }
  const matches = itemsFor(tab.url)
  if (!matches.length) return { skipped: 'no_match' }
  return fill(matches[0].idx)
}

browser.commands.onCommand.addListener((name) => {
  if (name === 'fill-page') {
    loadPrefs().then(() => doFillShortcut()).catch(() => {})
  }
})

// ---- première installation : ouvrir les options (URL serveur) ----
browser.runtime.onInstalled.addListener(details => {
  if (details.reason === 'install') {
    browser.tabs.create({ url: browser.runtime.getURL('options.html') })
  }
})