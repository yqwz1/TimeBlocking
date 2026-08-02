import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import type { WishlistSummaryDTO } from '@timeblock/shared';
import { DateTime } from 'luxon';
import { formatMoney } from '../../lib/wishlist.js';

const COLORS = ['#0d9488', '#14b8a6', '#f59e0b', '#6366f1', '#ec4899', '#0ea5e9', '#84cc16', '#f97316', '#64748b'];
const CARD = 'rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900';

function EmptyChart({ text }: { text: string }) {
  return <div className="grid h-56 place-items-center text-sm text-slate-400 dark:text-neutral-500">{text}</div>;
}

export default function WishlistAnalytics({ summary }: { summary: WishlistSummaryDTO }) {
  const over = Math.max(0, -summary.remainingMinor);
  const budgetData = [
    { name: 'Actual', value: summary.actualMinor, color: '#0d9488' },
    { name: 'Planned', value: summary.plannedMinor, color: '#f59e0b' },
    ...(over > 0
      ? [{ name: 'Over budget', value: over, color: '#f43f5e' }]
      : [{ name: 'Remaining', value: Math.max(0, summary.remainingMinor), color: '#dbe5e3' }]),
  ].filter((entry) => entry.value > 0);
  const categoryData = summary.byCategory.filter((entry) => entry.valueMinor > 0);
  const verdictData = summary.verdictCounts.map((entry) => ({
    name: entry.verdict === 'buy_now' ? 'Buy now' : entry.verdict === 'not_analyzed' ? 'Not analyzed' : entry.verdict[0]!.toUpperCase() + entry.verdict.slice(1),
    value: entry.count,
  }));
  const monthly = summary.monthly.map((entry) => ({ ...entry, label: DateTime.fromFormat(entry.month, 'yyyy-MM').toFormat('MMM yy') }));
  const moneyTooltip = ({ active, payload }: any) => active && payload?.length ? (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
      {payload.map((entry: any) => <div key={entry.name} style={{ color: entry.color }}>{entry.name}: {formatMoney(entry.value, summary.currency)}</div>)}
    </div>
  ) : null;

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <section className={CARD}>
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-neutral-100">Monthly budget shape</h3>
          <p className="text-xs text-slate-400 dark:text-neutral-500">Actual, planned, and what remains</p>
        </div>
        {budgetData.length ? (
          <div className="relative h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart><Pie data={budgetData} dataKey="value" innerRadius={68} outerRadius={96} paddingAngle={2}>{budgetData.map((entry) => <Cell key={entry.name} fill={entry.color} />)}</Pie><Tooltip content={moneyTooltip} /><Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} /></PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-x-0 top-[94px] text-center">
              <div className="text-xs text-slate-400">{over ? 'Over by' : 'Available'}</div>
              <div className={`text-lg font-bold tabular-nums ${over ? 'text-rose-500' : 'text-slate-900 dark:text-neutral-100'}`}>{formatMoney(over || Math.max(0, summary.remainingMinor), summary.currency, true)}</div>
            </div>
          </div>
        ) : <EmptyChart text="Set a budget or plan a purchase to begin." />}
      </section>

      <section className={CARD}>
        <h3 className="text-sm font-semibold text-slate-900 dark:text-neutral-100">Value by category</h3>
        <p className="text-xs text-slate-400 dark:text-neutral-500">Considering and planned items</p>
        {categoryData.length ? <div className="h-64"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={categoryData} dataKey="valueMinor" nameKey="category" outerRadius={92}>{categoryData.map((entry, index) => <Cell key={entry.category} fill={COLORS[index % COLORS.length]} />)}</Pie><Tooltip content={moneyTooltip} /><Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} /></PieChart></ResponsiveContainer></div> : <EmptyChart text="Add priced items to see the category mix." />}
      </section>

      <section className={`${CARD} xl:col-span-2`}>
        <h3 className="text-sm font-semibold text-slate-900 dark:text-neutral-100">Six-month spending runway</h3>
        <p className="mb-4 text-xs text-slate-400 dark:text-neutral-500">Three months behind, selected month, and two months ahead</p>
        <div className="h-64"><ResponsiveContainer width="100%" height="100%"><BarChart data={monthly}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#94a3b822" /><XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} /><YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(value) => formatMoney(value, summary.currency, true)} /><Tooltip content={moneyTooltip} /><Bar dataKey="actualMinor" name="Actual" stackId="spend" fill="#0d9488" radius={[0, 0, 4, 4]} /><Bar dataKey="plannedMinor" name="Planned" stackId="spend" fill="#f59e0b" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div>
      </section>

      <section className={`${CARD} xl:col-span-2`}>
        <h3 className="text-sm font-semibold text-slate-900 dark:text-neutral-100">Decision queue</h3>
        <div className="mt-4 flex flex-wrap gap-3">
          {verdictData.length ? verdictData.map((entry, index) => (
            <div key={entry.name} className="min-w-32 flex-1 rounded-xl bg-slate-50 px-4 py-3 dark:bg-white/[0.035]">
              <div className="mb-2 h-1.5 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
              <div className="text-2xl font-bold tabular-nums text-slate-900 dark:text-neutral-100">{entry.value}</div>
              <div className="text-xs text-slate-500 dark:text-neutral-400">{entry.name}</div>
            </div>
          )) : <div className="text-sm text-slate-400">No active items yet.</div>}
        </div>
      </section>
    </div>
  );
}
