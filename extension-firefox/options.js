// Kervia-vault Coffre — options : Connexion (URL serveur + token),
// Sécurité (auto-lock), Remplissage (auto-fill, v1.8.7), À propos.
// L10N fr/en locale (contrat v1.8.7 : petit dict par page, ~40 chaînes,
// pas de système complet) — libellés alignés sur la webui (ext*/cof*).
'use strict'

const $ = (id) => document.getElementById(id)

// ---- L10N : dict local par page (contrat) ----
// FR fait foi (langue de référence du projet) ; EN suit les libellés
// serveur de la webui (Paramètres → Extension Firefox).
const FR = {
  title: 'Coffre — réglages',
  sub: "L'extension accède au coffre via un token dédié : crée-le dans la webui (Paramètres → Extension Firefox), colle-le ci-dessous, puis déverrouille depuis l'icône.",
  secConn: 'Connexion',
  urlLabel: 'URL du serveur (webui)',
  urlPh: 'https://vault.kervia.ch',
  tokenLabel: "Token d'extension",
  tokenPh: 'kvext_…',
  tokenHelp: "Crée-le dans la webui → Paramètres → Extension Firefox → « Créer le token », puis colle-le ici. Il ne donne accès qu'aux blobs chiffrés du coffre — sans le mot de passe maître, il ne révèle rien.",
  eyeLabel: 'Afficher / masquer le token',
  testConn: 'Tester la connexion',
  testTokenBtn: 'Tester le token',
  urlNote: "Une URL autre que vault.kervia.ch demandera une permission d'origine à l'enregistrement.",
  // validations inline
  urlOk: 'URL valide (https).',
  urlInvalid: "https:// requis — colle l'URL complète de la webui.",
  urlHttpWarn: 'http:// : trafic en clair — le coffre chiffré transite, mais le token aussi.',
  tokenShape: "Un token d'extension commence par kvext_ — recrée-le dans la webui si besoin.",
  tokenMissing: "Colle d'abord le token (kvext_…).",
  testing: 'Test en cours…',
  // test connexion (pile complète : serveur → coffre → token)
  testReachableNoToken: "Serveur joignable — colle maintenant le token d'extension, puis teste-le.",
  testOk: 'Serveur joignable — coffre présent, token valide (%n items).',
  testTokenInvalid: 'Serveur joignable — token invalide ou révoqué.',
  testTokenNoCoffre: 'Serveur joignable — token valide, mais aucun coffre : crée-le dans la webui.',
  testUnreachable: "Injoignable — vérifie l'URL (et que le serveur tourne).",
  testHttp: "Réponse %n — vérifie l'URL.",
  testRoute404: "Route /ext/coffre introuvable — vérifie que l'URL pointe bien un serveur kervia-vault.",
  // test token (ciblé : GET /ext/coffre avec Bearer)
  tokenValid: 'Token valide — coffre accessible (%n items).',
  tokenInvalid: 'Token invalide ou révoqué — recrée-le dans la webui.',
  tokenNoCoffre: 'Token valide mais aucun coffre — crée-le dans la webui.',
  // sécurité
  secSecu: 'Sécurité',
  autoLockLabel: 'Verrouillage automatique après inactivité',
  al1: '1 min', al5: '5 min', al15: '15 min', al60: '60 min', al0: 'Jamais',
  secZero: "Zero-knowledge : le mot de passe maître et la clé ne vivent qu'en mémoire, jamais sur disque.",
  secNoInject: "Aucune interface n'est jamais injectée dans les pages web (ni icône dans les champs, ni bulle) : le remplissage n'agit que sur ton action dans le popup ou via Ctrl+Shift+L.",
  secBgMemory: "Le coffre déchiffré reste dans le processus d'arrière-plan ; verrouillage auto après inactivité.",
  secLocalOnly: "Les éléments ne quittent jamais l'origine de ton coffre : le contenu n'est envoyé que vers les champs du formulaire, sur ton ordinateur.",
  // remplissage
  secFill: 'Remplissage',
  fillTitle: 'Remplissage automatique des pages de connexion',
  fillHelp: "Remplit automatiquement les champs vides quand UN SEUL élément du coffre correspond au site. Plusieurs correspondances → l'icône affiche un badge, ouvre le coffre pour choisir. Aucune interface n'est jamais injectée dans les pages.",
  fillSavedOn: 'Auto-remplissage activé.',
  fillSavedOff: 'Auto-remplissage désactivé.',
  fillSaveErr: "Écriture impossible dans storage.local — réessaie.",
  // à propos
  secAbout: 'À propos',
  aboutVersionLabel: 'Extension Coffre',
  aboutWebui: 'Ouvrir la webui',
  aboutGithub: 'Code source (GitHub)',
  // enregistrement
  saveBtn: 'Enregistrer',
  saved: 'Enregistré.',
  saveUrlInvalid: 'URL invalide (https://… attendu).',
  saveTokenInvalid: "Token invalide — il commence par kvext_ (créé dans la webui).",
  savePermRefused: "Permission d'origine refusée — l'extension ne pourra pas joindre ce serveur.",
}

