// Coffre v2 — dialog d'un élément : vue détaillée (sections par type de
// champ) et édition complète (champs personnalisés, multi-TOTP, tags).
import * as React from 'react'
import { toast } from 'sonner'
import {
  Star, Copy, Eye, EyeOff, Trash2, Pencil, LoaderCircle, Plus, X,
  ExternalLink, Wand2, History,
} from 'lucide-react'
import { useLang } from '@/i18n'
import { Button, Badge, Dialog, DialogContent, Input, PasswordInput, Field, Label } from '@/components/ui'
import { cn, fmtDateTime } from '@/lib/utils'
import * as C from '@/lib/coffre'
import { CATEGORIES, fmtField, mainPasswordField, type CoffreField, type CoffreItemData, type DecryptedItem, type FieldKind } from '@/lib/coffre-schema'
import { TotpLive, Strength, useCopy, CAT_ICON, CAT_COLOR } from './parts'

const KIND_LABEL_KEY: Record<FieldKind, string> = {
  text: 'cofKindText', secret: 'cofKindSecret', totp: 'cofKindTotp',
  link: 'cofKindLink', month: 'cofKindMonth', date: 'cofKindDate', multiline: 'cofKindMultiline',
}

// draft : nouvel élément construit depuis un modèle par le picker ;
// item : élément existant à voir/éditer.
export default function ItemDialog({ item, draft, lang, items, onClose, onSaved, onDeleted }: {
  item?: DecryptedItem
  draft?: CoffreItemData
  lang: 'fr' | 'en'
  items: DecryptedItem[]
  onClose: () => void
  onSaved: (data: CoffreItemData, existing?: DecryptedItem) => Promise<void>
  onDeleted: (id: string) => Promise<void>
}) {
  const { t } = useLang()
  const copy = useCopy()
  const isNew = !item
  const [edit, setEdit] = React.useState(isNew)
  const [busy, setBusy] = React.useState(false)
  const [shown, setShown] = React.useState<Set<number>>(new Set())
  const [d, setD] = React.useState<CoffreItemData>(() =>
    item ? C.normalizeItem(item) : { ...(draft || C.normalizeItem({ v: 1, type: 'note', name: '' })) })

  const folders = [...new Set(items.map(i => i.folder || '').filter(Boolean))]
  const allTags = [...new Set(items.flatMap(i => i.tags || []))]
  const mainPw = mainPasswordField(d)
  const st = C.passwordStrength(mainPw?.v || '')

  const set = (patch: Partial<CoffreItemData>) => setD(prev => ({ ...prev, ...patch }))
  const setField = (i: number, patch: Partial<CoffreField>) =>
    setD(prev => { const fields = prev.fields.map((x, j) => j === i ? { ...x, ...patch } : x); return { ...prev, fields } })
  const addField = () => setD(prev => ({ ...prev, fields: [...prev.fields, { k: 'text', l: '', v: '' }] }))
  const delField = (i: number) => setD(prev => ({ ...prev, fields: prev.fields.filter((_, j) => j !== i) }))
  const toggleShow = (i: number) => setShown(prev => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n })

  const save = async () => {
    if (busy) return
    if (!d.name.trim()) { toast.error(String(t.cofNameRequired)); return }
    setBusy(true)
    try {
      let out: CoffreItemData = { ...d, name: d.name.trim(), folder: (d.folder || '').trim() }
      // historique : l'ancien mot de passe principal est conservé
      const oldPw = item ? mainPasswordField(C.normalizeItem(item))?.v : ''
      const newPw = mainPasswordField(out)?.v || ''
      if (!isNew && oldPw && newPw && oldPw !== newPw) {
        out = { ...out,
          history: [...(item!.history || []), { password: oldPw, changed_at: new Date().toISOString() }].slice(-10),
          password_updated_at: new Date().toISOString(),
        }
      }
      await onSaved(out, item)
      onClose()
    } catch { /* toast déjà affiché par la page */ }
    setBusy(false)
  }

  const cat = CATEGORIES[d.type]
  const Icon = CAT_ICON[d.type]

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="max-w-lg" title={isNew ? t.cofNew : d.name}>
        {!edit ? (
          // ================= VUE =================
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn('w-8 h-8 rounded-lg grid place-items-center shrink-0', CAT_COLOR[d.type])}><Icon size={16} /></span>
              <span className="text-sm font-semibold">{d.name}</span>
              {d.favorite && <Star size={13} className="text-warn fill-warn" />}
              {d.folder && <Badge variant="accent">{d.folder}</Badge>}
              {(d.tags || []).map(tg => <Badge key={tg} variant="neutral">#{tg}</Badge>)}
            </div>

            {d.fields.filter(x => x.v || x.l).map((fl, i) => (
              <FieldView key={i} i={i} f={fl} shown={shown.has(i)} onToggle={() => toggleShow(i)}
                onCopy={() => copy(fl.v)} strength={fl === mainPw ? st : undefined} />
            ))}

            {d.notes && (
              <div>
                <Label>{t.cofNotes}</Label>
                <p className="text-sm text-fg-2 whitespace-pre-wrap rounded-lg bg-card-2 border border-border p-3 max-h-40 overflow-auto">{d.notes}</p>
              </div>
            )}

            {(d.history || []).length > 0 && (
              <details className="text-sm">
                <summary className="text-xs text-fg-3 cursor-pointer inline-flex items-center gap-1.5 select-none"><History size={12} />{t.cofHistory} ({d.history!.length})</summary>
                <div className="mt-2 space-y-1.5">
                  {d.history!.slice().reverse().map((h, i) => (
                    <div key={i} className="flex items-center justify-between text-xs text-fg-3">
                      <span className="font-mono truncate max-w-56">{h.password}</span>
                      <span className="flex items-center gap-2">
                        {fmtDateTime(h.changed_at)}
                        <button onClick={() => copy(h.password)} className="hover:text-fg cursor-pointer"><Copy size={12} /></button>
                      </span>
                    </div>
                  ))}
                </div>
              </details>
            )}

            <div className="flex items-center justify-between pt-3">
              <span className="text-[11px] text-fg-3">{t.cofPwUpdated} : {fmtDateTime((item as any).password_updated_at) || '—'}</span>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => onDeleted(item!.id).then(onClose)}><Trash2 size={13} />{t.cofDelete}</Button>
                <Button variant="primary" size="sm" onClick={() => setEdit(true)}><Pencil size={13} />{t.cofEdit}</Button>
              </div>
            </div>
          </div>
        ) : (
          // ================= ÉDITION =================
          <div className="space-y-3.5 max-h-[65vh] overflow-auto pr-1">
            <div className="flex items-center gap-2">
              <span className={cn('w-8 h-8 rounded-lg grid place-items-center shrink-0', CAT_COLOR[d.type])}><Icon size={16} /></span>
              <span className="text-xs text-fg-3 flex-1">{cat ? String(t['cofCat' + d.type[0].toUpperCase() + d.type.slice(1)] as any) : ''}</span>
              <Button variant={d.favorite ? 'secondary' : 'ghost'} size="icon" onClick={() => set({ favorite: !d.favorite })} title={t.cofFavorite}>
                <Star size={15} className={d.favorite ? 'text-warn fill-warn' : ''} />
              </Button>
            </div>
            <Field label={t.cofName}><Input value={d.name} onChange={e => set({ name: e.target.value })} autoFocus /></Field>

            {d.fields.map((fl, i) => (
              <div key={i} className="flex gap-1.5 items-start">
                <div className="flex-1 min-w-0">
                  <div className="flex gap-1.5 mb-1.5">
                    <Input value={fl.l} onChange={e => setField(i, { l: e.target.value })}
                      placeholder={String(t.cofLabel)} className="h-7 text-[11px] px-2" />
                    <select value={fl.k} onChange={e => setField(i, { k: e.target.value as FieldKind })}
                      className="h-7 bg-bg border border-border rounded-lg px-1.5 text-[11px] text-fg-2 shrink-0">
                      {(['text', 'secret', 'totp', 'link', 'month', 'date', 'multiline'] as const).map(k => (
                        <option key={k} value={k}>{String(t[KIND_LABEL_KEY[k] as any])}</option>
                      ))}
                    </select>
                  </div>
                  {fl.k === 'secret' ? (
                    <div className="flex gap-1.5">
                      <PasswordInput value={fl.v} onChange={e => setField(i, { v: e.target.value })}
                        className={cn('text-sm', fl === mainPw && C.passwordStrength(fl.v).label === 'weak' && fl.v && 'border-danger/50')} />
                      <Button variant="secondary" size="icon" title={t.cofGenerate}
                        onClick={() => setField(i, { v: C.generatePassword({ length: 20, upper: true, lower: true, digits: true, symbols: true }) })}>
                        <Wand2 size={14} />
                      </Button>
                    </div>
                  ) : fl.k === 'multiline' ? (
                    <textarea value={fl.v} onChange={e => setField(i, { v: e.target.value })}
                      className="w-full min-h-16 bg-bg border border-border rounded-lg p-3 text-sm font-mono text-fg focus:border-accent focus:ring-2 focus:ring-accent/20 outline-none" />
                  ) : fl.k === 'month' ? (
                    <Input type="month" value={fl.v} onChange={e => setField(i, { v: e.target.value })} />
                  ) : fl.k === 'date' ? (
                    <Input type="date" value={fl.v} onChange={e => setField(i, { v: e.target.value })} />
                  ) : (
                    <Input value={fl.v} onChange={e => setField(i, { v: e.target.value })}
                      placeholder={fl.k === 'link' ? 'https://…' : fl.k === 'totp' ? 'otpauth://… ou seed base32' : ''}
                      className={cn(fl.k === 'totp' && 'font-mono')} />
                  )}
                  {fl.k === 'totp' && fl.v && <div className="mt-1.5"><TotpLive value={fl.v} /></div>}
                  {fl.k === 'secret' && fl.v && fl === mainPw && <div className="mt-1.5"><Strength pw={fl.v} /></div>}
                </div>
                <Button variant="ghost" size="icon" className="mt-7 shrink-0" title={t.cofRemoveField}
                  onClick={() => delField(i)}><X size={14} /></Button>
              </div>
            ))}

            <Button variant="ghost" size="sm" onClick={addField} className="text-fg-2"><Plus size={14} />{t.cofAddField}</Button>

            <Field label={t.cofNotes}>
              <textarea value={d.notes} onChange={e => set({ notes: e.target.value })}
                className="w-full min-h-20 bg-bg border border-border rounded-lg p-3 text-sm text-fg placeholder:text-fg-3 focus:border-accent focus:ring-2 focus:ring-accent/20 outline-none" />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label={t.cofFolder}>
                <input list="coffre-folders" value={d.folder} onChange={e => set({ folder: e.target.value })} maxLength={64}
                  className="w-full h-9 bg-bg border border-border rounded-lg px-3 text-sm text-fg focus:border-accent focus:ring-2 focus:ring-accent/20 outline-none" />
                <datalist id="coffre-folders">{folders.map(f => <option key={f} value={f} />)}</datalist>
              </Field>
              <Field label={t.cofTags} help="séparées par des virgules">
                <input list="coffre-tags" value={(d.tags || []).join(', ')}
                  onChange={e => set({ tags: e.target.value.split(',').map(s => s.trim().replace(/^#/, '')).filter(Boolean) })} maxLength={128}
                  className="w-full h-9 bg-bg border border-border rounded-lg px-3 text-sm text-fg focus:border-accent focus:ring-2 focus:ring-accent/20 outline-none" />
                <datalist id="coffre-tags">{allTags.map(f => <option key={f} value={f} />)}</datalist>
              </Field>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={onClose}>{t.cofCancel}</Button>
              <Button variant="primary" disabled={busy} onClick={save}>
                {busy ? <LoaderCircle className="animate-spin" /> : null} {t.cofSave}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ---- une ligne de champ en vue ----
function FieldView({ f, i, shown, onToggle, onCopy, strength }: {
  f: CoffreField; i: number; shown: boolean; onToggle: () => void; onCopy: () => void
  strength?: { bits: number; label: string }
}) {
  const { t } = useLang()
  if (f.k === 'totp') {
    return (
      <div className="flex items-center justify-between border-b border-border pb-2">
        <Label className="text-fg-2 shrink-0">{f.l || 'TOTP'}</Label>
        <TotpLive value={f.v} />
      </div>
    )
  }
  if (f.k === 'multiline') {
    return (
      <div>
        {f.l && <Label>{f.l}</Label>}
        <p className="text-sm text-fg-2 whitespace-pre-wrap rounded-lg bg-card-2 border border-border p-3 max-h-40 overflow-auto font-mono">{f.v}</p>
      </div>
    )
  }
  const display = f.k === 'secret'
    ? (shown ? f.v : '•'.repeat(Math.min(20, f.v.length)))
    : fmtField(f.k, f.v)
  return (
    <div className="border-b border-border pb-2">
      <div className="flex items-center justify-between gap-3">
        <Label className="text-fg-3 shrink-0 max-w-40 truncate">{f.l || '—'}</Label>
        <span className={cn('text-sm truncate flex-1 text-right', f.k === 'secret' && 'font-mono')}>{display}</span>
        <span className="flex gap-1 shrink-0">
          {f.k === 'link' && f.v && (
            <a href={f.v} target="_blank" rel="noreferrer" className="h-7 w-7 grid place-items-center rounded-md text-fg-3 hover:text-fg hover:bg-card-2 cursor-pointer"><ExternalLink size={13} /></a>
          )}
          {f.k === 'secret' && (
            <button onClick={onToggle} className="h-7 w-7 grid place-items-center rounded-md text-fg-3 hover:text-fg hover:bg-card-2 cursor-pointer" title={shown ? t.cofHide : t.cofShow}>
              {shown ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
          )}
          <Button variant="ghost" size="icon" onClick={onCopy}><Copy size={13} /></Button>
        </span>
      </div>
      {strength && <div className="mt-1.5 flex justify-end"><Strength pw={f.v} /></div>}
    </div>
  )
}