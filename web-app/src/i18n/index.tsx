import * as React from 'react'
import { translations, type Lang, type TKey } from './translations'

// useLang: hook d'accès aux traductions + changement de langue.
// Persistance: localStorage 'kerviavault-lang'. Défaut: fr.
const LangCtx = React.createContext<{
  lang: Lang
  setLang: (l: Lang) => void
}>({ lang: 'fr', setLang: () => {} })

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = React.useState<Lang>(() => {
    const saved = localStorage.getItem('kerviavault-lang')
    return saved === 'en' || saved === 'fr' ? (saved as Lang) : 'fr'
  })
  const setLang = (l: Lang) => {
    localStorage.setItem('kerviavault-lang', l)
    setLangState(l)
  }
  return <LangCtx.Provider value={{ lang, setLang }}>{children}</LangCtx.Provider>
}

// Helper: cast une clé de traduction en callable (les clés fonction retournent une string).
export function tr(key: TKey, ...args: any[]): string {
  const lang: Lang = (localStorage.getItem('kerviavault-lang') as Lang) || 'fr'
  const v = (translations[lang] || translations.fr)[key]
  return typeof v === 'function' ? (v as (...a: any[]) => string)(...args) : (v as string)
}

export function useLang() {
  const { lang, setLang } = React.useContext(LangCtx)
  const t = translations[lang]
  // proxy: t.key retourne la string; t.fn(...) appelle — via cast any (sûr: usage contrôlé)
  return { t: t as any, lang, setLang, tr }
}
