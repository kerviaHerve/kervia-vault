// Kervia-vault Coffre — script d'arrière-plan.
// ÉTAT : la clé du coffre ne vit QUE dans la mémoire de ce script.
// Rien n'est jamais persisté sur disque (pas même le coffre déchiffré) :
// storage.local ne contient QUE la config (serverUrl, extToken,
// autoLockMin, autoFill, lastUsed={idÉlément:epoch} — jamais un secret).
// Session : l'extension réutilise la session webui de l'onglet connecté
// à vault.kervia.ch (cookie av_session, host permission) — si elle a
// expiré, le popup invite à se reconnecter à la webui.
//
// Responsabilités v1.8.7 : déverrouillage/sync (token Bearer /ext/coffre),
// matching URL↔éléments, badge d'icône (LE signal passif — charte : aucune
// interface n'est jamais injectée dans les pages), auto-fill silencieux à
// l'ouverture, copie PERSISTANTE (l'effacement vit ici, pas dans le popup
// qui meurt en se fermant), menu contextuel, raccourci Ctrl+Shift+L,
// « Récents » (lastUsed).
'use strict'

// COFFRE vient de js/coffre-lib.js (chargé en premier dans le manifest
// — un var top-level y devient global). PAS de re-déclaration ici :
// un const COFFRE serait une redeclaration SyntaxError sous Firefox.

const state = {
  key: null,          // CryptoKey (unwrapped) — mémoire uniquement
  items: null,        // éléments déchiffrés (mémoire uniquement)
  unlockedAt: 0,
  serverUrl: 'https://vault.kervia.ch',
  extToken: '',       // token d'extension (créé dans la webui → Paramètres)
  autoLockMin: 5,     // 0 = jamais
  autoFill: 'off',   // 'off' | 'fill' — pré-remplissage à l'ouverture
  lastUsed: {},       // miroir storage : {idÉlément: epochMs} — pas un secret
  lastSyncAt: 0,      // epoch du dernier unlock/sync réussi
}

// ---- préférences ----
async function loadPrefs() {
  const p = await browser.storage.local.get(['serverUrl', 'autoLockMin', 'extToken', 'autoFill', 'lastUsed'])
  if (p.serverUrl) state.serverUrl = p.serverUrl.replace(/\/+$/, '')
  if (typeof p.autoLockMin === 'number') state.autoLockMin = p.autoLockMin
  if (typeof p.extToken === 'string') state.extToken = p.extToken.trim()
  // seule la valeur exacte 'fill' active le pré-remplissage ; tout le
  // reste (clé absente, typo, ancien format) = 'off' → sûr par défaut
  state.autoFill = p.autoFill === 'fill' ? 'fill' : 'off'
  if (p.lastUsed && typeof p.lastUsed === 'object' && !Array.isArray(p.lastUsed)) state.lastUsed = p.lastUsed
}

// Le badge et l'auto-fill réagissent aux chargements de pages, PAS aux
// messages du popup : sans ce miroir, un changement dans les options
// (ex. autoFill, serverUrl) ne serait visible qu'à la prochaine
// interaction avec le popup. On recharge la config à chaque écriture.
browser.storage.onChanged.addListener(() => { loadPrefs().catch(() => {}) })

// ---- verrou ----
function lock() {
  state.key = null
  state.items = null
  refreshActiveTabBadges() // verrouillé → badge vide, immédiatement
}
function unlocked() { return state.key !== null && state.items !== null }

