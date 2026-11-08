// Presse-papiers — v1.8.6 (audit UX A2).
// Le produit est typiquement servi en HTTP simple (LAN/VPN) : navigator.clipboard
// n'y existe pas (secure context requis). Chaque bouton « copier » doit donc
// passer par CE helper : fallback execCommand, attente réelle, succès/toast
// uniquement si la copie a eu lieu. Avant : boutons muets en HTTP, faux succès
// sur rejet — la clé API affichée une seule fois pouvait être « perdue ».
export async function copyText(value: string): Promise<boolean> {
  if (!value) return false
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value)
      return true
    }
  } catch { /* on tente le fallback */ }
  try {
    const ta = document.createElement('textarea')
    ta.value = value
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.top = '-1000px'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    ta.setSelectionRange(0, value.length)
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}
