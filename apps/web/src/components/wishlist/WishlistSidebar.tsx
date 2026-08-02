import { Archive, CircleDollarSign, Layers3, PackageCheck, PauseCircle, ShoppingBag, Sparkles, Tag, XCircle } from 'lucide-react';
import type { WishlistItemDTO } from '@timeblock/shared';

export type WishlistScope = { kind: 'all' } | { kind: 'status'; value: string } | { kind: 'verdict'; value: string } | { kind: 'category'; value: string };

function keyOf(scope: WishlistScope): string { return scope.kind === 'all' ? 'all' : `${scope.kind}:${scope.value}`; }

export default function WishlistSidebar({ items, scope, onScope }: { items: WishlistItemDTO[]; scope: WishlistScope; onScope: (scope: WishlistScope) => void }) {
  const count = (candidate: WishlistScope) => {
    if (candidate.kind === 'all') return items.length;
    if (candidate.kind === 'status') return items.filter((item) => item.status === candidate.value).length;
    if (candidate.kind === 'verdict') return items.filter((item) => (item.advice?.verdict ?? 'not_analyzed') === candidate.value).length;
    return items.filter((item) => item.category === candidate.value).length;
  };
  const categories = [...new Set(items.map((item) => item.category))].sort();
  const nav: Array<{ scope: WishlistScope; label: string; icon: typeof ShoppingBag }> = [
    { scope: { kind: 'all' }, label: 'All wishes', icon: Layers3 },
    { scope: { kind: 'status', value: 'considering' }, label: 'Considering', icon: PauseCircle },
    { scope: { kind: 'status', value: 'planned' }, label: 'Planned', icon: CircleDollarSign },
    { scope: { kind: 'status', value: 'purchased' }, label: 'Purchased', icon: PackageCheck },
    { scope: { kind: 'status', value: 'skipped' }, label: 'Skipped', icon: Archive },
  ];
  const advice: Array<{ scope: WishlistScope; label: string; icon: typeof Sparkles }> = [
    { scope: { kind: 'verdict', value: 'buy_now' }, label: 'Buy now', icon: Sparkles },
    { scope: { kind: 'verdict', value: 'wait' }, label: 'Wait', icon: PauseCircle },
    { scope: { kind: 'verdict', value: 'skip' }, label: 'Skip', icon: XCircle },
    { scope: { kind: 'verdict', value: 'not_analyzed' }, label: 'Not analyzed', icon: ShoppingBag },
  ];
  const group = (entries: typeof nav) => entries.map(({ scope: candidate, label, icon: Icon }) => {
    const active = keyOf(candidate) === keyOf(scope);
    return <button key={keyOf(candidate)} onClick={() => onScope(candidate)} className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors ${active ? 'bg-teal-50 font-medium text-teal-700 dark:bg-teal-500/15 dark:text-teal-300' : 'text-slate-600 hover:bg-slate-100 dark:text-neutral-300 dark:hover:bg-white/5'}`}><Icon size={14} /><span className="min-w-0 flex-1 truncate">{label}</span><span className="text-[10px] tabular-nums text-slate-400">{count(candidate)}</span></button>;
  });
  return (
    <aside className="hidden h-full w-52 shrink-0 flex-col border-r border-slate-200 bg-white px-2 py-4 dark:border-neutral-800 dark:bg-neutral-900 md:flex">
      <div className="mb-4 flex items-center gap-2 px-2"><div className="grid h-7 w-7 place-items-center rounded-lg bg-teal-600 text-white"><ShoppingBag size={15} /></div><div><div className="text-sm font-semibold text-slate-900 dark:text-neutral-100">Wishlist</div><div className="text-[10px] text-slate-400">Purchase planner</div></div></div>
      <nav className="space-y-0.5">{group(nav)}</nav>
      <div className="mb-1 mt-5 px-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">AI advice</div>
      <nav className="space-y-0.5">{group(advice)}</nav>
      <div className="mb-1 mt-5 flex items-center gap-1.5 px-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400"><Tag size={10} /> Categories</div>
      <nav className="min-h-0 space-y-0.5 overflow-y-auto">{categories.length ? group(categories.map((value) => ({ scope: { kind: 'category', value } as WishlistScope, label: value, icon: Tag }))) : <p className="px-2 py-2 text-xs text-slate-400">Categories appear here.</p>}</nav>
    </aside>
  );
}
