import { useEffect, useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import { motion } from 'motion/react';
import { BarChart3, ChevronLeft, ChevronRight, Grid2X2, List, Plus, Search, Sparkles, WalletCards, X } from 'lucide-react';
import type { WishlistItemDTO, WishlistStatus, WishlistVerdict } from '@timeblock/shared';
import { useGoals } from '../hooks.js';
import {
  usePurchaseWishlistItem,
  useSaveWishlistBudget,
  useUpdateWishlistSettings,
  useWishlistAdvice,
  useWishlistBudget,
  useWishlistItems,
  useWishlistSettings,
  useWishlistSummary,
  type WishlistFilters,
} from '../hooks/wishlist.js';
import WishlistSidebar, { type WishlistScope } from '../components/wishlist/WishlistSidebar.js';
import WishlistEditorPanel from '../components/wishlist/WishlistEditorPanel.js';
import WishlistAnalytics from '../components/wishlist/WishlistAnalytics.js';
import { WishlistCard, WishlistListItem } from '../components/wishlist/WishlistItem.js';
import { formatMoney, itemBudgetFit, majorToMinor, minorToMajor, WISHLIST_CATEGORIES } from '../lib/wishlist.js';

type View = 'list' | 'cards' | 'insights';
const FIELD = 'rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:focus:ring-teal-500/10';
const CURRENCIES = ['SAR', 'USD', 'EUR', 'GBP', 'AED', 'KWD', 'QAR', 'JPY'];

function Stat({ label, value, tone = 'text-slate-900 dark:text-neutral-100', note }: { label: string; value: string; tone?: string; note?: string }) {
  return <div className="min-w-0 rounded-xl border border-white/70 bg-white/75 px-4 py-3 shadow-sm backdrop-blur dark:border-white/[0.06] dark:bg-neutral-900/70"><p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">{label}</p><p className={`mt-1 truncate text-lg font-bold tabular-nums ${tone}`}>{value}</p>{note && <p className="mt-0.5 truncate text-[10px] text-slate-400">{note}</p>}</div>;
}

function PurchaseDialog({ item, currency, onClose }: { item: WishlistItemDTO; currency: string; onClose: () => void }) {
  const purchase = usePurchaseWishlistItem();
  const [price, setPrice] = useState(minorToMajor(item.priceMinor, currency));
  const [date, setDate] = useState(DateTime.now().toISODate()!);
  const [error, setError] = useState('');
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const actualPriceMinor = majorToMinor(price, currency);
    if (actualPriceMinor == null) return setError('Enter the actual price paid.');
    try { await purchase.mutateAsync({ id: item.id, input: { actualPriceMinor, purchasedAt: date } }); onClose(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not record purchase'); }
  };
  return <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/35 p-4 backdrop-blur-sm"><motion.form onSubmit={submit} initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-neutral-800 dark:bg-neutral-900"><div className="mb-4 flex items-start justify-between"><div><h2 className="font-semibold text-slate-900 dark:text-neutral-100">Mark as purchased</h2><p className="mt-0.5 text-xs text-slate-400">{item.title}</p></div><button type="button" onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5"><X size={16} /></button></div><label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">Actual price · {currency}</label><input autoFocus className={`${FIELD} mb-3 w-full py-2 text-sm`} value={price} onChange={(e) => setPrice(e.target.value)} /><label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">Purchase date</label><input type="date" required className={`${FIELD} w-full py-2 text-sm`} value={date} onChange={(e) => setDate(e.target.value)} />{error && <p className="mt-3 text-xs text-rose-500">{error}</p>}<div className="mt-5 flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-2 text-xs dark:border-neutral-700">Cancel</button><button disabled={purchase.isPending} className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">{purchase.isPending ? 'Saving…' : 'Record purchase'}</button></div></motion.form></div>;
}

export default function WishlistPage() {
  const today = DateTime.now();
  const [month, setMonth] = useState(today.toFormat('yyyy-MM'));
  const [scope, setScope] = useState<WishlistScope>({ kind: 'all' });
  const [view, setView] = useState<View>('list');
  const [filters, setFilters] = useState<WishlistFilters>({ sort: 'recommendation' });
  const [editing, setEditing] = useState<WishlistItemDTO | 'new' | null>(null);
  const [purchasing, setPurchasing] = useState<WishlistItemDTO | null>(null);
  const [budgetText, setBudgetText] = useState('');
  const [notice, setNotice] = useState('');
  const [analyzingIds, setAnalyzingIds] = useState<Set<string>>(new Set());
  const all = useWishlistItems({ sort: 'newest' });
  const effectiveFilters = useMemo<WishlistFilters>(() => ({
    ...filters,
    ...(scope.kind === 'status' ? { status: scope.value } : {}),
    ...(scope.kind === 'verdict' ? { verdict: scope.value } : {}),
    ...(scope.kind === 'category' ? { category: scope.value } : {}),
  }), [filters, scope]);
  const items = useWishlistItems(effectiveFilters);
  const settings = useWishlistSettings();
  const currency = settings.data?.currency ?? 'SAR';
  const budget = useWishlistBudget(month);
  const summary = useWishlistSummary(month);
  const saveBudget = useSaveWishlistBudget();
  const updateSettings = useUpdateWishlistSettings();
  const advice = useWishlistAdvice();
  const goals = useGoals(today.year, 'all');
  const activeGoals = (goals.data ?? []).filter((goal) => goal.status === 'active');

  useEffect(() => { if (budget.data) setBudgetText(minorToMajor(budget.data.amountMinor, currency)); }, [budget.data?.amountMinor, currency]);
  const data = summary.data;
  const categoryOptions = [...new Set([...(all.data ?? []).map((item) => item.category), ...WISHLIST_CATEGORIES])].sort();
  const navigateMonth = (delta: number) => setMonth(DateTime.fromFormat(month, 'yyyy-MM').plus({ months: delta }).toFormat('yyyy-MM'));

  const persistBudget = async () => {
    const amountMinor = majorToMinor(budgetText || 0, currency);
    if (amountMinor == null) return setNotice('Enter a valid budget amount.');
    await saveBudget.mutateAsync({ month, input: { amountMinor } });
    setNotice('Budget saved.');
  };
  const changeCurrency = async (next: string) => {
    if (next === currency) return;
    if ((all.data?.length || data?.budgetMinor) && !window.confirm(`Change the wishlist currency to ${next}? Existing numbers will be reinterpreted; no exchange conversion is performed.`)) return;
    await updateSettings.mutateAsync(next);
  };
  const analyzeOne = async (id: string) => {
    setNotice('');
    setAnalyzingIds((current) => new Set(current).add(id));
    try { await advice.mutateAsync(id); }
    catch (reason) { setNotice(reason instanceof Error ? reason.message : 'AI advice failed'); }
    finally { setAnalyzingIds((current) => { const next = new Set(current); next.delete(id); return next; }); }
  };
  const analyzeVisible = async () => {
    const queue = (items.data ?? []).filter((item) => ['considering', 'planned'].includes(item.status)).slice(0, 25);
    if (!queue.length) return setNotice('No active visible items to analyze.');
    let cursor = 0;
    const worker = async () => { while (cursor < queue.length) { const item = queue[cursor++]; if (item) await analyzeOne(item.id); } };
    await Promise.all([worker(), worker()]);
  };
  const clearFilters = () => { setScope({ kind: 'all' }); setFilters({ sort: 'recommendation' }); };
  const hasFilters = scope.kind !== 'all' || Object.entries(filters).some(([key, value]) => key !== 'sort' && value != null && value !== '');

  return <div className="wishlist-workspace flex h-full min-h-0 overflow-hidden">
    <WishlistSidebar items={all.data ?? []} scope={scope} onScope={(next) => { setScope(next); setFilters((current) => ({ ...current, status: undefined, verdict: undefined, category: undefined })); }} />
    <main className="min-w-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[1500px] px-4 py-4 lg:px-6">
        <header className="wishlist-budget-grid relative overflow-hidden rounded-2xl border border-teal-100 bg-gradient-to-br from-[#f0faf7] via-white to-[#f5faf8] p-4 shadow-sm dark:border-teal-500/15 dark:from-[#0d1d1a] dark:via-neutral-900 dark:to-[#101614] lg:p-5">
          <div className="relative z-10 mb-4 flex flex-wrap items-start justify-between gap-4"><div><div className="flex items-center gap-2"><WalletCards size={18} className="text-teal-600" /><h1 className="text-lg font-semibold tracking-[-0.02em] text-slate-900 dark:text-neutral-100">Wishlist</h1></div><p className="mt-1 text-xs text-slate-500 dark:text-neutral-400">A deliberate queue for future purchases—not a shopping cart.</p></div><div className="flex flex-wrap items-center gap-2"><div className="flex items-center rounded-lg border border-slate-200/80 bg-white/80 p-0.5 dark:border-neutral-700 dark:bg-neutral-900/80"><button onClick={() => navigateMonth(-1)} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5"><ChevronLeft size={14} /></button><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="bg-transparent px-1 text-xs font-medium text-slate-700 outline-none dark:text-neutral-200" /><button onClick={() => navigateMonth(1)} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5"><ChevronRight size={14} /></button></div><select aria-label="Wishlist currency" className={FIELD} value={currency} onChange={(e) => changeCurrency(e.target.value)}>{CURRENCIES.map((value) => <option key={value}>{value}</option>)}</select><button onClick={() => setEditing('new')} className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-teal-700"><Plus size={14} />New wish</button></div></div>
          <div className="relative z-10 mb-3 flex max-w-md items-center gap-2"><label htmlFor="wishlist-budget" className="shrink-0 text-xs font-medium text-slate-500 dark:text-neutral-400">Monthly budget</label><div className="relative flex-1"><input id="wishlist-budget" inputMode="decimal" value={budgetText} onChange={(e) => setBudgetText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && persistBudget()} className="w-full rounded-lg border border-teal-200 bg-white/85 px-3 py-2 pr-16 text-sm font-semibold tabular-nums text-slate-900 outline-none focus:ring-2 focus:ring-teal-200 dark:border-teal-500/25 dark:bg-neutral-900/80 dark:text-neutral-100" /><span className="absolute right-3 top-2.5 text-[10px] font-semibold text-slate-400">{currency}</span></div><button onClick={persistBudget} disabled={saveBudget.isPending} className="rounded-lg border border-teal-200 bg-white/80 px-3 py-2 text-xs font-medium text-teal-700 hover:bg-white disabled:opacity-50 dark:border-teal-500/25 dark:bg-neutral-900/80 dark:text-teal-300">Save</button></div>
          {data && <div className="relative z-10 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5"><Stat label="Budget" value={formatMoney(data.budgetMinor, currency, true)} /><Stat label="Actual spent" value={formatMoney(data.actualMinor, currency, true)} tone="text-teal-700 dark:text-teal-300" /><Stat label="Planned" value={formatMoney(data.plannedMinor, currency, true)} tone="text-amber-600 dark:text-amber-300" /><Stat label="Remaining" value={formatMoney(data.remainingMinor, currency, true)} tone={data.remainingMinor < 0 ? 'text-rose-600 dark:text-rose-300' : 'text-emerald-700 dark:text-emerald-300'} note={data.remainingMinor < 0 ? 'Over monthly budget' : 'After planned purchases'} /><Stat label="Active wishlist" value={formatMoney(data.activeValueMinor, currency, true)} note={data.missingPriceCount ? `${data.missingPriceCount} missing price` : 'Considering + planned'} /></div>}
        </header>

        <section className="sticky top-0 z-20 -mx-1 mt-4 rounded-xl border border-slate-200/80 bg-slate-50/90 p-2.5 shadow-sm backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/90">
          <div className="flex flex-wrap items-center gap-2"><div className="relative min-w-52 flex-1"><Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" /><input className={`${FIELD} w-full pl-8`} value={filters.q ?? ''} onChange={(e) => setFilters((current) => ({ ...current, q: e.target.value || undefined }))} placeholder="Search wishes…" /></div><select className={FIELD} value={filters.status ?? ''} onChange={(e) => setFilters((current) => ({ ...current, status: e.target.value || undefined }))}><option value="">Any stage</option>{(['considering', 'planned', 'purchased', 'skipped'] as WishlistStatus[]).map((value) => <option key={value} value={value}>{value[0]!.toUpperCase() + value.slice(1)}</option>)}</select><select className={FIELD} value={filters.category ?? ''} onChange={(e) => setFilters((current) => ({ ...current, category: e.target.value || undefined }))}><option value="">Any category</option>{categoryOptions.map((value) => <option key={value}>{value}</option>)}</select><select className={FIELD} value={filters.priority ?? ''} onChange={(e) => setFilters((current) => ({ ...current, priority: e.target.value ? Number(e.target.value) : undefined }))}><option value="">Any priority</option><option value="4">P1</option><option value="3">P2</option><option value="2">P3</option><option value="1">P4</option></select><select className={FIELD} value={filters.verdict ?? ''} onChange={(e) => setFilters((current) => ({ ...current, verdict: e.target.value || undefined }))}><option value="">Any advice</option>{(['buy_now', 'wait', 'skip'] as WishlistVerdict[]).map((value) => <option key={value} value={value}>{value === 'buy_now' ? 'Buy now' : value[0]!.toUpperCase() + value.slice(1)}</option>)}<option value="not_analyzed">Not analyzed</option></select><select className={FIELD} value={filters.goalId ?? ''} onChange={(e) => setFilters((current) => ({ ...current, goalId: e.target.value || undefined }))}><option value="">Any goal</option>{activeGoals.map((goal) => <option value={goal.id} key={goal.id}>{goal.title}</option>)}</select><input type="month" aria-label="Target or purchase month" title="Target or purchase month" className={FIELD} value={filters.month ?? ''} onChange={(e) => setFilters((current) => ({ ...current, month: e.target.value || undefined }))} /><input inputMode="decimal" aria-label={`Minimum price in ${currency}`} className={`${FIELD} w-24`} placeholder={`Min ${currency}`} value={filters.minPrice == null ? '' : minorToMajor(filters.minPrice, currency)} onChange={(e) => setFilters((current) => ({ ...current, minPrice: e.target.value ? majorToMinor(e.target.value, currency) ?? undefined : undefined }))} /><input inputMode="decimal" aria-label={`Maximum price in ${currency}`} className={`${FIELD} w-24`} placeholder={`Max ${currency}`} value={filters.maxPrice == null ? '' : minorToMajor(filters.maxPrice, currency)} onChange={(e) => setFilters((current) => ({ ...current, maxPrice: e.target.value ? majorToMinor(e.target.value, currency) ?? undefined : undefined }))} /><select className={FIELD} value={filters.sort ?? 'recommendation'} onChange={(e) => setFilters((current) => ({ ...current, sort: e.target.value as WishlistFilters['sort'] }))}><option value="recommendation">Sort: recommendation</option><option value="priority">Priority</option><option value="price_desc">Price: high to low</option><option value="price_asc">Price: low to high</option><option value="target_date">Target date</option><option value="newest">Newest</option></select>{hasFilters && <button onClick={clearFilters} className="rounded-lg px-2 py-1.5 text-xs text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5"><X size={13} /></button>}</div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-1">{([{ value: 'list', label: 'List', icon: List }, { value: 'cards', label: 'Cards', icon: Grid2X2 }, { value: 'insights', label: 'Insights', icon: BarChart3 }] as const).map(({ value, label, icon: Icon }) => <button key={value} onClick={() => setView(value)} className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium ${view === value ? 'bg-slate-900 text-white dark:bg-neutral-100 dark:text-neutral-900' : 'text-slate-500 hover:bg-slate-100 dark:text-neutral-400 dark:hover:bg-white/5'}`}><Icon size={13} />{label}</button>)}</div><div className="flex items-center gap-2"><span className="text-[11px] text-slate-400">{items.data?.length ?? 0} shown</span><button onClick={analyzeVisible} disabled={analyzingIds.size > 0 || items.isLoading} className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-40 dark:border-indigo-500/25 dark:bg-indigo-500/10 dark:text-indigo-300"><Sparkles size={13} className={analyzingIds.size ? 'animate-pulse' : ''} />Analyze visible</button></div></div>
        </section>

        {notice && <div className="mt-3 flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300"><span>{notice}</span><button onClick={() => setNotice('')}><X size={13} /></button></div>}
        <div className="mt-4">
          {view === 'insights' && data ? <WishlistAnalytics summary={data} /> : items.isLoading ? <div className="py-20 text-center text-sm text-slate-400">Loading wishlist…</div> : !items.data?.length ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white/50 px-6 py-20 text-center dark:border-neutral-700 dark:bg-neutral-900/40"><div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-teal-50 text-teal-600 dark:bg-teal-500/10 dark:text-teal-300"><WalletCards size={22} /></div><h2 className="text-sm font-semibold text-slate-800 dark:text-neutral-200">Nothing in this view</h2><p className="mx-auto mt-1 max-w-sm text-xs text-slate-400">Capture a product, set its priority, and let your budget—not impulse—make the next move clear.</p><button onClick={() => setEditing('new')} className="mt-4 rounded-lg bg-teal-600 px-4 py-2 text-xs font-semibold text-white"><Plus size={13} className="mr-1 inline" />Add your first wish</button></div> : view === 'cards' ? <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">{items.data.map((item) => <WishlistCard key={item.id} item={item} currency={currency} fit={data ? itemBudgetFit(item, data) : 'needs_data'} analyzing={analyzingIds.has(item.id)} onEdit={() => setEditing(item)} onAnalyze={() => analyzeOne(item.id)} onPurchase={() => setPurchasing(item)} />)}</div> : <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">{items.data.map((item) => <WishlistListItem key={item.id} item={item} currency={currency} fit={data ? itemBudgetFit(item, data) : 'needs_data'} analyzing={analyzingIds.has(item.id)} onEdit={() => setEditing(item)} onAnalyze={() => analyzeOne(item.id)} onPurchase={() => setPurchasing(item)} />)}</div>}
        </div>
      </div>
    </main>
    {editing && <WishlistEditorPanel item={editing === 'new' ? null : editing} currency={currency} goals={activeGoals} onClose={() => setEditing(null)} />}
    {purchasing && <PurchaseDialog item={purchasing} currency={currency} onClose={() => setPurchasing(null)} />}
  </div>;
}
