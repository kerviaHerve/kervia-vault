// Kervia-vault Coffre — options : URL du serveur + auto-lock.
'use strict'

const $ = (id) => document.getElementById(id)

// verrouillage auto : contrôle segmenté (boutons data-al)
function alBtns() { return document.querySelectorAll('#al-seg button') }
function selectAl(v) {
  for (const b of alBtns()) b.classList.toggle('active', Number(b.dataset.al) === v)
}

async function load() {
  const p = await browser.storage.local.get(['serverUrl', 'autoLockMin', 'extToken'])
  $('opt-url').value = p.serverUrl || 'https://vault.kervia.ch'
  $('opt-token').value = p.extToken || ''
  selectAl(typeof p.autoLockMin === 'number' ? p.autoLockMin : 5)
}

for (const b of alBtns()) {
  b.onclick = () => selectAl(Number(b.dataset.al))
}

$('btn-test').onclick = async () => {
  const url = $('opt-url').value.trim().replace(/\/+$/, '')
  const token = $('opt-token').value.trim()
  $('test-msg').textContent = '…'
  try {
    if (token) {
      // test complet avec le token : la vraie surface de l'extension
      const res = await fetch(url + '/ext/coffre', { headers: { 'Authorization': 'Bearer ' + token } })
      if (res.ok) { $('test-msg').textContent = 'OK — token valide, coffre accessible.'; return }
      if (res.status === 404) { $('test-msg').textContent = 'Token OK mais aucun coffre sur ce serveur.'; return }
      $('test-msg').textContent = res.status === 401 ? 'Token invalide ou révoqué.' : 'Réponse ' + res.status + '.'
      return
    }
    const res = await fetch(url + '/setup/info', { credentials: 'include' })
    if (res.ok) $('test-msg').textContent = 'Serveur joignable — colle maintenant le token d\'extension.'
    else $('test-msg').textContent = 'Réponse ' + res.status + ' — vérifie l\'URL.'
  } catch (e) {
    $('test-msg').textContent = 'Injoignable — vérifie l\'URL.'
  }
}

$('btn-save').onclick = async () => {
  const url = $('opt-url').value.trim().replace(/\/+$/, '')
  if (!/^https?:\/\/.+/.test(url)) {
    $('save-msg').textContent = 'URL invalide (https://… attendu).'
    $('save-msg').className = 'err'
    return
  }
  // origine non couverte par le manifest → permission à la demande
  const defaultOrigin = 'https://vault.kervia.ch'
  if (url !== defaultOrigin) {
    const origin = new URL(url).origin
    const granted = await browser.permissions.request({ origins: [origin + '/*'] })
    if (!granted) {
      $('save-msg').textContent = 'Permission d\'origine refusée — l\'extension ne pourra pas joindre ce serveur.'
      $('save-msg').className = 'err'
      return
    }
  }
  let al = 5
  for (const b of alBtns()) {
    if (b.classList.contains('active')) al = Number(b.dataset.al)
  }
  const token = $('opt-token').value.trim()
  if (token && !token.startsWith('kvext_')) {
    $('save-msg').textContent = 'Token invalide — il commence par kvext_ (créé dans la webui).'
    $('save-msg').className = 'err'
    return
  }
  await browser.storage.local.set({ serverUrl: url, autoLockMin: al, extToken: token })
  $('save-msg').textContent = 'Enregistré.'
  $('save-msg').className = ''
}

load()