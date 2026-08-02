import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ExternalLink, ImagePlus, Link2, Loader2, Sparkles, Trash2, X } from 'lucide-react';
import type { GoalDTO, WishlistItemDTO, WishlistItemInput } from '@timeblock/shared';
import {
  useCreateWishlistItem,
  useDeleteWishlistImage,
  useDeleteWishlistItem,
  usePreviewWishlistLink,
  useUpdateWishlistItem,
  useUploadWishlistImage,
} from '../../hooks/wishlist.js';
import { majorToMinor, minorToMajor, WISHLIST_CATEGORIES } from '../../lib/wishlist.js';

const FIELD = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:border-teal-500/50 dark:focus:ring-teal-500/10';
const LABEL = 'mb-1 block text-[11px] font-semibold uppercase tracking-[0.09em] text-slate-400 dark:text-neutral-500';

function initialForm(item: WishlistItemDTO | null): WishlistItemInput {
  return item ? {
    title: item.title, notes: item.notes, productUrl: item.productUrl, imageUrl: item.uploadedImage ? null : item.imageUrl,
    retailer: item.retailer, category: item.category, priority: item.priority, status: item.status,
    priceMinor: item.priceMinor, targetDate: item.targetDate, goalIds: item.goalIds,
  } : { title: '', notes: '', productUrl: null, imageUrl: null, retailer: null, category: 'Other', priority: 1, status: 'considering', priceMinor: null, targetDate: null, goalIds: [] };
}

