// Kervia-vault Coffre — lib crypto pour l'extension Firefox.
// Portage à l'identique de web-app/src/lib/coffre.ts : MÊME schéma
// (PBKDF2-SHA256 600k → masterKey scelle coffreKey 32B, AES-256-GCM,
// nonce||ciphertext, verifier 'kervia-coffre-verifier-v1') — un coffre
// déverrouillé par la webui l'est aussi ici, et réciproquement.
// Zero-knowledge : le mot de passe maître et la clé ne vivent qu'en
// mémoire du processus d'arrière-plan ; jamais de stockage disque.
/* eslint-disable */
'use strict'

var COFFRE = (function () {
  // ---- base64 ----
  function b64(bytes) {
    var s = ''
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
    return btoa(s)
  }
  function unb64(s) {
    var bin = atob(s)
    var out = new Uint8Array(bin.length)
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  }
  function randomBytes(n) {
    var b = new Uint8Array(n)
    crypto.getRandomValues(b)
    return b
  }
  function te(s) { return new TextEncoder().encode(s) }
  function td(b) { return new TextDecoder().decode(b) }

  // ---- KDF + scellement (identique à la webui) ----
  var VERIFIER_PLAINTEXT = 'kervia-coffre-verifier-v1'
  var KDF_ITERATIONS = 600000

  function deriveMasterKey(password, salt, iterations) {
    return crypto.subtle.importKey('raw', te(password), 'PBKDF2', false, ['deriveKey'])
      .then(function (base) {
        return crypto.subtle.deriveKey(
          { name: 'PBKDF2', salt: salt, iterations: iterations, hash: 'SHA-256' },
          base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
      })
  }
  function seal(key, plaintext) {
    var nonce = randomBytes(12)
    return crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plaintext)
      .then(function (ct) {
        var out = new Uint8Array(12 + ct.byteLength)
        out.set(nonce, 0)
        out.set(new Uint8Array(ct), 12)
        return out
      })
  }
  function open(key, sealed) {
    var iv = sealed.slice(0, 12)
    var ct = sealed.slice(12)
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, ct)
      .then(function (pt) { return new Uint8Array(pt) })
  }

  // ---- enveloppe ----
  function unlockEnvelope(header, password) {
    var salt = unb64(header.kdf_salt_b64)
    var params = JSON.parse(header.kdf_params || '{}')
    var iterations = Number(params.iterations) || KDF_ITERATIONS
    return deriveMasterKey(password, salt, iterations)
      .then(function (masterKey) {
        return open(masterKey, unb64(header.wrapped_key_b64))
          .catch(function () { throw new Error('wrong_password') })
          .then(function (raw) {
            return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
              .then(function (key) {
                // verifier : mauvais mot de passe détectable côté client
                return open(key, unb64(header.verifier_b64))
                  .then(function (v) {
                    if (td(v) !== VERIFIER_PLAINTEXT) throw new Error('wrong_password')
                    return key
                  })
              })
          })
      })
  }

  // ---- schéma v2 (normalisation v1→v2 incluse) ----
  function normalizeItem(raw) {
    if (!raw || typeof raw !== 'object') return { v: 2, type: 'note', name: '???', fields: [], notes: '', folder: '', tags: [], favorite: false, history: [] }
    if (raw.v === 2) {
      return {
        v: 2, type: raw.type, name: raw.name,
        fields: Array.isArray(raw.fields) ? raw.fields : [],
        notes: raw.notes || '', folder: raw.folder || '',
        tags: Array.isArray(raw.tags) ? raw.tags : [],
        favorite: !!raw.favorite, history: Array.isArray(raw.history) ? raw.history : [],
        password_updated_at: raw.password_updated_at,
      }
    }
    // v1 (flat) → v2 champs — les vieux blobs restent lisibles
    var fields = []
    if (raw.type === 'login') {
      fields.push({ k: 'text', l: 'Identifiant', v: raw.username || '' })
      fields.push({ k: 'secret', l: 'Mot de passe', v: raw.password || '' })
      var uris = Array.isArray(raw.uris) ? raw.uris.filter(Boolean) : []
      for (var i = 0; i < uris.length; i++) fields.push({ k: 'link', l: 'Site web', v: uris[i] })
      if (raw.totp) fields.push({ k: 'totp', l: 'TOTP', v: raw.totp })
    }
    return {
      v: 2, type: raw.type === 'note' ? 'note' : 'login', name: raw.name || '(sans nom)',
      fields: fields, notes: raw.notes || '', folder: raw.folder || '', tags: [],
      favorite: !!raw.favorite, history: Array.isArray(raw.history) ? raw.history : [],
      password_updated_at: raw.password_updated_at,
    }
  }

  function decryptItem(key, blobB64) {
    return open(key, unb64(blobB64))
      .then(function (pt) { return normalizeItem(JSON.parse(td(pt))) })
  }

  // ---- recherche / correspondance de domaines (v2) ----
  // domainOf TOLÉRANT : les URI du coffre sont saisies librement et
  // arrivent souvent SANS schéma (« example.com », « www.ex.com/login »),
  // cas où new URL throw (ou parse en opaque avec hostname vide). Règles :
  //  • pas de schéma du tout → préfixe « https:// » puis parse ;
  //  • « host:port » sans schéma (« ex.com:8443 ») → idem : l'URL parser
  //    y voit un schéma (« ex.com » est un nom de schéma valide), nous
  //    y voyons un hôte — regex dédiée pour le distinguer ;
  //  • schéma NON-web (mailto:) → jamais préfixé : hostname vide → aucun
  //    faux match d'un mailto:contact@shop.x sur le domaine shop.x ;
  //  • mot sans point ni schéma (« /login » → « login ») → pas un hôte
  //    (localhost mis à part) → vide, pas de faux positif ;
  //  • le PORT n'entre jamais en compte : new URL().hostname l'exclut —
  //    site.com:8443 correspond à site.com (choix documenté, voulu).
  function urlHost(u) {
    try { var h = new URL(u).hostname; return h ? h.toLowerCase() : '' } catch (e) { return '' }
  }
  function domainOf(url) {
    var v = String(url || '').trim()
    if (!v) return ''
    var h = urlHost(v)
    if (h) return h
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) return '' // schéma + autorité déjà parsés : hôte vide
    // présence d'un « schéma » : réel (mailto:) → pas de préfixe ;
    // host:port (ex.com:8443) → préfixé quand même
    if (v.indexOf(':') !== -1 && !/^[a-z0-9][a-z0-9.-]*:\d{1,5}([\/?#]|$)/i.test(v)) return ''
    h = urlHost('https://' + v.replace(/^\/+/, ''))
    return (h && (h.indexOf('.') !== -1 || h === 'localhost')) ? h : ''
  }

  // suffixes ccTLD à 2 labels les plus courants — liste EMBARQUÉE et
  // volontairement courte (pas de PSL complète : ~8 000 entrées n'ont
  // pas leur place dans l'extension). LIMITE DOCUMENTÉE : un suffixe
  // absent (ex. com.sg) retombe sur l'heuristique 2 labels — à étendre
  // si un coffre en a besoin. Sans cette liste, « shop.co.uk » avait
  // pour base « co.uk » → n'importe quel site .co.uk matchait (faux
  // positif de sécurité).
  var MULTI_LABEL_SUFFIXES = {
    'co.uk': 1, 'org.uk': 1, 'ac.uk': 1, 'gov.uk': 1,
    'com.au': 1, 'net.au': 1, 'org.au': 1, 'edu.au': 1,
    'co.nz': 1, 'co.jp': 1, 'com.br': 1, 'com.mx': 1,
    'co.in': 1, 'com.tr': 1, 'co.za': 1, 'com.cn': 1, 'co.kr': 1,
  }
  function baseDomain(host) {
    var v = String(host || '').toLowerCase().trim()
    // IPv4 : la « base » d'une IP est l'IP entière (sinon 192.168.1.10
    // « matcherait » 10.2.3.10 — mêmes deux derniers labels)
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v)) return v
    // heuristique 2 labels : site.fr, example.com ; 3 pour les
    // suffixes connus à 2 labels (shop.co.uk → shop.co.uk)
    var p = v.split('.').filter(Boolean)
    if (p.length <= 2) return p.join('.')
    var two = p.slice(-2).join('.')
    if (MULTI_LABEL_SUFFIXES[two]) return p.slice(-3).join('.')
    return two
  }

  // Un élément correspond à la page si l'un de ses champs kind='link'
  // vise le même hôte, ou le même domaine de base (sous-domaines
  // inclus, des deux côtés). Choix assumés, documentés :
  //  • PAS de match par nom d'item (« Gmail » vs mail.google.com) : le
  //    nom est du texte libre, trop de faux positifs — refusé ;
  //  • le port ne compte pas : new URL().hostname l'exclut déjà ;
  //  • schémas non-web (mailto:) et URI non-hôtes : jamais de match
  //    (hostname vide côté domainOf) ;
  //  • match par base domain uniquement — un site PIÈGE partageant
  //    le sous-domaine sans partager la base (shop.attacker.co.uk vs
  //    shop.victim.co.uk) ne matche PAS.
  function itemMatchesUrl(item, url) {
    var pageHost = domainOf(url)
    if (!pageHost) return false
    var pageBase = baseDomain(pageHost)
    for (var i = 0; i < (item.fields || []).length; i++) {
      var f = item.fields[i]
      if (f.k !== 'link' || !f.v) continue
      var h = domainOf(f.v)
      if (!h) continue
      if (h === pageHost || baseDomain(h) === pageBase) return true
    }
    return false
  }

  // Texte indexé pour la recherche : nom + « libellé valeur » de chaque
  // champ (les URI complets y passent donc — kind='link' → « Site web
  // https://… ») + notes + dossier + tags, en minuscules. La
  // correspondance par domaine saisie (« gmail » → mail.google.com) est
  // HORS SCOPE : .includes volontairement simple (sous-chaîne).
  function itemSearchText(it) {
    return [it.name].concat((it.fields || []).map(function (f) { return f.l + ' ' + f.v }))
      .concat([it.notes || '', it.folder || '']).concat(it.tags || [])
      .filter(Boolean).join(' ').toLowerCase()
  }
  function firstLink(it) {
    var fs = it.fields || []
    for (var i = 0; i < fs.length; i++) if (fs[i].k === 'link' && fs[i].v) return fs[i].v
    return ''
  }
  function firstUsername(it) {
    var fs = it.fields || []
    for (var i = 0; i < fs.length; i++) {
      if (fs[i].v && (fs[i].l === 'Identifiant' || fs[i].l === 'Utilisateur' || fs[i].l === 'Username' || fs[i].l === 'User' || fs[i].k === 'text')) return fs[i].v
    }
    return ''
  }
  function mainSecret(it) {
    var fs = it.fields || []
    for (var i = 0; i < fs.length; i++) if (fs[i].k === 'secret' && fs[i].v) return fs[i].v
    return ''
  }
  function firstTotp(it) {
    var fs = it.fields || []
    for (var i = 0; i < fs.length; i++) if (fs[i].k === 'totp' && fs[i].v) return fs[i].v
    return ''
  }
  function itemSubtitle(it) {
    if (it.type === 'card') {
      var n = mainSecret(it)
      if (n) return '•••• ' + n.replace(/\s/g, '').slice(-4)
    }
    return firstUsername(it)
  }

  // ---- TOTP (RFC 6238 complet : SHA-1/256/512, 6-8 chiffres, 30/60 s) ----
  var B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  function parseTotp(s) {
    var v = String(s || '').trim()
    if (/^otpauth:\/\//i.test(v)) {
      try {
        var u = new URL(v.replace(/^otpauth:\/\//i, 'https://'))
        var secret = (u.searchParams.get('secret') || '').toUpperCase().replace(/\s/g, '')
        var algoRaw = (u.searchParams.get('algorithm') || 'SHA1').toUpperCase().replace(/-/g, '')
        var algo = algoRaw === 'SHA256' || algoRaw === 'SHA512' ? 'SHA-' + algoRaw.slice(3) : 'SHA-1'
        var digits = Math.min(8, Math.max(6, Number(u.searchParams.get('digits')) || 6))
        var period = Number(u.searchParams.get('period')) === 60 ? 60 : 30
        return { secret: secret, algo: algo, digits: digits, period: period }
      } catch (e) { return { secret: '', algo: 'SHA-1', digits: 6, period: 30 } }
    }
    return { secret: v.toUpperCase().replace(/\s/g, ''), algo: 'SHA-1', digits: 6, period: 30 }
  }
  function base32Decode(s) {
    var clean = s.toUpperCase().replace(/=+$/g, '').replace(/[^A-Z2-7]/g, '')
    var bits = 0, value = 0, out = []
    for (var i = 0; i < clean.length; i++) {
      var idx = B32.indexOf(clean[i])
      if (idx < 0) continue
      value = (value << 5) | idx
      bits += 5
      if (bits >= 8) { bits -= 8; out.push((value >>> bits) & 0xff) }
    }
    return new Uint8Array(out)
  }
  function totpAt(spec, counter) {
    var keyBytes = base32Decode(spec.secret)
    if (keyBytes.length === 0) return Promise.reject(new Error('invalid_seed'))
    var msg = new Uint8Array(8)
    var n = counter
    for (var i = 7; i >= 0; i--) { msg[i] = n & 0xff; n = Math.floor(n / 256) }
    return crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: spec.algo || 'SHA-1' }, false, ['sign'])
      .then(function (key) { return crypto.subtle.sign('HMAC', key, msg) })
      .then(function (s) {
        var sig = new Uint8Array(s)
        var off = sig[sig.length - 1] & 0x0f
        var bin = ((sig[off] & 0x7f) << 24) | (sig[off + 1] << 16) | (sig[off + 2] << 8) | sig[off + 3]
        var digits = spec.digits || 6
        return String(bin % Math.pow(10, digits)).padStart(digits, '0')
      })
  }
  function totpNow(spec) {
    var period = spec.period || 30
    var counter = Math.floor(Date.now() / 1000 / period)
    return totpAt(spec, counter).then(function (code) {
      return { code: code, remaining: period - (Math.floor(Date.now() / 1000) % period) }
    })
  }

  // ---- générateur (identique à la webui) ----
  var G_LOWER = 'abcdefghijkmnopqrstuvwxyz'
  var G_UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  var G_DIGITS = '23456789'
  var G_SYMBOLS = '!@#$%^&*()-_=+[]{};:,.?/'
  function generatePassword(opts) {
    var pool = ''
    if (opts.lower) pool += G_LOWER
    if (opts.upper) pool += G_UPPER
    if (opts.digits) pool += G_DIGITS
    if (opts.symbols) pool += G_SYMBOLS
    if (!pool.length) pool = G_LOWER
    var len = Math.max(opts.length, 8)
    var rand = new Uint32Array(len)
    crypto.getRandomValues(rand)
    var out = ''
    for (var i = 0; i < len; i++) out += pool[rand[i] % pool.length]
    return out
  }

  return {
    unlockEnvelope: unlockEnvelope,
    decryptItem: decryptItem,
    normalizeItem: normalizeItem,
    domainOf: domainOf,
    baseDomain: baseDomain,
    itemMatchesUrl: itemMatchesUrl,
    itemSearchText: itemSearchText,
    firstLink: firstLink,
    firstUsername: firstUsername,
    mainSecret: mainSecret,
    firstTotp: firstTotp,
    itemSubtitle: itemSubtitle,
    parseTotp: parseTotp,
    totpNow: totpNow,
    generatePassword: generatePassword,
  }
})()
if (typeof module !== 'undefined' && module.exports) module.exports = COFFRE // tests Node