// ---- auto-lock : inactivité mesurée depuis la dernière utilisation ----
setInterval(() => {
  if (unlocked() && state.autoLockMin > 0 &&
      Date.now() - state.unlockedAt > state.autoLockMin * 60000) {
    lock() // vide aussi le badge : verrouillé = aucun compteur visible
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
  state.lastSyncAt = state.unlockedAt
  refreshActiveTabBadges() // le badge s'allume sans attendre un changement d'onglet
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
  state.lastSyncAt = state.unlockedAt
  refreshActiveTabBadges() // les correspondances (et le badge) peuvent avoir changé
  return { count: items.length }
}

// ---- « Récents » : usage des éléments (lastUsed) ----
// Clé = ID d'élément (serveur), JAMAIS l'idx : l'idx bouge entre deux
// syncs (ajouts, tris), l'id est stable. Valeur = epoch uniquement —
// pas un secret, donc stockage local autorisé (contrat v1.8.7). C'est
// la seule trace tenue par l'extension, et elle ne contient que des
// ids opaques : rien à déchiffrer ni corréler pour qui lit le disque.
const LAST_USED_MAX = 100
function markLastUsed(itemId) {
  if (!itemId) return
  const lu = state.lastUsed
  lu[itemId] = Date.now()
  const keys = Object.keys(lu)
  if (keys.length > LAST_USED_MAX) {
    // borné : au-delà de 100, on supprime les plus anciennes
    keys.sort((a, b) => lu[a] - lu[b])
    for (let i = 0; i < keys.length - LAST_USED_MAX; i++) delete lu[keys[i]]
  }
  // fire-and-forget + silencieux : config non critique, et on ne
  // loggue jamais rien qui toucherait un élément utilisé
  browser.storage.local.set({ lastUsed: lu }).catch(() => {})
}

// ---- correspondances pour une URL ----
// Lignes SANS secrets (le popup les demande à la demande via 'secrets').
// Enrichies v1.8.7 : id (clé lastUsed, stable entre syncs), favorite
// (schéma v2 via normalizeItem) et lastUsedAt (tri « Récents »).
function itemsFor(url) {
  if (!unlocked()) return []
  const matched = []
  const items = state.items || []
  for (let i = 0; i < items.length; i++) {
    if (COFFRE.itemMatchesUrl(items[i], url)) matched.push(i)
  }
  return matched.map(i => ({
    idx: i,
    id: items[i].id,
    name: items[i].name,
    subtitle: COFFRE.itemSubtitle(items[i]),
    username: COFFRE.firstUsername(items[i]),
    hasTotp: !!COFFRE.firstTotp(items[i]),
    uri: COFFRE.firstLink(items[i]),
    favorite: !!items[i].favorite,
    lastUsedAt: state.lastUsed[items[i].id] || 0,
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
        id: items[i].id,
        name: items[i].name,
        subtitle: COFFRE.itemSubtitle(items[i]),
        username: COFFRE.firstUsername(items[i]),
        hasTotp: !!COFFRE.firstTotp(items[i]),
        uri: COFFRE.firstLink(items[i]),
        favorite: !!items[i].favorite,
        lastUsedAt: state.lastUsed[items[i].id] || 0,
      })
    }
  }
  return out.slice(0, 200) // popup : jamais plus de 200 lignes
}

// ---- onglet visé : jamais le coffre lui-même ni une page d'extension.
// Préférence : l'onglet actif du navigateur ; sinon (popup ouvert en
// onglet, tests automatisés) l'onglet web le plus récemment utilisé.
// Le guard serverUrl est INVARIANT : jamais de fill sur la webui du
// coffre, pour éviter toute confusion admin/maître.
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

// ---- envoi vers l'onglet : protocole responder-only (contrat A↔B) ----
// tabs.sendMessage SANS frameId → TOUTES les frames de l'onglet ; les
// frames sans champs pertinents répondent undefined (« pas de réponse »),
// la première frame qui TROUVE des champs répond {filled:{…}}. Ici, « pas
// de réponse » = receiving end absent OU que des undefined → null.
async function sendToFrames(tabId, msg) {
  try {
    const res = await browser.tabs.sendMessage(tabId, msg)
    return res || null
  } catch (e) {
    return null // « receiving end does not exist » : pas de content script
  }
}

// ---- remplissage manuel (popup / raccourci / menu) ----
// Pas de onlyIfEmpty : un fill manuel ÉCRASE (geste explicite). Les
// secrets ne partent QUE vers les frames de l'onglet visé, choisi par
// pickTargetTab qui exclut à jamais le coffre et les pages d'extension.
async function fill(idx) {
  const secrets = itemSecrets(idx)
  const it = (state.items || [])[idx]
  const tab = await pickTargetTab()
  if (!tab) throw new Error('no_form_page')
  if (!secrets.password && !secrets.username) throw new Error('no_credentials')
  const res = await sendToFrames(tab.id, {
    cmd: 'fill', username: secrets.username, password: secrets.password,
  })
  state.unlockedAt = Date.now() // l'interaction retarde l'auto-lock
  if (!res) throw new Error('no_form_page') // aucune frame n'a de champs (responder-only)
  const f = res.filled || {}
  if (f.username || f.password) markLastUsed(it && it.id) // « Récents » : par id, jamais par idx
  return res
}

// ---- remplissage 2FA : colle le code TOTP courant ----
// Le code est calculé ICI à la demande (jamais stocké) et ne part que
// vers les frames de l'onglet visé. Une frame qui possède un champ 2FA
// répond, les autres non → aucune réponse = pas de champ 2FA sur la page.
async function fillTotp(idx) {
  const secrets = itemSecrets(idx)
  const it = (state.items || [])[idx]
  if (!secrets.totpSeed) throw new Error('no_2fa_field') // élément sans TOTP
  const spec = COFFRE.parseTotp(secrets.totpSeed)
  const r = await COFFRE.totpNow(spec) // throw invalid_seed (seed illisible)
  const tab = await pickTargetTab()
  if (!tab) throw new Error('no_2fa_field')
  const res = await sendToFrames(tab.id, { cmd: 'fill-totp', code: r.code })
  if (!res) throw new Error('no_2fa_field') // responder-only : aucune frame n'a répondu
  state.unlockedAt = Date.now()
  markLastUsed(it && it.id)
  return res // {filled:…} — forme définie par le content script (contrat A↔B)
}

// ---- copie PERSISTANTE (correction du bug historique) ----
// Avant : le popup copiait ET programmait l'effacement chez lui — mais
// le popup MEURT à sa fermeture, son timer avec lui : la promesse
// « effacé du presse-papiers dans 30 s » était fausse depuis le début.
// Maintenant : le background (contexte persistant) copie ET efface.
// Un SEUL timer partagé, reprogrammé à chaque copie : seule la DERNIÈRE
// valeur copiée doit tenir 30 s (le presse-papiers n'en contient qu'une
// de toute façon) — une valeur antérieure n'est jamais prolongée.
let wipeTimer = null
async function copyWithWipe(text) {
  // clipboardWrite (manifest) : écriture possible depuis le background
  // sans focus ni user gesture
  await navigator.clipboard.writeText(text)
  if (wipeTimer) clearTimeout(wipeTimer)
  wipeTimer = setTimeout(() => {
    wipeTimer = null
    // effacement silencieux : jamais de log autour d'un secret (même
    // indirect — pas de valeur, pas de contexte, pas d'erreur tracée)
    navigator.clipboard.writeText('').catch(() => {})
  }, 30000)
}

// cmd 'copy' {kind:'username'|'password', idx} — origine : popup/options
// uniquement (pas d'externally_connectable, le content script n'émet
// jamais : les pages web ne peuvent pas déclencher une copie).
async function doCopy(kind, idx) {
  if (kind !== 'username' && kind !== 'password') throw new Error('bad_kind')
  const secrets = itemSecrets(idx)
  const text = kind === 'username' ? secrets.username : secrets.password
  if (!text) throw new Error('no_' + kind) // champ vide sur cet élément
  await copyWithWipe(text)
  return { ok: true }
}

// cmd 'copy-totp' {idx} — le code est éphémère (30 s max) mais la
// promesse d'effacement tient enfin, elle aussi.
async function doCopyTotp(idx) {
  const secrets = itemSecrets(idx)
  if (!secrets.totpSeed) throw new Error('no_totp')
  const spec = COFFRE.parseTotp(secrets.totpSeed)
  const r = await COFFRE.totpNow(spec) // throw invalid_seed
  await copyWithWipe(r.code)
  return { ok: true, code: r.code }
}

// ---- badge d'icône : LE signal passif ----
// Charte : rien n'est jamais injecté dans les pages — le badge du
// browserAction est donc le SEUL indicateur. Par onglet (tabId) : le
// compteur suit l'onglet, pas le coffre. Verrouillé → vide : on ne
// révèle pas même le nombre d'éléments d'un site coffre fermé.
// MV2 = browserAction (pas action). Erreurs tolérées en silence : le
// badge est un confort, jamais une erreur audible.
async function updateBadge(tab) {
  try {
    if (!tab || tab.id === undefined) return
    let text = ''
    // le badge promet « je peux remplir ici » → mêmes exclusions que
    // pickTargetTab : jamais le coffre lui-même, jamais les pages
    // internes (moz-extension:), jamais hors http(s) (about:, file:)
    if (unlocked() && tab.url && /^https?:/i.test(tab.url) &&
        !tab.url.startsWith('moz-extension:') && !tab.url.startsWith(state.serverUrl)) {
      const n = itemsFor(tab.url).length
      if (n > 0) text = String(n)
    }
    await browser.browserAction.setBadgeText({ tabId: tab.id, text })
    await browser.browserAction.setBadgeBackgroundColor({ tabId: tab.id, color: '#B8E263' })
    await browser.browserAction.setBadgeTextColor({ tabId: tab.id, color: '#171B19' })
  } catch (e) { /* onglet fermé / about: / moz-extension: : silencieux */ }
}

// après unlock/lock/syncNow : onglet actif de CHAQUE fenêtre (on ne
// attend pas un changement d'onglet pour rafraîchir le compteur)
function refreshActiveTabBadges() {
  browser.tabs.query({ active: true })
    .then(tabs => Promise.all((tabs || []).map(t => updateBadge(t))))
    .catch(() => {}) // silencieux
}

browser.tabs.onActivated.addListener(activeInfo => {
  // changement d'onglet actif : le badge suit (par tabId, jamais global)
  browser.tabs.get(activeInfo.tabId)
    .then(t => updateBadge(t))
    .catch(() => {}) // silencieux
})

// ---- auto-fill silencieux à l'ouverture de la page ----
// Pré-remplissage UNIQUEMENT si demandé (autoFill === 'fill', options)
// et coffre déverrouillé. EXACTEMENT 1 correspondance → on remplit
// sans geste ; 0 = rien à faire ; plusieurs = ambigu → on ne choisit
// PAS à la place de l'utilisateur, le badge l'invite à ouvrir le popup.
// onlyIfEmpty:true (contrat) : le content script n'écrase JAMAIS une
// saisie existante — le pré-remplissage ne peut rien détruire.
// Invariant sécurité : les secrets ne partent que si l'URL qui a
// déclenché le match est TOUJOURS celle de l'onglet au moment de
// l'envoi — re-vérifié avant le retry (navigation pendant les 1 200 ms
// = annulation, jamais d'envoi vers une autre page).
const autoFilledTabs = new Set() // tabIds déjà remplis POUR CE chargement
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function maybeAutoFill(tab) {
  if (state.autoFill !== 'fill' || !unlocked()) return
  if (!tab || !tab.url || !/^https?:/i.test(tab.url)) return
  if (tab.url.startsWith('moz-extension:')) return // pages internes : jamais
  if (tab.url.startsWith(state.serverUrl)) return   // le coffre lui-même : jamais
  if (autoFilledTabs.has(tab.id)) return           // déjà rempli pour ce chargement
  const matches = itemsFor(tab.url)
  if (matches.length !== 1) return
  autoFilledTabs.add(tab.id) // AVANT l'envoi : un 2ᵉ « complete » ne re-remplit pas
  const it = (state.items || [])[matches[0].idx]
  const username = COFFRE.firstUsername(it)
  const password = COFFRE.mainSecret(it)
  if (!username && !password) return
  let res = await sendToFrames(tab.id, { cmd: 'fill', username, password, onlyIfEmpty: true })
  if (!res) {
    // SPA : le formulaire peut être rendu tard — UN SEUL retry, pas de boucle
    await sleep(1200)
    const now = await browser.tabs.get(tab.id).catch(() => null)
    if (!now || now.url !== tab.url) return // navigué entre-temps : on annule tout
    res = await sendToFrames(tab.id, { cmd: 'fill', username, password, onlyIfEmpty: true })
  }
  if (res && res.filled && (res.filled.username || res.filled.password)) {
    markLastUsed(matches[0].id) // usage réel, même automatique → « Récents »
  }
}

// fin de chargement d'un onglet : badge + éventuel pré-remplissage
browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // navigation ou reload → NOUVEAU chargement : l'onglet redevient
  // éligible à l'auto-fill (le Set ne bloque que le MÊME chargement)
  if (changeInfo.url || changeInfo.status === 'loading') autoFilledTabs.delete(tabId)
  if (changeInfo.status !== 'complete') return
  updateBadge(tab).catch(() => {})
  maybeAutoFill(tab).catch(() => {})
})