export default function WishlistEditorPanel({ item, currency, goals, onClose }: { item: WishlistItemDTO | null; currency: string; goals: GoalDTO[]; onClose: () => void }) {
  const [form, setForm] = useState<WishlistItemInput>(() => initialForm(item));
  const [price, setPrice] = useState(() => minorToMajor(item?.priceMinor ?? null, currency));
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const create = useCreateWishlistItem();
  const update = useUpdateWishlistItem();
  const remove = useDeleteWishlistItem();
  const upload = useUploadWishlistImage();
  const deleteImage = useDeleteWishlistImage();
  const preview = usePreviewWishlistLink();
  const localPreview = useMemo(() => file ? URL.createObjectURL(file) : null, [file]);
  const saving = create.isPending || update.isPending || upload.isPending;
  const set = <K extends keyof WishlistItemInput>(key: K, value: WishlistItemInput[K]) => setForm((current) => ({ ...current, [key]: value }));

  const importLink = async () => {
    if (!form.productUrl) return;
    setError('');
    try {
      const value = await preview.mutateAsync(form.productUrl);
      setForm((current) => ({
        ...current,
        productUrl: value.url,
        title: current.title || value.title || '',
        retailer: current.retailer || value.retailer,
        imageUrl: current.imageUrl || value.imageUrl,
        priceMinor: current.priceMinor ?? value.priceMinor,
      }));
      if (!price && value.priceMinor != null) setPrice(minorToMajor(value.priceMinor, currency));
      if (value.warnings.length) setError(value.warnings.join(' '));
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not import this link'); }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    const priceMinor = price.trim() ? majorToMinor(price, currency) : null;
    if (price.trim() && priceMinor == null) return setError('Enter a valid non-negative price.');
    if (form.status === 'planned' && !form.targetDate) return setError('Choose a target date for planned items.');
    const input = { ...form, priceMinor };
    try {
      const saved = item ? await update.mutateAsync({ id: item.id, patch: input }) : await create.mutateAsync(input);
      if (file) await upload.mutateAsync({ id: saved.id, file });
      onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save this item'); }
  };

  const removeItem = async () => {
    if (!item || !window.confirm(`Delete “${item.title}”?`)) return;
    await remove.mutateAsync(item.id);
    onClose();
  };

  const suggestions = item?.advice?.suggestedGoalIds.filter((id) => !form.goalIds.includes(id)) ?? [];

  return <AnimatePresence>
    <motion.div className="fixed inset-0 z-50 bg-slate-950/25 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <motion.aside role="dialog" aria-modal="true" aria-label={item ? 'Edit wishlist item' : 'New wishlist item'} initial={{ x: 36, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 36, opacity: 0 }} transition={{ type: 'spring', stiffness: 360, damping: 35 }} className="ml-auto flex h-full w-full max-w-lg flex-col border-l border-slate-200 bg-slate-50 shadow-2xl dark:border-neutral-800 dark:bg-neutral-950">
        <div className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4 dark:border-neutral-800 dark:bg-neutral-900"><div><h2 className="text-base font-semibold text-slate-900 dark:text-neutral-100">{item ? 'Edit wish' : 'Capture a wish'}</h2><p className="text-xs text-slate-400">Turn “maybe someday” into a deliberate decision.</p></div><button onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5"><X size={17} /></button></div>
        <form id="wishlist-item-form" onSubmit={submit} className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="mb-5 overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
            <div className="relative grid aspect-[16/7] place-items-center overflow-hidden bg-slate-100 dark:bg-neutral-800">
              {(localPreview || item?.imageUrl || form.imageUrl) ? <img src={localPreview || item?.imageUrl || form.imageUrl || ''} alt="Product preview" className="h-full w-full object-cover" /> : <div className="text-center text-slate-400"><ImagePlus className="mx-auto mb-1" size={26} /><span className="text-xs">Product image</span></div>}
              <label className="absolute bottom-3 right-3 cursor-pointer rounded-lg bg-white/90 px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm backdrop-blur hover:bg-white dark:bg-neutral-900/90 dark:text-neutral-200"><ImagePlus size={13} className="mr-1 inline" />Choose image<input type="file" accept="image/jpeg,image/png,image/webp,image/avif" className="hidden" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
            </div>
            {item?.uploadedImage && <button type="button" onClick={() => deleteImage.mutate(item.id)} className="w-full border-t border-slate-100 py-2 text-xs text-rose-500 hover:bg-rose-50 dark:border-neutral-800 dark:hover:bg-rose-500/10">Remove stored image</button>}
          </div>

          <div className="space-y-4">
            <div><label className={LABEL}>Product link</label><div className="flex gap-2"><div className="relative flex-1"><Link2 size={14} className="absolute left-3 top-3 text-slate-400" /><input className={`${FIELD} pl-9`} value={form.productUrl ?? ''} onChange={(e) => set('productUrl', e.target.value || null)} placeholder="https://store.example/product" /></div><button type="button" disabled={!form.productUrl || preview.isPending} onClick={importLink} className="rounded-lg border border-teal-200 bg-teal-50 px-3 text-xs font-semibold text-teal-700 hover:bg-teal-100 disabled:opacity-40 dark:border-teal-500/30 dark:bg-teal-500/10 dark:text-teal-300">{preview.isPending ? <Loader2 size={14} className="animate-spin" /> : 'Import'}</button></div></div>
            <div><label className={LABEL}>Title</label><input required className={FIELD} value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="What do you want to buy?" /></div>
            <div className="grid grid-cols-2 gap-3"><div><label className={LABEL}>Price · {currency}</label><input inputMode="decimal" className={FIELD} value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" /></div><div><label className={LABEL}>Retailer</label><input className={FIELD} value={form.retailer ?? ''} onChange={(e) => set('retailer', e.target.value || null)} placeholder="Store" /></div></div>
            <div className="grid grid-cols-2 gap-3"><div><label className={LABEL}>Category</label><input list="wishlist-categories" className={FIELD} value={form.category} onChange={(e) => set('category', e.target.value)} /><datalist id="wishlist-categories">{WISHLIST_CATEGORIES.map((value) => <option value={value} key={value} />)}</datalist></div><div><label className={LABEL}>Priority</label><select className={FIELD} value={form.priority} onChange={(e) => set('priority', Number(e.target.value))}><option value={4}>P1 · Essential</option><option value={3}>P2 · High</option><option value={2}>P3 · Medium</option><option value={1}>P4 · Low</option></select></div></div>
            <div className="grid grid-cols-2 gap-3"><div><label className={LABEL}>Stage</label><select className={FIELD} value={form.status} onChange={(e) => set('status', e.target.value as WishlistItemInput['status'])}><option value="considering">Considering</option><option value="planned">Planned</option>{item?.status === 'purchased' && <option value="purchased">Purchased</option>}<option value="skipped">Skipped</option></select></div><div><label className={LABEL}>Target date</label><input type="date" className={FIELD} value={form.targetDate ?? ''} onChange={(e) => set('targetDate', e.target.value || null)} /></div></div>
            <div><label className={LABEL}>Remote image URL</label><input className={FIELD} value={form.imageUrl ?? ''} onChange={(e) => set('imageUrl', e.target.value || null)} placeholder="Filled by import, or paste an image URL" /></div>
            <div><label className={LABEL}>Notes</label><textarea className={`${FIELD} min-h-24 resize-y`} value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Why you want it, alternatives, conditions to wait for…" /></div>

            <fieldset><legend className={LABEL}>Related goals</legend><div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">{goals.length ? <div className="space-y-2">{goals.map((goal) => <label key={goal.id} className="flex cursor-pointer items-start gap-2 text-xs text-slate-600 dark:text-neutral-300"><input type="checkbox" className="mt-0.5 accent-teal-600" checked={form.goalIds.includes(goal.id)} onChange={() => set('goalIds', form.goalIds.includes(goal.id) ? form.goalIds.filter((id) => id !== goal.id) : [...form.goalIds, goal.id])} /><span><span className="font-medium">{goal.title}</span>{goal.relevance && <span className="block text-[10px] text-slate-400">{goal.relevance}</span>}</span></label>)}</div> : <p className="text-xs text-slate-400">No active goals in this year.</p>}
              {suggestions.length > 0 && <div className="mt-3 border-t border-slate-100 pt-3 dark:border-neutral-800"><div className="mb-2 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-indigo-500"><Sparkles size={11} />AI suggestions</div>{suggestions.map((id) => { const goal = goals.find((candidate) => candidate.id === id); return goal ? <button key={id} type="button" onClick={() => set('goalIds', [...form.goalIds, id])} className="mr-1.5 rounded-full bg-indigo-50 px-2 py-1 text-[10px] text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300">+ {goal.title}</button> : null; })}</div>}
            </div></fieldset>
          </div>
          {error && <p role="alert" className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">{error}</p>}
        </form>
        <div className="flex items-center gap-2 border-t border-slate-200 bg-white px-5 py-4 dark:border-neutral-800 dark:bg-neutral-900">{item && <button type="button" onClick={removeItem} className="mr-auto rounded-lg p-2 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10"><Trash2 size={16} /></button>}{item?.productUrl && <a href={item.productUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-white/5"><ExternalLink size={13} />Open</a>}<button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-600 dark:border-neutral-700 dark:text-neutral-300">Cancel</button><button type="submit" form="wishlist-item-form" disabled={saving} className="rounded-lg bg-teal-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-teal-700 disabled:opacity-50">{saving ? 'Saving…' : item ? 'Save changes' : 'Add to wishlist'}</button></div>
      </motion.aside>
    </motion.div>
  </AnimatePresence>;
}
