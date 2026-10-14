// Kervia-vault — boot du thème. Fichier externe (CSP : script-src 'self')
// chargé en synchrone dans le <head> : applique le thème mémorisé avant le
// premier rendu, pas de flash. Sombre par défaut (règle du kit).
try {
  if (localStorage.getItem('kerviavault-theme') === 'light') {
    document.documentElement.dataset.theme = 'light'
  }
} catch (e) { /* stockage indisponible : thème sombre par défaut */ }