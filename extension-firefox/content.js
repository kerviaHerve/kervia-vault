// Kervia-vault Coffre — script de contenu : DÉTECTION + REMPLISSAGE.
// Contrat explicite : ce script n'injecte JAMAIS d'interface dans la
// page (pas d'icône dans les champs, pas de bulle, pas d'overlay —
// exactement le comportement qui casse la webui avec les extensions
// classiques). Il ne parle que sur demande du popup, via message.
'use strict'

// remplissage compatible React : setter natif + événements input/change
function setValue(el, value) {
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

// trouve le meilleur couple (utilisateur, mot de passe) de la page
function findLoginFields() {
  const pw = Array.from(document.querySelectorAll('input[type=password]')).filter(visible)
  if (pw.length === 0) return null
  const pwField = pw[0]

  // candidats utilisateur : le champ texte/email du même formulaire,
  // au-dessus du champ mot de passe si possible
  const form = pwField.closest('form')
  const scope = form || document
  let candidates = Array.from(scope.querySelectorAll('input')).filter(el =>
    visible(el) && !el.readOnly && el !== pwField &&
    (el.type === 'text' || el.type === 'email' || el.type === 'tel' ||
     el.type === '' || el.autocomplete === 'username'))
  // préférence : le plus proche au-dessus du mot de passe
  const pwTop = pwField.getBoundingClientRect().top
  let userField = null
  let bestDist = Infinity
  for (const c of candidates) {
    const r = c.getBoundingClientRect()
    const dist = Math.abs(r.top - pwTop) + (r.top > pwTop ? 1000 : 0)
    if (dist < bestDist) { bestDist = dist; userField = c }
  }
  if (!userField) {
    // pas de champ dédié : un seul champ texte visible ? (login seul)
    const anyText = Array.from(document.querySelectorAll('input')).filter(el =>
      visible(el) && (el.type === 'text' || el.type === 'email' || el.type === ''))
    if (anyText.length === 1) userField = anyText[0]
  }
  return { userField, pwField }
}

browser.runtime.onMessage.addListener((msg) => {
  if (msg.cmd === 'fill') {
    const fields = findLoginFields()
    let filled = { username: false, password: false }
    if (fields) {
      if (msg.password && fields.pwField) {
        setValue(fields.pwField, msg.password)
        filled.password = true
      }
      if (msg.username && fields.userField) {
        setValue(fields.userField, msg.username)
        filled.username = true
      }
    }
    return Promise.resolve({ filled })
  }
  if (msg.cmd === 'probe') {
    return Promise.resolve({ hasForm: findLoginFields() !== null })
  }
})