// API helpers — same-origin session cookie.
//
// v1.8.6 (audit UX) : toute erreur traverse deux étages :
//  1. ApiError : typée (status + code serveur) — consommable par les pages.
//  2. friendly() : message LOCALISÉ et actionnable — fin des « HTTP 500 »
//     et « Failed to fetch » crus dans les toasts (heuristique Nielsen n°9).
// Session expirée : 401 → onUnauthorized (branché par app.tsx : toast +
// retour login) — avant, chaque page restait blanche ou mentait (« Aucun
// vault » alors que c'était la session qui avait expiré).
import { tr } from '@/i18n'

export class ApiError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

// Codé par app.tsx au montage : déconnexion douce (toast + retour au login).
export let onUnauthorized: (() => void) | null = null
export function setOnUnauthorized(fn: (() => void) | null) { onUnauthorized = fn }

// Codes métier serveur → clés i18n (une seule table, plus de mapping par page).
const codeMap: Record<string, () => string> = {
  vault_not_empty: () => tr('vaultNotEmpty'),
  not_revoked: () => tr('errNotRevoked'),
  invalid_credentials: () => tr('loginError'),
  wrong_password: () => tr('passwordWrong'),
  name_exists: () => tr('nameExists'),
  invalid_totp: () => tr('faBadCode'),
}

// Statut HTTP → message localisé. Le code technique reste sur l'erreur
// (console / support), jamais dans le toast.
function statusMessage(status: number): string {
  switch (status) {
    case 401: return tr('errUnauthorized')
    case 403: return tr('errForbidden')
    case 404: return tr('errNotFound')
    case 409: return tr('errConflict')
    case 429: return tr('errRateLimited')
    default: return status >= 500 ? tr('errServer') : tr('errServer')
  }
}

// Message utilisateur pour n'importe quel échec (ApiError, réseau, inconnu).
export function friendly(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code && codeMap[e.code]) return codeMap[e.code]()
    return statusMessage(e.status)
  }
  // fetch réseau : TypeError("Failed to fetch") / erreur de connexion
  const msg = e instanceof Error ? e.message : String(e)
  if (/failed to fetch|networkerror|load failed|connexion/i.test(msg)) return tr('errNetwork')
  return tr('errServer')
}

export async function api<T = any>(method: string, url: string, body?: unknown): Promise<T> {
  const opts: RequestInit = { method, credentials: 'same-origin' }
  if (body !== undefined) {
    opts.headers = { 'Content-Type': 'application/json' }
    opts.body = JSON.stringify(body)
  }
  let res: Response
  try {
    res = await fetch(url, opts)
  } catch (e) {
    throw new ApiError(0, 'network', tr('errNetwork'))
  }
  if (!res.ok) {
    let data: any = {}
    try { data = await res.json() } catch { /* corps non-JSON : on garde le statut */ }
    const code = String(data?.error || data?.code || '')
    if (res.status === 401 && !url.startsWith('/share')) {
      onUnauthorized?.()
    }
    throw new ApiError(res.status, code, code && codeMap[code] ? codeMap[code]() : statusMessage(res.status))
  }
  return res.json()
}