browser.tabs.onRemoved.addListener(tabId => {
  autoFilledTabs.delete(tabId) // hygiène : pas de fuite d'ids d'onglets
})

// ---- routeur de messages (popup / options) ----
// Seuls le popup et les options (même extension) peuvent écrire ici :
// pas d'externally_connectable, et le content script n'émet jamais.
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
        autoFill: state.autoFill,     // préférence active (affichée par le popup)
        lastSyncAt: state.lastSyncAt, // « synchronisé il y a … »
      }
      case 'syncNow': return syncNow()
      case 'itemsFor': return { matches: itemsFor(msg.url) }
      case 'search': return { matches: search(msg.q) }
      case 'secrets': return itemSecrets(msg.idx)
      case 'fill': return fill(msg.idx)
      case 'fill-totp': return fillTotp(msg.idx)
      case 'copy': return doCopy(msg.kind, msg.idx)
      case 'copy-totp': return doCopyTotp(msg.idx)
      // copy-text{text} — texte LIBRE (générateur du popup) : même
      // effacement 30 s que les secrets — un mot de passe fraîchement
      // généré n'a pas vocation à traîner au presse-papiers non plus.
      // Le popup a un repli local si ce background ne connaît pas la
      // cmd (migration) — ici c'est le chemin complet.
      case 'copy-text': {
        const text = typeof msg.text === 'string' ? msg.text : ''
        if (!text) return { error: 'empty' }
        return copyWithWipe(text).then(() => ({ ok: true }))
      }
      default: throw new Error('unknown_cmd')
    }
  })
  return done.catch(e => ({ error: e.message }))
})

