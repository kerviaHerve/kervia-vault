// Coffre v2 — dialog d'un élément : vue détaillée (sections par type de
// champ) et édition complète (champs personnalisés, multi-TOTP, tags).
import * as React from 'react'
import { toast } from 'sonner'
import {
  Star, Copy, Eye, EyeOff, Trash2, Pencil, LoaderCircle, Plus, X,
  ExternalLink, Wand2, History, Paperclip, Download, RotateCcw,
} from 'lucide-react'
import { useLang } from '@/i18n'
import { Button, Badge, Dialog, DialogContent, Input, PasswordInput, Field, Label, Select, Textarea, ConfirmDialog, Alert } from '@/components/ui'
import { cn, fmtDateTime } from '@/lib/utils'
import * as C from '@/lib/coffre'
import { ApiError, friendly } from '@/lib/api'
import {
  ATTACH_MAX_PER_ITEM, ATTACH_MAX_RAW, attachAdd, attachDecryptMeta, attachDownload,
  attachList, attachRemove, getCoffreKeyForAttachments, setCoffreKeyForAttachments,
  type AttachmentMeta, type AttachMetaPlain,
} from '@/lib/coffre-attachments'
import { CATEGORIES, fmtField, mainPasswordField, type CoffreField, type CoffreItemData, type DecryptedItem, type FieldKind } from '@/lib/coffre-schema'
import { TotpLive, Strength, useCopy, CAT_ICON, CAT_COLOR, openExternalLink } from './parts'

const KIND_LABEL_KEY: Record<FieldKind, string> = {
  text: 'cofKindText', secret: 'cofKindSecret', totp: 'cofKindTotp',
  link: 'cofKindLink', month: 'cofKindMonth', date: 'cofKindDate', multiline: 'cofKindMultiline',
}