// ---- self-tests (matching) — exécution directe : `node js/coffre-lib.js`.
// En require() le bloc se tait (module importé) ; en direct il tourne et
// exitCode ≠ 0 si échec. Uniquement les fonctions PURES de matching —
// aucune crypto ici. L'usage extension (var COFFRE global chargé par le
// manifest / popup.html) est inchangé : sous Firefox, module n'existe
// pas et ce bloc entier est mort.
if (typeof module !== 'undefined' && typeof require === 'function' && require.main === module) {
  var __pass = 0, __fail = 0
  function __eq(actual, expected, label) {
    var a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { __pass++; return }
    __fail++
    console.error('  ÉCHEC ' + label + ' : attendu ' + e + ', obtenu ' + a)
  }

  // domainOf — tolérant aux URI stockées sans schéma
  __eq(COFFRE.domainOf('example.com'), 'example.com', 'domainOf sans schéma')
  __eq(COFFRE.domainOf('www.example.com/login'), 'www.example.com', 'domainOf sans schéma + chemin')
  __eq(COFFRE.domainOf('example.com:8443/admin'), 'example.com', 'domainOf host:port sans schéma (port exclu)')
  __eq(COFFRE.domainOf('https://App.Example.COM/x?y'), 'app.example.com', 'domainOf https + insensible à la casse')
  __eq(COFFRE.domainOf('//cdn.example.com/x'), 'cdn.example.com', 'domainOf relatif au protocole (//)')
  __eq(COFFRE.domainOf('localhost'), 'localhost', 'domainOf hôte nu localhost')
  __eq(COFFRE.domainOf('mailto:contact@shop.example'), '', 'domainOf mailto → vide (pas de faux match)')
  __eq(COFFRE.domainOf('/login'), '', 'domainOf chemin seul → vide')
  __eq(COFFRE.domainOf(''), '', 'domainOf chaîne vide')

  // baseDomain — suffixes à 2 labels vs .com
  __eq(COFFRE.baseDomain('shop.co.uk'), 'shop.co.uk', 'baseDomain co.uk → 3 labels (pas «co.uk»)')
  __eq(COFFRE.baseDomain('www.example.com'), 'example.com', 'baseDomain .com → 2 labels')
  __eq(COFFRE.baseDomain('a.b.example.com'), 'example.com', 'baseDomain profond → 2 labels')
  __eq(COFFRE.baseDomain('x.co.jp'), 'x.co.jp', 'baseDomain co.jp → 3 labels')
  __eq(COFFRE.baseDomain('192.168.1.10'), '192.168.1.10', 'baseDomain IPv4 → IP entière')
  __eq(COFFRE.baseDomain('localhost'), 'localhost', 'baseDomain mono-label')

  // itemMatchesUrl — positifs
  __eq(COFFRE.itemMatchesUrl({ fields: [{ k: 'link', l: 'Site', v: 'https://www.example.com/login' }] }, 'https://app.example.com/signin'), true, 'match sous-domaine ↔ base domain')
  __eq(COFFRE.itemMatchesUrl({ fields: [{ k: 'link', l: 'Site', v: 'example.com' }] }, 'https://example.com'), true, 'match URI stockée sans schéma')
  __eq(COFFRE.itemMatchesUrl({ fields: [{ k: 'link', l: 'Site', v: 'https://site.com' }] }, 'https://site.com:8443/x'), true, 'match port différent (hostname sans port)')

  // itemMatchesUrl — négatifs
  __eq(COFFRE.itemMatchesUrl({ fields: [{ k: 'link', l: 'Site', v: 'https://shop.attacker.co.uk' }] }, 'https://shop.victim.co.uk'), false, 'PAS de match .co.uk croisé (suffixe piégé)')
  __eq(COFFRE.itemMatchesUrl({ fields: [{ k: 'link', l: 'Site', v: 'https://random.co.uk' }] }, 'https://shop.co.uk'), false, 'PAS de match base «co.uk» (ancien bug de sécurité)')
  __eq(COFFRE.itemMatchesUrl({ fields: [{ k: 'link', l: 'Site', v: 'https://notexample.com' }] }, 'https://example.com'), false, 'PAS de match autre site (label voisin)')
  __eq(COFFRE.itemMatchesUrl({ fields: [{ k: 'link', l: 'Site', v: 'mailto:contact@shop.example' }] }, 'https://shop.example'), false, 'PAS de match mailto sur le domaine')
  __eq(COFFRE.itemMatchesUrl({ name: 'example.com', fields: [] }, 'https://example.com'), false, 'PAS de match par nom d’item (refusé : faux positifs)')
  __eq(COFFRE.itemMatchesUrl({ fields: [{ k: 'secret', l: 'Mot de passe', v: 'https://example.com' }] }, 'https://example.com'), false, 'PAS de match sur champ non-link')

  // itemSearchText — nom + libellé/valeur des champs (URI complets inclus)
  var __st = COFFRE.itemSearchText({
    name: 'Gmail',
    fields: [{ k: 'link', l: 'Site web', v: 'https://mail.example.com' }],
    notes: 'note', folder: 'Perso', tags: ['mail'],
  })
  __eq(__st.includes('gmail') && __st.includes('site web https://mail.example.com') && __st.includes('note') && __st.includes('perso'), true, 'itemSearchText indexe nom + champs + notes + dossier + tags')

  console.log('coffre-lib self-tests : ' + __pass + ' OK, ' + __fail + ' échec(s)')
  if (__fail > 0) process.exitCode = 1
}