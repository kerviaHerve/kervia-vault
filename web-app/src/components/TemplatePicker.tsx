// TemplatePicker — sélecteur du type de credential pour l'ajout d'un secret.
//
// Remplace le <select> natif de CreateDialog : 58 options à plat rendaient
// les basiques (smtp, mail, postgres…) introuvables sans défilement, et un
// menu natif ne se filtre ni ne se style. Ici :
//   - recherche instantanée insensible aux accents + alias FR (bdd, ia…)
//     sur nom, clé, catégorie et description
//   - « Les basiques » épinglés en tête quand la recherche est vide
//     (valeur libre + smtp, openai, postgres, github…)
//   - résultats regroupés par catégorie, navigation clavier complète
//     (↑ ↓ naviguent, Enter choisit, Esc ferme)
//
// Règle maison (v1.7.2, dialogs) : AUCUNE animation — le panneau se peint
// instantanément à son état final, jamais d'état initial invisible.
import * as React from 'react'
import {
  ChevronDown, ChevronUp, Search, X, Check, FileText,
  Sparkles, Mail, Cloud, Database, GitBranch, Globe, MessageSquare,
  CreditCard, Activity, Hexagon,
} from 'lucide-react'
import { useLang } from '@/i18n'
import { cn } from '@/lib/utils'

// Type structurel minimal — le Template complet de la page secrets est
// assignable tel quel (le picker n'a pas besoin des champs).
export interface PickerTemplate {
  key: string; name: string; category: string; description?: string
}

type Icon = React.ComponentType<{ size?: number; className?: string }>

// Icône par catégorie (chute : FileText).
const CAT_ICON: Record<string, Icon> = {
  'LLM': Sparkles, 'Mail': Mail, 'Cloud': Cloud, 'Database': Database,
  'DevOps': GitBranch, 'Web/API': Globe, 'Messaging': MessageSquare,
  'Payments': CreditCard, 'Monitoring': Activity, 'Kervia': Hexagon,
}

// Les basiques épinglés — c'est l'usage réel qui décide : le mail d'abord
// (smtp est LE credential introuvable de l'ancien menu), puis les
// fondations. L'ordre suit le besoin, pas l'alphabet.
const POPULAR = [
  'smtp', 'gmail', 'openai', 'anthropic', 'postgres', 'mysql',
  'github', 'api-key', 'bearer', 'basic-auth', 'cloudflare', 'stripe',
]

// Alias FR → mots-clés du registre : la recherche doit parler la langue
// de l'utilisateur, pas celle des clés internes.
const ALIASES: Record<string, string[]> = {
  bdd: ['database'], db: ['database'],
  ia: ['llm'], ai: ['llm'], gpt: ['llm'],
}

// Insensible aux accents/casse — « hebergement » trouve « Hébergement ».
const norm = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

interface Row {
  key: string; name: string; description: string; category: string
  icon: Icon
}

const rowOf = (t: PickerTemplate): Row => ({
  key: t.key, name: t.name, description: t.description || '', category: t.category,
  icon: CAT_ICON[t.category] || FileText,
})