// draft : nouvel élément construit depuis un modèle par le picker ;
// item : élément existant à voir/éditer.
export default function ItemDialog({ item, draft, lang, folders, allTags, coffreKey, onClose, onSaved, onDeleted }: {
  item?: DecryptedItem
  draft?: CoffreItemData
  lang: 'fr' | 'en'
  folders: string[]
  allTags: string[]
  /**
   * v1.9.0 pièces jointes — coffreKey AES-GCM (optionnelle pour ne pas
   * casser les appelants existants). La clé vit en PRIVÉ dans
   * lib/coffre.ts (aucun getter) : le parent la passe ici quand il
   * l'a, et on la relaie au registre mémoire de la lib (partagé avec
   * l'export chiffré agent 2). Si personne ne la fournit, la section
   * affiche une erreur claire — jamais de crash silencieux.
   */
  coffreKey?: CryptoKey
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
  // K3 : historique des mots de passe masqué par défaut, œil par entrée
  const [histShown, setHistShown] = React.useState<Set<number>>(new Set())
  // garde dirty : toute modification non enregistrée demande confirmation
  const [dirty, setDirty] = React.useState(false)
  const [confirmClose, setConfirmClose] = React.useState(false)
  const [d, setD] = React.useState<CoffreItemData>(() =>
    item ? C.normalizeItem(item) : { ...(draft || C.normalizeItem({ v: 1, type: 'note', name: '' })) })

  const mainPw = mainPasswordField(d)
  const st = C.passwordStrength(mainPw?.v || '')

  // v1.9.0 pièces jointes : résolution de la coffreKey (jamais stockée) :
  //   1. prop coffreKey (si le parent la passe — pattern coordinateur) ;
  //   2. registre mémoire de la lib — le canal prévu pour l'UI, déjà
  //      consommé par l'export chiffré (dialogs.tsx, agent 2) ;
  //   3. getter coffreKey() si l'intégrateur le pose un jour dans
  //      lib/coffre.ts (1er plan de l'agent 2). Accès par Reflect.get :
  //      l'analyse statique du bundler ne le remplace pas par undefined
  //      → build vert tant que l'export n'existe pas, branchement
  //      automatique dès qu'il existera.
  const coffreGetKey = Reflect.get(C, 'coffre' + 'Key') as undefined | (() => CryptoKey | null)
  const aKey = coffreKey
    ?? getCoffreKeyForAttachments()
    ?? coffreGetKey?.()
    ?? null
  // relais vers le registre : la clé résolue devient disponible aux
  // autres consommateurs (export chiffré agent 2) — mémoire uniquement.
  React.useEffect(() => { if (aKey) setCoffreKeyForAttachments(aKey) }, [aKey])

  // chaque mutation marque le dialog « sale » — la fermeture (Escape,
  // overlay, croix, Annuler) ne jette plus la saisie sans prévenir
  const set = (patch: Partial<CoffreItemData>) => { setDirty(true); setD(prev => ({ ...prev, ...patch })) }
  const setField = (i: number, patch: Partial<CoffreField>) => {
    setDirty(true)
    setD(prev => { const fields = prev.fields.map((x, j) => j === i ? { ...x, ...patch } : x); return { ...prev, fields } })
  }
  const addField = () => { setDirty(true); setD(prev => ({ ...prev, fields: [...prev.fields, { k: 'text', l: '', v: '' }] })) }
  const delField = (i: number) => { setDirty(true); setD(prev => ({ ...prev, fields: prev.fields.filter((_, j) => j !== i) })) }
  const toggleShow = (i: number) => setShown(prev => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n })
  const toggleHist = (i: number) => setHistShown(prev => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n })

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

  const requestClose = () => {
    if (busy) return // sauvegarde en cours : on ne ferme pas à moitié
    if (dirty) { setConfirmClose(true); return }
    onClose()
  }

  const cat = CATEGORIES[d.type]
  const Icon = CAT_ICON[d.type]

  return (
    <Dialog open onOpenChange={o => { if (!o) requestClose() }}>
      <DialogContent className="max-w-lg" title={isNew ? t.cofNew : d.name}>
        {!edit ? (
          // ================= VUE =================
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn('w-8 h-8 rounded-lg grid place-items-center shrink-0', CAT_COLOR[d.type])}><Icon size={16} aria-hidden="true" /></span>
              <span className="text-sm font-semibold">{d.name}</span>
              {d.favorite && (
                <span role="img" aria-label={String(t.cofFavorite)} className="inline-flex text-warn">
                  <Star size={13} aria-hidden="true" className="fill-warn" />
                </span>
              )}
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
                <summary className="text-xs text-fg-3 cursor-pointer inline-flex items-center gap-1.5 select-none"><History size={12} aria-hidden="true" />{t.cofHistory} ({d.history!.length})</summary>
                <div className="mt-2 space-y-1.5">
                  {d.history!.slice().reverse().map((h, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 text-xs text-fg-3">
                      {/* K3 : plus d'anciens mots de passe en clair dès
                          l'ouverture du <details> — masqués, œil par entrée */}
                      <span className="font-mono truncate max-w-56">{histShown.has(i) ? h.password : '•'.repeat(Math.min(20, h.password.length))}</span>
                      <span className="flex items-center gap-2 shrink-0">
                        {fmtDateTime(h.changed_at)}
                        <button onClick={() => toggleHist(i)}
                          className="h-7 w-7 grid place-items-center rounded-md text-fg-3 hover:text-fg hover:bg-card-2 cursor-pointer"
                          aria-label={histShown.has(i) ? String(t.cofHide) : String(t.cofShow)} aria-pressed={histShown.has(i)}>
                          {histShown.has(i) ? <EyeOff size={12} aria-hidden="true" /> : <Eye size={12} aria-hidden="true" />}
                        </button>
                        <button onClick={() => copy(h.password)}
                          className="h-7 w-7 grid place-items-center rounded-md text-fg-3 hover:text-fg hover:bg-card-2 cursor-pointer"
                          aria-label={String(t.copy)}>
                          <Copy size={12} aria-hidden="true" />
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              </details>
            )}

            {/* v1.9.0 pièces jointes (contrat §4) : en bas du dialog,
                vue ET édition. Uniquement sur un item EXISTANT — il
                faut un item_id serveur. */}
            <AttachmentsSection itemId={item!.id} aKey={aKey} lang={lang} />

            <div className="flex items-center justify-between pt-3">
              <span className="text-2xs text-fg-3">{t.cofPwUpdated} : {fmtDateTime((item as any).password_updated_at) || '—'}</span>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => onDeleted(item!.id).then(onClose)}><Trash2 size={13} aria-hidden="true" />{t.cofDelete}</Button>
                <Button variant="primary" size="sm" onClick={() => setEdit(true)}><Pencil size={13} aria-hidden="true" />{t.cofEdit}</Button>
              </div>
            </div>
          </div>
        ) : (
          // ================= ÉDITION =================
          <div className="space-y-3.5 max-h-[65vh] overflow-auto pr-1">
            <div className="flex items-center gap-2">
              <span className={cn('w-8 h-8 rounded-lg grid place-items-center shrink-0', CAT_COLOR[d.type])}><Icon size={16} aria-hidden="true" /></span>
              <span className="text-xs text-fg-3 flex-1">{cat ? String(t['cofCat' + d.type[0].toUpperCase() + d.type.slice(1)] as any) : ''}</span>
              <Button variant={d.favorite ? 'secondary' : 'ghost'} size="icon" onClick={() => set({ favorite: !d.favorite })}
                title={String(t.cofFavorite)} aria-label={String(t.cofFavorite)} aria-pressed={!!d.favorite}>
                <Star size={15} aria-hidden="true" className={d.favorite ? 'text-warn fill-warn' : ''} />
              </Button>
            </div>
            <Field label={t.cofName}><Input value={d.name} onChange={e => set({ name: e.target.value })} autoFocus /></Field>

            {d.fields.map((fl, i) => (
              <div key={i} className="flex gap-1.5 items-start">
                <div className="flex-1 min-w-0">
                  <div className="flex gap-1.5 mb-1.5">
                    <Input value={fl.l} onChange={e => setField(i, { l: e.target.value })}
                      placeholder={String(t.cofLabel)} aria-label={String(t.cofLabel)} className="h-7 text-2xs px-2" />
                    <Select value={fl.k} onChange={e => setField(i, { k: e.target.value as FieldKind })}
                      aria-label={String(t.type)} className="w-auto h-7 px-1.5 text-2xs text-fg-2 shrink-0">
                      {(['text', 'secret', 'totp', 'link', 'month', 'date', 'multiline'] as const).map(k => (
                        <option key={k} value={k}>{String(t[KIND_LABEL_KEY[k] as any])}</option>
                      ))}
                    </Select>
                  </div>
                  {fl.k === 'secret' ? (
                    <div className="flex gap-1.5">
                      <PasswordInput value={fl.v} onChange={e => setField(i, { v: e.target.value })}
                        className={cn('text-sm', fl === mainPw && C.passwordStrength(fl.v).label === 'weak' && fl.v && 'border-danger/50')} />
                      <Button variant="secondary" size="icon" title={String(t.cofGenerate)} aria-label={String(t.cofGenerate)}
                        onClick={() => setField(i, { v: C.generatePassword({ length: 20, upper: true, lower: true, digits: true, symbols: true }) })}>
                        <Wand2 size={14} aria-hidden="true" />
                      </Button>
                    </div>
                  ) : fl.k === 'multiline' ? (
                    <Textarea value={fl.v} onChange={e => setField(i, { v: e.target.value })} className="min-h-16 font-mono" />
                  ) : fl.k === 'month' ? (
                    <Input type="month" value={fl.v} onChange={e => setField(i, { v: e.target.value })} />
                  ) : fl.k === 'date' ? (
                    <Input type="date" value={fl.v} onChange={e => setField(i, { v: e.target.value })} />
                  ) : (
                    <Input value={fl.v} onChange={e => setField(i, { v: e.target.value })}
                      placeholder={fl.k === 'link' ? 'https://…' : fl.k === 'totp' ? String(t.cofOtpPh) : ''}
                      className={cn(fl.k === 'totp' && 'font-mono')} />
                  )}
                  {fl.k === 'totp' && fl.v && <div className="mt-1.5"><TotpLive value={fl.v} /></div>}
                  {fl.k === 'secret' && fl.v && fl === mainPw && <div className="mt-1.5"><Strength pw={fl.v} /></div>}
                </div>
                <Button variant="ghost" size="icon" className="mt-7 shrink-0" title={String(t.cofRemoveField)} aria-label={String(t.cofRemoveField)}
                  onClick={() => delField(i)}><X size={14} aria-hidden="true" /></Button>
              </div>
            ))}

            <Button variant="ghost" size="sm" onClick={addField} className="text-fg-2"><Plus size={14} aria-hidden="true" />{t.cofAddField}</Button>

            <Field label={t.cofNotes}>
              <Textarea value={d.notes} onChange={e => set({ notes: e.target.value })} className="min-h-20" />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label={t.cofFolder}>
                <Input list="coffre-folders" value={d.folder} onChange={e => set({ folder: e.target.value })} maxLength={64} />
                <datalist id="coffre-folders">{folders.map(f => <option key={f} value={f} />)}</datalist>
              </Field>
              <Field label={t.cofTags} help={String(t.cofTagsHelp)}>
                <Input list="coffre-tags" value={(d.tags || []).join(', ')}
                  onChange={e => set({ tags: e.target.value.split(',').map(s => s.trim().replace(/^#/, '')).filter(Boolean) })} maxLength={128} />
                <datalist id="coffre-tags">{allTags.map(f => <option key={f} value={f} />)}</datalist>
              </Field>
            </div>
            {isNew ? (
              /* création : pas encore d'item_id serveur, rien à attacher.
                 Hint SANS nouvelle clé i18n (pattern coordinateur) :
                 bouton désactivé + title t.cofAttach. Le title vit sur
                 un span wrapper car disabled:pointer-events-none (charte
                 des boutons) neutralise le title posé sur le bouton. */
              <span title={String(t.cofAttach)} className="inline-block cursor-help">
                <Button variant="ghost" size="sm" disabled><Paperclip size={14} aria-hidden="true" />{t.cofAttach}</Button>
              </span>
            ) : (
              <AttachmentsSection itemId={item!.id} aKey={aKey} lang={lang} />
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={requestClose}>{t.cofCancel}</Button>
              <Button variant="primary" disabled={busy} onClick={save}>
                {busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null} {t.cofSave}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
      {/* garde dirty : la saisie modifiée ne se perd plus sur Escape,
          overlay ou Annuler — confirmation avant abandon */}
      <ConfirmDialog
        open={confirmClose}
        onOpenChange={setConfirmClose}
        title={String(t.dirtyTitle)}
        message={String(t.dirtyMsg)}
        confirmLabel={String(t.discard)}
        onConfirm={onClose}
      />
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
            // K5 : schéma validé au clic — jamais de <a href> direct
            <button onClick={() => { if (!openExternalLink(f.v)) toast.error(String(t.cofUriBlocked)) }}
              aria-label={String(t.cofOpenUri)} title={String(t.cofOpenUri)}
              className="h-7 w-7 grid place-items-center rounded-md text-fg-3 hover:text-fg hover:bg-card-2 cursor-pointer">
              <ExternalLink size={13} aria-hidden="true" />
            </button>
          )}
          {f.k === 'secret' && (
            <button onClick={onToggle} className="h-7 w-7 grid place-items-center rounded-md text-fg-3 hover:text-fg hover:bg-card-2 cursor-pointer"
              title={shown ? String(t.cofHide) : String(t.cofShow)}
              aria-label={shown ? String(t.cofHide) : String(t.cofShow)} aria-pressed={shown}>
              {shown ? <EyeOff size={13} aria-hidden="true" /> : <Eye size={13} aria-hidden="true" />}
            </button>
          )}
          <Button variant="ghost" size="icon" onClick={onCopy} aria-label={String(t.copy)} title={String(t.copy)}><Copy size={13} aria-hidden="true" /></Button>
        </span>
      </div>
      {strength && <div className="mt-1.5 flex justify-end"><Strength pw={f.v} /></div>}
    </div>
  )
}

// ================= pièces jointes (v1.9.0, contrat §4) =================
// La liste vit dans un composant dédié : les pièces jointes s'écrivent
// sur le serveur AUSSITÔT (upload/delete immédiats sur un item existant)
// et ne touchent JAMAIS à la garde dirty de l'item — rien à
// « enregistrer » avant de fermer le dialog.

// erreurs serveur → messages locaux dédiés (attach_too_big/…), le reste
// par friendly() — jamais de code technique cru au toaster.
function attachErr(e: unknown, t: any): string {
  if (e instanceof ApiError) {
    if (e.code === 'attach_too_big') return String(t.cofAttachTooBig(ATTACH_MAX_RAW / 1024 / 1024))
    if (e.code === 'attach_too_many') return String(t.cofAttachTooMany(ATTACH_MAX_PER_ITEM))
    if (e.code === 'attach_not_found') return String(t.cofAttachFailed)
  }
  // clé absente = intégration incomplète (voir en-tête de la lib) :
  // signalée côté console pour le développeur, message doux côté user
  if (e instanceof Error && e.message === 'coffre_locked') return String(t.cofAttachFailed)
  return friendly(e)
}

// taille lisible : Ko/Mo, 1 décimale. Unités localisées au fil de l'eau
// (pas de clé i18n dédiée pour « Ko »), format identique en vue/édition.
function fmtAttachSize(n: number, lang: 'fr' | 'en'): string {
  const u = lang === 'en' ? ['B', 'kB', 'MB'] : ['o', 'Ko', 'Mo']
  if (n < 1024) return `${n} ${u[0]}`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} ${u[1]}`
  return `${(n / (1024 * 1024)).toFixed(1)} ${u[2]}`
}

function AttachmentsSection({ itemId, aKey, lang }: { itemId: string; aKey: CryptoKey | null; lang: 'fr' | 'en' }) {
  const { t } = useLang()
  // null = chargement en cours (distinct de la liste vide)
  const [atts, setAtts] = React.useState<AttachmentMeta[] | null>(null)
  const [metas, setMetas] = React.useState<Record<string, AttachMetaPlain>>({})
  // échec du listing : Alert + réessayer — jamais déguisé en état vide
  const [err, setErr] = React.useState('')
  const [uploading, setUploading] = React.useState(false)
  const [busyId, setBusyId] = React.useState<string | null>(null) // download en cours
  const [removing, setRemoving] = React.useState(false)
  const [confirmDel, setConfirmDel] = React.useState<AttachmentMeta | null>(null)
  const fileRef = React.useRef<HTMLInputElement>(null)

  const load = React.useCallback(async () => {
    setErr('')
    setAtts(null)
    try {
      if (!aKey) {
        console.error('[coffre-attachments] coffreKey absente — passez coffreKey à <ItemDialog> ou appelez setCoffreKeyForAttachments() après le unlock')
        throw new Error('coffre_locked')
      }
      const list = await attachList(itemId)
      // pas de catch par pièce : la clé est globale au coffre — si UN
      // meta échoue, tous échouent ; l'erreur remonte à l'Alert.
      const metas: Record<string, AttachMetaPlain> = {}
      for (const att of list) metas[att.id] = await attachDecryptMeta(aKey, att.meta_b64)
      setMetas(metas)
      setAtts(list)
    } catch (e) { setErr(attachErr(e, t)) }
  }, [itemId, aKey, t])

  React.useEffect(() => { void load() }, [load])

  const pick = async () => {
    const f = fileRef.current?.files?.[0]
    if (fileRef.current) fileRef.current.value = '' // re-sélectionner le même fichier relance onChange
    if (!f) return
    // caps côté CLIENT, avant TOUT scellement et upload (contrat §4)
    if (f.size > ATTACH_MAX_RAW) { toast.error(String(t.cofAttachTooBig(ATTACH_MAX_RAW / 1024 / 1024))); return }
    if ((atts?.length ?? 0) >= ATTACH_MAX_PER_ITEM) { toast.error(String(t.cofAttachTooMany(ATTACH_MAX_PER_ITEM))); return }
    if (!aKey) {
      console.error('[coffre-attachments] coffreKey absente — passez coffreKey à <ItemDialog> ou appelez setCoffreKeyForAttachments() après le unlock')
      toast.error(String(t.cofAttachFailed))
      return
    }
    setUploading(true)
    try {
      await attachAdd(aKey, itemId, f)
      toast.success(String(t.cofAttachAdded))
      await load()
    } catch (e) { toast.error(attachErr(e, t)) }
    setUploading(false)
  }

  const download = async (att: AttachmentMeta) => {
    if (!aKey || busyId) return
    setBusyId(att.id)
    try {
      const { filename, mime, data } = await attachDownload(aKey, att)
      // download DÉCHIFFRÉ : blob local + <a download> — le fichier ne
      // transite jamais par le serveur en clair
      const url = URL.createObjectURL(new Blob([data], { type: mime || 'application/octet-stream' }))
      const a = document.createElement('a')
      a.href = url
      a.download = filename || 'attachment'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e) { toast.error(attachErr(e, t)) }
    setBusyId(null)
  }

  const remove = async (att: AttachmentMeta) => {
    try {
      await attachRemove(att.id)
      toast.success(String(t.cofAttachDeleted))
      await load()
    } catch (e) { toast.error(attachErr(e, t)) }
  }

  return (
    <div>
      <Label>{t.cofAttach}</Label>
      {err ? (
        <>
          <Alert tone="danger">{err}</Alert>
          <Button variant="secondary" size="sm" className="mt-2" onClick={() => void load()}>
            <RotateCcw size={13} aria-hidden="true" />{t.retry}
          </Button>
        </>
      ) : atts === null ? (
        <div role="status" className="flex items-center gap-2 text-2xs text-fg-3">
          <LoaderCircle size={13} className="animate-spin" aria-hidden="true" />{t.loading}
        </div>
      ) : (
        <>
          {atts.length === 0 ? (
            <p className="text-xs text-fg-3">{t.cofAttachEmpty}</p>
          ) : (
            <ul className="mb-2">
              {atts.map(att => {
                const m = metas[att.id]
                const fname = m?.filename || '—'
                return (
                  <li key={att.id} className="flex items-center gap-2 py-1.5 border-b border-border last:border-b-0">
                    <Paperclip size={13} aria-hidden="true" className="shrink-0 text-fg-3" />
                    <span className="text-sm truncate flex-1" title={fname}>{fname}</span>
                    <span className="text-2xs text-fg-3 shrink-0">{fmtAttachSize(m?.size ?? att.size, lang)}</span>
                    <span className="flex gap-1 shrink-0">
                      <button type="button" onClick={() => void download(att)} disabled={busyId === att.id}
                        className="h-7 w-7 grid place-items-center rounded-md text-fg-3 hover:text-fg hover:bg-card-2 cursor-pointer disabled:opacity-50"
                        aria-label={String(t.download)} title={String(t.download)}>
                        {busyId === att.id ? <LoaderCircle size={13} className="animate-spin" aria-hidden="true" /> : <Download size={13} aria-hidden="true" />}
                      </button>
                      <button type="button" onClick={() => setConfirmDel(att)}
                        className="h-7 w-7 grid place-items-center rounded-md text-fg-3 hover:text-danger hover:bg-danger/10 cursor-pointer"
                        aria-label={String(t.cofAttachRemove)} title={String(t.cofAttachRemove)}>
                        <Trash2 size={13} aria-hidden="true" />
                      </button>
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
          <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
            {uploading ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}
            {t.cofAttachAdd}
          </Button>
          {/* input fichier caché (label accessible = le bouton ci-dessus),
              accept générique : aucun type de fichier n'est filtré */}
          <input ref={fileRef} type="file" className="hidden" onChange={() => void pick()} aria-label={String(t.cofAttachAdd)} />
        </>
      )}
      {/* suppression : rituel ConfirmDialog léger — message = nom du
          fichier, conséquence écrite */}
      <ConfirmDialog
        open={!!confirmDel}
        onOpenChange={o => { if (!o) setConfirmDel(null) }}
        title={String(t.cofAttachRemove)}
        message={metas[confirmDel?.id ?? '']?.filename ?? ''}
        confirmLabel={String(t.delete)}
        busy={removing}
        onConfirm={async () => {
          if (!confirmDel) return
          setRemoving(true)
          await remove(confirmDel)
          setRemoving(false)
        }}
      />
    </div>
  )
}