const EN = {
  title: 'Coffre — settings',
  sub: 'The extension reaches your vault through a dedicated token: create it in the web app (Settings → Firefox extension), paste it below, then unlock from the toolbar icon.',
  secConn: 'Connection',
  urlLabel: 'Server URL (web app)',
  urlPh: 'https://vault.kervia.ch',
  tokenLabel: 'Extension token',
  tokenPh: 'kvext_…',
  tokenHelp: "Create it in the web app → Settings → Firefox extension → “Create token”, then paste it here. It only grants access to the encrypted vault blobs — without the master password it reveals nothing.",
  eyeLabel: 'Show / hide the token',
  testConn: 'Test connection',
  testTokenBtn: 'Test token',
  urlNote: 'Any URL other than vault.kervia.ch will request an origin permission on save.',
  urlOk: 'Valid URL (https).',
  urlInvalid: 'https:// required — paste the full web app URL.',
  urlHttpWarn: 'http:// means cleartext traffic — the encrypted vault travels, but so does the token.',
  tokenShape: 'An extension token starts with kvext_ — recreate it in the web app if needed.',
  tokenMissing: 'Paste the token first (kvext_…).',
  testing: 'Testing…',
  testReachableNoToken: 'Server reachable — now paste the extension token, then test it.',
  testOk: 'Server reachable — vault present, token valid (%n items).',
  testTokenInvalid: 'Server reachable — token invalid or revoked.',
  testTokenNoCoffre: 'Server reachable — token valid, but no vault yet: create it in the web app.',
  testUnreachable: 'Unreachable — check the URL (and that the server is running).',
  testHttp: 'Response %n — check the URL.',
  testRoute404: 'Route /ext/coffre not found — check that the URL points to a kervia-vault server.',
  tokenValid: 'Token valid — vault accessible (%n items).',
  tokenInvalid: 'Token invalid or revoked — recreate it in the web app.',
  tokenNoCoffre: 'Token valid but no vault yet — create it in the web app.',
  secSecu: 'Security',
  autoLockLabel: 'Auto-lock after inactivity',
  al1: '1 min', al5: '5 min', al15: '15 min', al60: '60 min', al0: 'Never',
  secZero: 'Zero-knowledge: the master password and the key live in memory only, never on disk.',
  secNoInject: 'No interface is ever injected into web pages (no field icon, no bubble): filling only happens on your action, from the popup or via Ctrl+Shift+L.',
  secBgMemory: 'The decrypted vault stays in the background process; automatic lock after inactivity.',
  secLocalOnly: "Items never leave your vault's origin: content only goes to form fields, on your machine.",
  secFill: 'Filling',
  fillTitle: 'Automatic login-page fill',
  fillHelp: 'Automatically fills empty fields when EXACTLY ONE vault item matches the site. Multiple matches → the icon shows a badge; open the vault to choose. No interface is ever injected into pages.',
  fillSavedOn: 'Autofill enabled.',
  fillSavedOff: 'Autofill disabled.',
  fillSaveErr: 'Could not write to storage.local — try again.',
  secAbout: 'About',
  aboutVersionLabel: 'Coffre extension',
  aboutWebui: 'Open the web app',
  aboutGithub: 'Source code (GitHub)',
  saveBtn: 'Save',
  saved: 'Saved.',
  saveUrlInvalid: 'Invalid URL (expected https://…).',
  saveTokenInvalid: 'Invalid token — it starts with kvext_ (created in the web app).',
  savePermRefused: 'Origin permission refused — the extension will not be able to reach that server.',
}

const L = (navigator.language || '').toLowerCase().startsWith('en') ? EN : FR
document.documentElement.lang = L === EN ? 'en' : 'fr'

