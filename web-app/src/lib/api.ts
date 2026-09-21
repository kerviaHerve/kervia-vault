// API helpers — same-origin session cookie.
export async function api<T = any>(method: string, url: string, body?: unknown): Promise<T> {
  const opts: RequestInit = { method, credentials: 'same-origin' }
  if (body !== undefined) {
    opts.headers = { 'Content-Type': 'application/json' }
    opts.body = JSON.stringify(body)
  }
  const res = await fetch(url, opts)
  if (!res.ok) {
    let data: any = {}
    try { data = await res.json() } catch {}
    throw new Error(data.message || data.error || `HTTP ${res.status}`)
  }
  return res.json()
}
