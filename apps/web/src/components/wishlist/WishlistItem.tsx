import { CalendarDays, ExternalLink, ImageOff, Pencil, ShoppingCart, Sparkles } from 'lucide-react';
import { motion } from 'motion/react';
import type { WishlistBudgetFit, WishlistItemDTO } from '@timeblock/shared';
import { DateTime } from 'luxon';
import { formatMoney } from '../../lib/wishlist.js';

const VERDICT = {
  buy_now: { label: 'Buy now', cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' },
  wait: { label: 'Wait', cls: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300' },
  skip: { label: 'Skip', cls: 'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300' },
};
const FIT: Record<WishlistBudgetFit, { label: string; cls: string }> = {
  needs_data: { label: 'Needs data', cls: 'text-slate-400 bg-slate-100 dark:bg-neutral-800' },
  over_budget: { label: 'Over budget', cls: 'text-rose-700 bg-rose-50 dark:bg-rose-500/15 dark:text-rose-300' },
  tight: { label: 'Budget tight', cls: 'text-amber-700 bg-amber-50 dark:bg-amber-500/15 dark:text-amber-300' },
  fits: { label: 'Fits budget', cls: 'text-teal-700 bg-teal-50 dark:bg-teal-500/15 dark:text-teal-300' },
};

export function ProductImage({ item, className = '' }: { item: WishlistItemDTO; className?: string }) {
  if (!item.imageUrl) return <div className={`grid place-items-center bg-slate-100 text-slate-300 dark:bg-neutral-800 dark:text-neutral-600 ${className}`}><ImageOff size={24} /></div>;
  return <img src={item.imageUrl} alt={`${item.title} product`} className={`bg-slate-50 object-cover dark:bg-neutral-800 ${className}`} loading="lazy" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.display = 'none'; event.currentTarget.parentElement?.classList.add('wishlist-image-broken'); }} />;
}

function AdviceBadge({ item }: { item: WishlistItemDTO }) {
  if (!item.advice) return <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-medium text-slate-500 dark:bg-neutral-800 dark:text-neutral-400">Not analyzed</span>;
  const meta = VERDICT[item.advice.verdict];
  return <span title={item.advice.summary} className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold ${meta.cls}`}><Sparkles size={10} />{meta.label} · {item.advice.score}{item.advice.stale ? ' · stale' : ''}</span>;
}

function Actions({ item, analyzing, onEdit, onAnalyze, onPurchase }: { item: WishlistItemDTO; analyzing: boolean; onEdit: () => void; onAnalyze: () => void; onPurchase: () => void }) {
  return <div className="flex items-center gap-1">
    {item.productUrl && <a href={item.productUrl} target="_blank" rel="noopener noreferrer" title="Open product page" className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-teal-600 dark:hover:bg-white/5"><ExternalLink size={14} /></a>}
    {(item.status === 'considering' || item.status === 'planned') && <button onClick={onAnalyze} disabled={analyzing} title="Get AI advice" className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-indigo-500 disabled:opacity-40 dark:hover:bg-white/5"><Sparkles size={14} className={analyzing ? 'animate-pulse' : ''} /></button>}
    {(item.status === 'considering' || item.status === 'planned') && <button onClick={onPurchase} title="Mark purchased" className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-emerald-600 dark:hover:bg-white/5"><ShoppingCart size={14} /></button>}
    <button onClick={onEdit} title="Edit item" className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/5 dark:hover:text-neutral-200"><Pencil size={14} /></button>
  </div>;
}

export function WishlistListItem(props: { item: WishlistItemDTO; currency: string; fit: WishlistBudgetFit; analyzing: boolean; onEdit: () => void; onAnalyze: () => void; onPurchase: () => void }) {
  const { item, currency, fit, analyzing, onEdit, onAnalyze, onPurchase } = props;
  return <motion.article layout initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} className="group grid grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-3 border-b border-slate-100 px-3 py-2.5 last:border-0 hover:bg-slate-50/70 dark:border-neutral-800 dark:hover:bg-white/[0.025] sm:grid-cols-[48px_minmax(0,1fr)_140px_120px_auto]">
    <div className="wishlist-product-image relative overflow-hidden rounded-lg"><ProductImage item={item} className="h-12 w-12" /></div>
    <div className="min-w-0"><div className="flex items-center gap-2"><h3 className="truncate text-sm font-medium text-slate-900 dark:text-neutral-100">{item.title}</h3><span className="hidden rounded bg-slate-100 px-1.5 py-0.5 text-[9px] text-slate-500 dark:bg-neutral-800 dark:text-neutral-400 lg:inline">P{5 - item.priority}</span></div><div className="mt-0.5 flex items-center gap-2 truncate text-[11px] text-slate-400"><span>{item.category}</span>{item.retailer && <><span>·</span><span>{item.retailer}</span></>}{item.targetDate && <><span>·</span><CalendarDays size={10} /><span>{DateTime.fromISO(item.targetDate).toFormat('MMM d')}</span></>}</div></div>
    <div className="hidden sm:block"><AdviceBadge item={item} /></div>
    <div className="hidden text-right sm:block"><div className="text-sm font-semibold tabular-nums text-slate-900 dark:text-neutral-100">{item.priceMinor == null ? '—' : formatMoney(item.priceMinor, currency)}</div><span className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium ${FIT[fit].cls}`}>{FIT[fit].label}</span></div>
    <Actions item={item} analyzing={analyzing} onEdit={onEdit} onAnalyze={onAnalyze} onPurchase={onPurchase} />
  </motion.article>;
}

export function WishlistCard(props: { item: WishlistItemDTO; currency: string; fit: WishlistBudgetFit; analyzing: boolean; onEdit: () => void; onAnalyze: () => void; onPurchase: () => void }) {
  const { item, currency, fit, analyzing, onEdit, onAnalyze, onPurchase } = props;
  return <motion.article layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} whileHover={{ y: -2 }} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md dark:border-neutral-800 dark:bg-neutral-900">
    <div className="wishlist-product-image relative aspect-[4/3] overflow-hidden"><ProductImage item={item} className="h-full w-full transition-transform duration-300 hover:scale-[1.03]" /><div className="absolute left-3 top-3"><AdviceBadge item={item} /></div><div className="absolute right-3 top-3 rounded-full bg-white/90 px-2 py-1 text-[10px] font-semibold text-slate-600 backdrop-blur dark:bg-neutral-900/85 dark:text-neutral-300">P{5 - item.priority}</div></div>
    <div className="p-4"><div className="mb-1 flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="truncate text-sm font-semibold text-slate-900 dark:text-neutral-100">{item.title}</h3><p className="truncate text-[11px] text-slate-400">{item.retailer ?? item.category}</p></div><div className="shrink-0 text-sm font-bold tabular-nums text-slate-900 dark:text-neutral-100">{item.priceMinor == null ? '—' : formatMoney(item.priceMinor, currency)}</div></div><div className="mt-3 flex items-center justify-between"><span className={`rounded-full px-2 py-1 text-[10px] font-medium ${FIT[fit].cls}`}>{FIT[fit].label}</span><Actions item={item} analyzing={analyzing} onEdit={onEdit} onAnalyze={onAnalyze} onPurchase={onPurchase} /></div></div>
  </motion.article>;
}
