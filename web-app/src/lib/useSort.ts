import * as React from 'react'

// ---------------------------------------------------------------------------
// useSort: tri générique pour les tableaux du webui.
// sortKey = champ sur lequel trier; dir = 'asc' | 'desc'.
// Toggle au clic: même colonne → inverse la direction; autre colonne → asc
// (sauf date qui démarre en desc, plus naturel).
// ---------------------------------------------------------------------------

export type SortDir = 'asc' | 'desc'

export function useSort<T>(items: T[] | null, initialKey: string, initialDir: SortDir = 'asc') {
  const [sortKey, setSortKey] = React.useState(initialKey)
  const [sortDir, setSortDir] = React.useState<SortDir>(initialDir)

  const toggle = React.useCallback((key: string) => {
    if (key === sortKey) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      // les dates/versions partent en desc (plus récent d'abord), le reste en asc
      const isNumericOrDate = /at$|version/i.test(key)
      setSortKey(key)
      setSortDir(isNumericOrDate ? 'desc' : 'asc')
    }
  }, [sortKey])

  const sorted = React.useMemo(() => {
    if (!items) return null
    const arr = [...items]
    const dir = sortDir === 'asc' ? 1 : -1
    arr.sort((a: any, b: any) => {
      let av = a[sortKey]
      let bv = b[sortKey]
      // dates ISO: comparaison lexicographique OK
      if (typeof av === 'string' && typeof bv === 'string') {
        const an = Number(av); const bn = Number(bv)
        if (!Number.isNaN(an) && !Number.isNaN(bn)) return (an - bn) * dir
        return av.localeCompare(bv, undefined, { sensitivity: 'base' }) * dir
      }
      if (av == null) return 1 * dir
      if (bv == null) return -1 * dir
      return (av > bv ? 1 : av < bv ? -1 : 0) * dir
    })
    return arr
  }, [items, sortKey, sortDir])

  return { sorted, sortKey, sortDir, toggle }
}