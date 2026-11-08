// Kervia-vault Coffre — script de contenu : DÉTECTION + REMPLISSAGE (moteur v2).
// Contrat explicite : ce script n'injecte JAMAIS d'interface dans la
// page (pas d'icône dans les champs, pas de bulle, pas d'overlay —
// exactement le comportement qui casse la webui avec les extensions
// classiques). Il ne parle que sur demande du background/popup, via message.
//
// Pattern « responder-only » (cf. CONTRAT-v1.8.7) : avec all_frames:true, un
// message sans frameId atteint TOUS les frames et la première réponse
// non-undefined gagne. Un frame sans champs pertinents ne répond PAS
// (return undefined) — une réponse négative gagnerait la course et
// masquerait la réponse positive d'une iframe (banques, SSO).
'use strict'

// ---- primitives ----

// remplissage compatible React : focus + setter natif + événements
// input/change (pas de blur automatique : il casse certains flux)
function setValue(el, value) {
  el.focus()
  const proto = Object.getPrototypeOf(el)
  const desc = Object.getOwnPropertyDescriptor(proto, 'value')
  if (desc && desc.set) desc.set.call(el, value)
  else el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

function visible(el) {
  const r = el.getBoundingClientRect()
  if (r.width <= 0 || r.height <= 0) return false
  const s = getComputedStyle(el)
  return s.visibility !== 'hidden' && s.display !== 'none' && !el.disabled
}

// autocomplete peut contenir plusieurs jetons ("new-password webauthn"…) :
// on cherche un jeton, pas une égalité brute
function hasAc(el, token) {
  return (el.autocomplete || '').trim().split(/\s+/).indexOf(token) !== -1
}

// champs texte visibles, candidats identifiant (password, checkbox… sont
// écartés par le filtre de type)
function textInputs() {
  return Array.from(document.querySelectorAll('input')).filter(el =>
    visible(el) && !el.readOnly &&
    (el.type === 'text' || el.type === 'email' || el.type === 'tel' ||
     el.type === ''))
}

// règle historique (fallback) : le champ le plus proche du mot de passe,
// au-dessus si possible (pénalité 1000 px pour les champs en dessous)
function nearestAbove(pwField, list) {
  const pwTop = pwField.getBoundingClientRect().top
  let best = null
  let bestDist = Infinity
  for (const c of list) {
    const r = c.getBoundingClientRect()
    const dist = Math.abs(r.top - pwTop) + (r.top > pwTop ? 1000 : 0)
    if (dist < bestDist) { bestDist = dist; best = c }
  }
  return best
}

// variante pour le 2FA : le plus proche STRICTEMENT en dessous
function nearestBelow(pwField, list) {
  const pwTop = pwField.getBoundingClientRect().top
  let best = null
  let bestDist = Infinity
  for (const c of list) {
    const r = c.getBoundingClientRect()
    if (r.top <= pwTop) continue
    const dist = r.top - pwTop
    if (dist < bestDist) { bestDist = dist; best = c }
  }
  return best
}

// ---- détection : refaite à CHAQUE message (le formulaire peut apparaître
// après document_idle — SPA, popups JS, multi-étapes — rien n'est caché) ----

// champ mot de passe : autocomplete="current-password" d'abord, puis champ
// vide, sinon premier visible ; les "new-password" (formulaires
// d'inscription mélangés) sont écartés dès qu'un autre candidat existe
function pickPwField() {
  const all = Array.from(document.querySelectorAll('input[type=password]')).filter(visible)
  if (!all.length) return null
  const notNew = all.filter(el => !hasAc(el, 'new-password'))
  const pool = notNew.length ? notNew : all
  const cur = pool.filter(el => hasAc(el, 'current-password'))
  if (cur.length) return cur[0]
  const empty = pool.filter(el => el.value === '')
  if (empty.length) return empty[0]
  return pool[0]
}

// champ identifiant, par heuristiques en cascade. Les deux champs peuvent
// vivre dans des forms différents (multi-étapes) : la portée s'élargit du
// <form> du mot de passe au document (pw.closest('form') est null-safe —
// page sans <form> → portée document).
function findUserField(pwField) {
  const cands = textInputs()
  if (!cands.length) return null

  // (a) autocomplete="username" : le signal le plus fort, portée page
  const ac = cands.filter(el => hasAc(el, 'username'))
  if (ac.length) return nearestAbove(pwField, ac)

  const form = pwField.closest('form')
  const scopes = form ? [form, document] : [document]
  for (const scope of scopes) {
    const local = scope === document ? cands
      : cands.filter(el => el.closest('form') === scope)
    if (!local.length) continue
    // (d) indice nominal (name/id/placeholder : user|email|login|mail|
    // account|ident) avant la position brute : évite de confondre
    // l'identifiant avec une barre de recherche
    const named = local.filter(el => {
      const s = ((el.name || '') + ' ' + (el.id || '') + ' ' +
        (el.placeholder || '')).toLowerCase()
      return /user|email|login|mail|account|ident/.test(s)
    })
    if (named.length) return nearestAbove(pwField, named)
    // (c) règle actuelle, en fallback : le plus proche au-dessus du mdp
    return nearestAbove(pwField, local)
  }
  return null
}

function findLoginFields() {
  const pwField = pickPwField()
  if (!pwField) return null
  return { userField: findUserField(pwField), pwField }
}

// champ 2FA : (a) autocomplete="one-time-code", (b) boîte OTP unique
// (inputmode=numeric, ou text/tel avec maxlength 6-8 et size ~1),
// (c) sinon l'input visible le plus proche SOUS le champ mot de passe
// (les pages 2FA suivent le login)
function findTotpField() {
  const pool = Array.from(document.querySelectorAll('input')).filter(el =>
    visible(el) && !el.readOnly && el.type !== 'password' &&
    (el.type === 'text' || el.type === 'tel' || el.type === 'email' ||
     el.type === 'number' || el.type === '' || el.inputMode === 'numeric'))
  // en cas de candidats multiples, préférer un champ vide (ne pas écraser
  // une saisie en cours) — sinon premier match
  const firstEmpty = (list) => list.find(el => el.value === '') || list[0]

  const otc = pool.filter(el => hasAc(el, 'one-time-code'))
  if (otc.length) return firstEmpty(otc)

  const box = pool.filter(el => {
    if (el.inputMode === 'numeric') return true
    const ml = parseInt(el.getAttribute('maxlength'), 10)
    return (el.type === 'text' || el.type === 'tel' || el.type === '') &&
      ml >= 6 && ml <= 8 && el.size >= 1 && el.size <= 2
  })
  if (box.length) return firstEmpty(box)

  const pw = pickPwField()
  return pw ? nearestBelow(pw, pool) : null
}

// ---- routeur (responder-only : pas de champ pertinent → pas de réponse) ----

browser.runtime.onMessage.addListener((msg) => {
  // fill : la détection est refaite ICI, à chaque message (SPA, popups JS)
  if (msg.cmd === 'fill') {
    const fields = findLoginFields()
    const filled = { username: false, password: false }
    if (fields) {
      // onlyIfEmpty (auto-fill) : ne JAMAIS écraser une saisie en cours ;
      // le fill manuel (popup / raccourci), sans le flag, écrase.
      if (fields.pwField && msg.password &&
          (!msg.onlyIfEmpty || fields.pwField.value === '')) {
        setValue(fields.pwField, msg.password)
        filled.password = true
      }
      if (fields.userField && msg.username &&
          (!msg.onlyIfEmpty || fields.userField.value === '')) {
        setValue(fields.userField, msg.username)
        filled.username = true
      }
    }
    // on ne répond QUE si un champ a été rempli : une réponse négative
    // d'un frame masquerait la réponse positive d'une iframe (course)
    if (filled.username || filled.password) return Promise.resolve({ filled })
    return undefined
  }

  if (msg.cmd === 'fill-totp') {
    const field = findTotpField()
    if (field && msg.code) {
      setValue(field, String(msg.code))
      return Promise.resolve({ filled: true })
    }
    return undefined
  }

  if (msg.cmd === 'probe') {
    const fields = findLoginFields()
    if (!fields) return undefined
    return Promise.resolve({
      userFieldType: fields.userField ? fields.userField.type : null,
      pwFieldType: fields.pwField.type,
    })
  }

  // cmd inconnue : pas de réponse (pattern responder-only)
})