// application des chaînes : chaque gabarit porte la version française en
// dur (HTML valide sans JS) ; data-l10n/ph/aria reçoivent la langue du
// navigateur. Les éléments data-l10n sont des feuilles (jamais d'icônes
// dedans — l'hydratation lucide est indépendante).
function applyL10n() {
  for (const el of document.querySelectorAll('[data-l10n]')) el.textContent = L[el.dataset.l10n]
  for (const el of document.querySelectorAll('[data-l10n-ph]')) el.placeholder = L[el.dataset.l10nPh]
  for (const el of document.querySelectorAll('[data-l10n-aria]')) el.setAttribute('aria-label', L[el.dataset.l10nAria])
  $('opt-autofill').setAttribute('aria-label', L.fillTitle) // nom court pour le switch
  $('about-version').textContent = 'v' + browser.runtime.getManifest().version
}

// ---- messages : pastille colorée + texte, zone role="status" ----
// kind '' = neutre (test en cours), 'ok' | 'warn' | 'err' = pastille.
// La couleur n'est jamais seule : le texte porte le sens.
function setStatus(id, kind, text) {
  const el = $(id)
  el.dataset.kind = kind || ''
  el.textContent = text || ''
}

const normUrl = () => $('opt-url').value.trim().replace(/\/+$/, '')