export default function TemplatePicker({ value, onChange, templates, open, onOpenChange }: {
  value: string                 // '' = valeur libre
  onChange: (key: string) => void
  templates: PickerTemplate[]
  open?: boolean                // optionnel : état contrôlé (nécessaire dans
  onOpenChange?: (b: boolean) => void  // un dialog — voir CreateDialog)
}) {
  const { t } = useLang()
  const [openState, setOpenState] = React.useState(false)
  const isOpen = open ?? openState
  const setOpen = (b: boolean) => { setOpenState(b); onOpenChange?.(b) }
  const [query, setQuery] = React.useState('')
  const [active, setActive] = React.useState(0)
  const boxRef = React.useRef<HTMLDivElement>(null)
  const searchRef = React.useRef<HTMLInputElement>(null)
  const rowRefs = React.useRef<(HTMLButtonElement | null)[]>([])

  // La « valeur libre » participe à la recherche comme un template
  // (mots-clés anglais inclus : un utilisateur peut taper « free »).
  const freeTpl = (): PickerTemplate => ({
    key: '', name: String(t.freeValue), category: '',
    description: `${String(t.freeDesc)} libre free-form`,
  })

  // Groupes affichés : recherche vide → basiques épinglés + tout, sinon
  // seulement ce qui matche (la valeur libre si elle matche aussi).
  const groups = React.useMemo(() => {
    const tokens = norm(query).split(/\s+/).filter(Boolean)
    const match = (tpl: PickerTemplate) => {
      const hay = norm(`${tpl.name} ${tpl.key} ${tpl.category} ${tpl.description || ''}`)
      return tokens.every(tok => {
        const alts = [tok, ...(ALIASES[tok] || [])]
        return alts.some(a => hay.includes(a))
      })
    }
    const byKey = new Map(templates.map(t => [t.key, t]))
    type Group = { id: string; label: string; rows: Row[] }
    const out: Group[] = []
    if (!tokens.length) {
      const basics = [rowOf(freeTpl()),
        ...POPULAR.map(k => byKey.get(k)).filter((x): x is PickerTemplate => !!x).map(rowOf)]
      out.push({ id: 'basics', label: String(t.tplBasics), rows: basics })
    } else if (match(freeTpl())) {
      out.push({ id: 'basics', label: String(t.tplBasics), rows: [rowOf(freeTpl())] })
    }
    const byCat = new Map<string, Row[]>()
    for (const tpl of templates) {
      if (tokens.length && !match(tpl)) continue
      const arr = byCat.get(tpl.category) || []
      arr.push(rowOf(tpl))
      byCat.set(tpl.category, arr)
    }
    for (const cat of [...byCat.keys()].sort())
      out.push({ id: cat, label: cat, rows: byCat.get(cat)! })
    return out
  }, [templates, query, t])

  const flat = React.useMemo(() => groups.flatMap(g => g.rows), [groups])
  // bornes : à la fermeture/vider la recherche, l'actif suit la liste
  const activeIdx = Math.min(active, Math.max(0, flat.length - 1))

  // Ouverture : recherche vierge, curseur dans le champ, hors clic ferme.
  React.useEffect(() => {
    if (!isOpen) return
    setQuery(''); setActive(0)
    searchRef.current?.focus()
    const down = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', down)
    return () => document.removeEventListener('mousedown', down)
  }, [isOpen])

  // L'élément actif reste visible au clavier (sans animation — saut direct).
  React.useEffect(() => {
    rowRefs.current[activeIdx]?.scrollIntoView({ block: 'nearest' })
  }, [activeIdx])

  const pick = (k: string) => { onChange(k); setOpen(false) }

  // Escape : géré par le dialog hôte via onEscapeKeyDown — Radix écoute
  // document en phase CAPTURE, aucun listener d'élément ne peut passer
  // avant ; le seul point d'ancrage est son contrat preventDefault.

  const onSearchKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(Math.min(activeIdx + 1, flat.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(Math.max(0, activeIdx - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (flat[activeIdx]) pick(flat[activeIdx].key) }
  }

  const sel = templates.find(x => x.key === value)
  const SelIcon = sel ? (CAT_ICON[sel.category] || FileText) : FileText

  return (
    <div ref={boxRef} className="relative">
      {/* déclencheur — état courant visible sans ouvrir le panneau */}
      <button type="button" onClick={() => setOpen(!isOpen)}
        aria-haspopup="listbox" aria-expanded={isOpen}
        className="w-full h-9 flex items-center gap-2 bg-bg border border-border rounded-lg px-3 text-sm cursor-pointer text-left outline-none focus:border-accent"
      >
        <SelIcon size={14} className="text-fg-3 shrink-0" />
        <span className={cn('flex-1 truncate', sel ? 'text-fg' : 'text-fg-3')}>
          {sel ? sel.name : String(t.freeValue)}
        </span>
        {sel && <span className="text-[11px] text-fg-3 shrink-0">{sel.category}</span>}
        {isOpen ? <ChevronUp size={14} className="text-fg-3 shrink-0" /> : <ChevronDown size={14} className="text-fg-3 shrink-0" />}
      </button>

      {/* panneau — dans le flux du dialog : aucun z-index, aucun portail,
          aucune animation (règle v1.7.2). Hauteur bornée, défilement interne. */}
      {isOpen && (
        <div className="mt-1.5 bg-card border border-border rounded-lg overflow-hidden shadow-lg">
          <div className="flex items-center gap-2 px-3 border-b border-border">
            <Search size={14} className="text-fg-3 shrink-0" />
            <input ref={searchRef} value={query}
              onChange={e => { setQuery(e.target.value); setActive(0) }}
              onKeyDown={onSearchKey}
              placeholder={String(t.tplSearchPH)}
              className="flex-1 h-9 bg-transparent text-sm text-fg placeholder:text-fg-3 outline-none"
            />
            {query && (
              <button type="button" onClick={() => { setQuery(''); setActive(0) }}
                className="text-fg-3 hover:text-fg cursor-pointer shrink-0"><X size={13} /></button>
            )}
          </div>

          <div role="listbox" className="max-h-72 overflow-y-auto py-1">
            {flat.length === 0 && (
              <div className="px-3 py-6 text-center text-xs text-fg-3">{String(t.noResults)}</div>
            )}
            {groups.map(g => g.rows.length > 0 && (
              <div key={g.id}>
                <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-fg-3 select-none">{g.label}</div>
                {g.rows.map(r => {
                  const i = flat.indexOf(r)
                  const isActive = i === activeIdx
                  const RowIcon = r.icon
                  return (
                    <button type="button" key={r.key || '__free__'} role="option" aria-selected={r.key === value}
                      ref={el => { rowRefs.current[i] = el }}
                      onClick={() => pick(r.key)}
                      onMouseEnter={() => setActive(i)}
                      className={cn(
                        'w-full flex items-center gap-2.5 px-3 py-1.5 text-left cursor-pointer',
                        isActive ? 'bg-accent/10' : 'hover:bg-card-2',
                      )}
                    >
                      <RowIcon size={14} className={cn('shrink-0', isActive ? 'text-accent' : 'text-fg-3')} />
                      <span className="min-w-0 flex-1">
                        <span className={cn('block text-sm truncate', isActive ? 'text-accent' : 'text-fg')}>
                          <Marked text={r.name} q={query} />
                        </span>
                        {r.description && (
                          <span className="block text-[11px] text-fg-3 truncate">
                            <Marked text={r.description} q={query} />
                          </span>
                        )}
                      </span>
                      {r.key === value && <Check size={13} className="text-accent shrink-0" />}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// Surligne le premier token trouvé dans le texte — montre POURQUOI la ligne
// matche (le cœur du problème initial : « on trouve pas facilement »).
// Simple indexOf insensible à la casse : suffisant, jamais faux positif.
function Marked({ text, q }: { text: string; q: string }) {
  const tok = q.trim().split(/\s+/)[0]
  if (!tok) return <>{text}</>
  const i = text.toLowerCase().indexOf(tok.toLowerCase())
  if (i < 0) return <>{text}</>
  return <>
    {text.slice(0, i)}
    <mark className="bg-transparent text-accent font-semibold">{text.slice(i, i + tok.length)}</mark>
    {text.slice(i + tok.length)}
  </>
}
