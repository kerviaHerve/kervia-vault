// Thème Kervia — sombre par défaut, choix de l'utilisateur conservé (localStorage).
// data-theme="dark"|"light" sur <html> ; le kit impose les deux thèmes.
import * as React from 'react'

export type Theme = 'dark' | 'light'
const STORAGE_KEY = 'kerviavault-theme'

export function readTheme(): Theme {
  try { return localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark' } catch { return 'dark' }
}

export function applyTheme(t: Theme) {
  document.documentElement.dataset.theme = t
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'dark' ? '#171B19' : '#F4F6F2')
  try { localStorage.setItem(STORAGE_KEY, t) } catch { /* stockage indisponible : thème de session */ }
}

// petit store module : un seul état partagé entre la sidebar, le login et le wizard
let current: Theme = readTheme()
const listeners = new Set<(t: Theme) => void>()

export function useTheme() {
  const [theme, setLocal] = React.useState<Theme>(current)
  React.useEffect(() => {
    const fn = (t: Theme) => setLocal(t)
    listeners.add(fn)
    return () => { listeners.delete(fn) }
  }, [])
  const toggle = () => {
    current = current === 'dark' ? 'light' : 'dark'
    applyTheme(current)
    listeners.forEach(fn => fn(current))
  }
  return { theme, toggle }
}