// ---- Ctrl+Shift+L / menu contextuel : remplir la page courante ----
// v2 : le raccourci clavier et le clic de menu sont des user gestures
// → openPopup() y est autorisé. Logique : verrouillé → popup (il mène
// au déverrouillage) ; 1 correspondance → remplissage direct ; 0 ou
// plusieurs → popup, car on ne choisit JAMAIS à la place de
// l'utilisateur (l'ancien code remplissait matches[0] en silence).
async function tryOpenPopup() {
  try { await browser.browserAction.openPopup() }
  catch (e) { /* indisponible (politique/version) : rien, silencieux */ }
}

async function doFillShortcut(hintTab) {
  if (!unlocked()) {
    await tryOpenPopup()
    return { skipped: 'locked' }
  }
  let tab = null
  if (hintTab && hintTab.url && /^https?:/i.test(hintTab.url) &&
      !hintTab.url.startsWith('moz-extension:')) {
    tab = hintTab // clic de menu : l'onglet du clic, pas une re-requête
  } else {
    const tabs = await browser.tabs.query({ active: true })
    tab = (tabs || []).find(t => t.url && /^https?:/i.test(t.url) && !t.url.startsWith('moz-extension:'))
  }
  if (!tab || tab.url.startsWith(state.serverUrl)) {
    await tryOpenPopup() // pas de cible remplissable → liste complète + recherche
    return { skipped: 'no_target' }
  }
  const matches = itemsFor(tab.url)
  if (matches.length !== 1) {
    // 0 = rien ; >1 = ambigu — l'utilisateur choisit dans le popup
    await tryOpenPopup()
    return { skipped: matches.length ? 'ambiguous' : 'no_match' }
  }
  return fill(matches[0].idx)
}