// ---- validation inline URL : https requis, http averti ----
// http:// reste autorisé (auto-hébergement LAN) mais le message dit
// la vérité : le coffre est chiffré, le token voyage en clair.
function urlFeedback() {
  const v = normUrl()
  if (!v) { setStatus('url-status', '', ''); return false }
  if (/^https:\/\//i.test(v)) { setStatus('url-status', 'ok', L.urlOk); return true }
  if (/^http:\/\//i.test(v)) { setStatus('url-status', 'warn', L.urlHttpWarn); return true }
  setStatus('url-status', 'err', L.urlInvalid)
  return false
}

// ---- validation inline token : forme kvext_ ----
function tokenFeedback() {
  const t = $('opt-token').value.trim()
  if (!t || t.startsWith('kvext_')) setStatus('token-status', '', '')
  else setStatus('token-status', 'err', L.tokenShape)
}

// ---- test de connexion : pile complète ----
// 1) serveur joignable (GET /setup/info, public) ;
// 2) avec token : coffre présent + token valide (GET /ext/coffre,
//    Bearer → 200 {envelope, items[]}). Sans token, on s'arrête à l'étape
//    1 avec une invitation claire — messages à pastille colorée.
async function testConnexion() {
  const url = normUrl()
  const token = $('opt-token').value.trim()
  if (!url) { setStatus('test-status', 'err', L.urlInvalid); return }
  setStatus('test-status', '', L.testing)
  try {
    const res = await fetch(url + '/setup/info', { credentials: 'omit' })
    if (!res.ok) { setStatus('test-status', 'err', L.testHttp.replace('%n', res.status)); return }
  } catch (e) {
    setStatus('test-status', 'err', L.testUnreachable)
    return
  }
  if (!token) { setStatus('test-status', 'ok', L.testReachableNoToken); return }
  try {
    const res = await fetch(url + '/ext/coffre', {
      credentials: 'omit',
      headers: { Authorization: 'Bearer ' + token },
    })
    if (res.ok) {
      const j = await res.json().catch(() => null)
      const n = j && Array.isArray(j.items) ? j.items.length : 0
      setStatus('test-status', 'ok', L.testOk.replace('%n', n))
    } else if (res.status === 401 || res.status === 403) {
      setStatus('test-status', 'err', L.testTokenInvalid)
    } else if (res.status === 404) {
      const j = await res.json().catch(() => null)
      if (j && j.error === 'coffre_not_created') setStatus('test-status', 'warn', L.testTokenNoCoffre)
      else setStatus('test-status', 'err', L.testRoute404)
    } else {
      setStatus('test-status', 'err', L.testHttp.replace('%n', res.status))
    }
  } catch (e) {
    setStatus('test-status', 'err', L.testUnreachable)
  }
}

// ---- test du token (ciblé) : GET /ext/coffre avec Bearer ----
// 200 → valide + N items ; 401/403 → invalide ou révoqué ;
// 404 coffre_not_created → valide mais coffre absent (webui).
async function testToken() {
  const url = normUrl()
  const token = $('opt-token').value.trim()
  if (!token) { setStatus('test-status', 'err', L.tokenMissing); return }
  if (!url) { setStatus('test-status', 'err', L.urlInvalid); return }
  setStatus('test-status', '', L.testing)
  try {
    const res = await fetch(url + '/ext/coffre', {
      credentials: 'omit',
      headers: { Authorization: 'Bearer ' + token },
    })
    if (res.ok) {
      const j = await res.json().catch(() => null)
      const n = j && Array.isArray(j.items) ? j.items.length : 0
      setStatus('test-status', 'ok', L.tokenValid.replace('%n', n))
      return
    }
    if (res.status === 401 || res.status === 403) { setStatus('test-status', 'err', L.tokenInvalid); return }
    if (res.status === 404) {
      const j = await res.json().catch(() => null)
      if (j && j.error === 'coffre_not_created') { setStatus('test-status', 'warn', L.tokenNoCoffre); return }
      setStatus('test-status', 'err', L.testRoute404)
      return
    }
    setStatus('test-status', 'err', L.testHttp.replace('%n', res.status))
  } catch (e) {
    setStatus('test-status', 'err', L.testUnreachable)
  }
}

// ---- œil : afficher / masquer le token (aria-pressed porté) ----
$('btn-eye').onclick = () => {
  const inp = $('opt-token')
  const show = inp.type === 'password'
  inp.type = show ? 'text' : 'password'
  $('btn-eye').setAttribute('aria-pressed', String(show))
  $('btn-eye').replaceChildren(lucide(show ? 'eye-off' : 'eye', 14))
  inp.focus()
}

// ---- auto-lock : segmenté ; actif = couleur ET aria-pressed ----
function alBtns() { return document.querySelectorAll('#al-seg button') }
function selectAl(v) {
  for (const b of alBtns()) {
    const on = Number(b.dataset.al) === v
    b.classList.toggle('active', on)
    b.setAttribute('aria-pressed', String(on)) // pas d'état par couleur seule
  }
}
function alValue() {
  for (const b of alBtns()) if (b.classList.contains('active')) return Number(b.dataset.al)
  return 5
}

// ---- auto-fill : persisté IMMÉDIATEMENT ('fill'|'off', défaut 'off') ----
// Un interrupteur agit tout de suite (retour visible + aria-live) ;
// « Enregistrer » le ré-écrit aussi, idempotent. Contrat v1.8.7 : la clé
// storage.local s'appelle autoFill, valeurs 'fill' | 'off'.
$('opt-autofill').onchange = async (e) => {
  const on = e.target.checked
  try {
    await browser.storage.local.set({ autoFill: on ? 'fill' : 'off' })
    setStatus('fill-status', 'ok', on ? L.fillSavedOn : L.fillSavedOff)
  } catch (err) {
    e.target.checked = !on // échec d'écriture → retour à l'état réel
    setStatus('fill-status', 'err', L.fillSaveErr)
  }
}

// ---- chargement ----
async function load() {
  const p = await browser.storage.local.get(['serverUrl', 'autoLockMin', 'extToken', 'autoFill'])
  $('opt-url').value = p.serverUrl || 'https://vault.kervia.ch'
  $('opt-token').value = p.extToken || ''
  selectAl(typeof p.autoLockMin === 'number' ? p.autoLockMin : 5)
  $('opt-autofill').checked = p.autoFill === 'fill'
  $('about-webui').href = normUrl() || 'https://vault.kervia.ch'
  urlFeedback()
  tokenFeedback()
}

// ---- enregistrement ----
// Permission d'origine à la demande CONSERVÉE : origine non couverte par
// le manifest (https://vault.kervia.ch) → browser.permissions.request,
// appelé DANS le geste du clic (exigence Firefox), avant tout await.
$('btn-save').onclick = async () => {
  const url = normUrl()
  const token = $('opt-token').value.trim()
  if (!/^https?:\/\//i.test(url)) {
    setStatus('save-msg', 'err', L.saveUrlInvalid)
    urlFeedback()
    return
  }
  if (token && !token.startsWith('kvext_')) {
    setStatus('save-msg', 'err', L.saveTokenInvalid)
    tokenFeedback()
    return
  }
  const origin = new URL(url).origin
  if (origin !== 'https://vault.kervia.ch') {
    // pattern d'origine invalide (URL exotique) → rejet traité comme
    // refus, jamais d'échec silencieux
    let granted = false
    try {
      granted = await browser.permissions.request({ origins: [origin + '/*'] })
    } catch (e) { granted = false }
    if (!granted) {
      setStatus('save-msg', 'err', L.savePermRefused)
      return
    }
  }
  await browser.storage.local.set({
    serverUrl: url,
    autoLockMin: alValue(),
    extToken: token,
    autoFill: $('opt-autofill').checked ? 'fill' : 'off',
  })
  $('about-webui').href = url
  setStatus('save-msg', 'ok', L.saved)
}

// ---- câblage ----
$('opt-url').addEventListener('input', urlFeedback)
$('opt-token').addEventListener('input', tokenFeedback)
$('btn-test').onclick = testConnexion
$('btn-test-token').onclick = testToken
for (const b of alBtns()) {
  b.onclick = () => selectAl(Number(b.dataset.al))
}

applyL10n()
load()