browser.commands.onCommand.addListener((name) => {
  if (name === 'fill-page') {
    loadPrefs().then(() => doFillShortcut()).catch(() => {})
  }
})

// ---- menu contextuel « Remplir depuis le coffre » ----
// Créé à CHAQUE démarrage du background (donc aussi à l'install) : les
// items de menu ne survivent PAS à un redémarrage du navigateur, les
// créer seulement dans onInstalled les ferait disparaître au reboot.
// removeAll d'abord : jamais de doublon d'id. Guard : si la permission
// contextMenus manque encore au manifest (transition), le reste
// fonctionne — le menu est un confort, pas une dépendance.
if (browser.contextMenus) {
  browser.contextMenus.removeAll()
    .then(() => {
      browser.contextMenus.create({
        id: 'fill-page',
        contexts: ['page', 'editable'], // la page entière ET les champs de saisie
        title: 'Remplir depuis le coffre (Ctrl+Shift+L)',
      })
    })
    .catch(() => {}) // silencieux : jamais bloquant
  // même logique que Ctrl+Shift+L (doFillShortcut v2)
  browser.contextMenus.onClicked.addListener((info, tab) => {
    loadPrefs().then(() => doFillShortcut(tab)).catch(() => {})
  })
}

// ---- première installation : ouvrir les options (URL serveur) ----
browser.runtime.onInstalled.addListener(details => {
  if (details.reason === 'install') {
    browser.tabs.create({ url: browser.runtime.getURL('options.html') })
  }
})
