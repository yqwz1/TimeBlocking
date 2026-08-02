import type { WorkoutSummaryDTO } from '@timeblock/shared';
import {
  Activity,
  ArrowRight,
  BarChart3,
  BrainCircuit,
  CircleGauge,
  Dumbbell,
  Info,
  Scale,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { WorkoutView } from './WorkoutSidebar.js';
import {
  deltaPercent,
  momentumCounts,
  normalizedLiftSeries,
  periodMetrics,
  rangeBounds,
  weeklyTimeline,
  type WorkoutRange,
} from './workoutAnalytics.js';

export type OverviewMetric = 'sessions' | 'workingSets' | 'volume' | 'bodyweight';

type Props = {
  summary: WorkoutSummaryDTO;
  range: WorkoutRange;
  compare: boolean;
  metric: OverviewMetric;
  onRangeChange(range: WorkoutRange): void;
  onCompareChange(compare: boolean): void;
  onMetricChange(metric: OverviewMetric): void;
  onNavigate(view: WorkoutView, params?: Record<string, string>): void;
};

const SURFACE = 'rounded-2xl bg-white ring-1 ring-slate-200/80 dark:bg-neutral-900 dark:ring-white/[0.08]';
const FOCUS = 'outline-none focus-visible:ring-2 focus-visible:ring-teal-500/60';

function tone(status: string) {
  if (['progressing', 'recovering_well', 'green', 'ahead', 'achieved', 'on_track'].includes(status)) return 'text-emerald-600 dark:text-emerald-400';
  if (['declining', 'under_recovering', 'red', 'off_track'].includes(status)) return 'text-rose-600 dark:text-rose-400';
  return 'text-amber-600 dark:text-amber-400';
}

function stateSurface(status: string) {
  if (['green', 'recovering_well'].includes(status)) return 'bg-emerald-50 text-emerald-800 dark:bg-emerald-500/[0.09] dark:text-emerald-200';
  if (['red', 'under_recovering'].includes(status)) return 'bg-rose-50 text-rose-800 dark:bg-rose-500/[0.09] dark:text-rose-200';
  return 'bg-amber-50 text-amber-900 dark:bg-amber-500/[0.09] dark:text-amber-100';
}

function compact(value: number) {
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

function Delta({ value }: { value: number | null }) {
  if (value == null) return <span className="text-slate-400 dark:text-neutral-500">No prior comparison</span>;
  const UpIcon = value >= 0 ? TrendingUp : TrendingDown;
  return <span className={`inline-flex items-center gap-1 ${value >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}><UpIcon size={12} />{Math.abs(value)}% vs prior</span>;
}

function MetricBlock({ label, value, delta, detail }: { label: string; value: string; delta: number | null; detail: string }) {
  return <div className="min-w-0 border-l border-slate-200 pl-3 first:border-0 first:pl-0 dark:border-neutral-800 sm:pl-5">
    <p className="text-[11px] font-medium text-slate-500 dark:text-neutral-400">{label}</p>
    <p className="mt-1 text-2xl font-semibold tracking-[-0.045em] text-slate-950 tabular-nums dark:text-white sm:text-3xl">{value}</p>
    <p className="mt-1 text-[10px] leading-4"><Delta value={delta} /></p>
    <p className="mt-1 hidden text-[10px] text-slate-400 dark:text-neutral-500 sm:block">{detail}</p>
  </div>;
}

function RangeControl({ value, onChange }: { value: WorkoutRange; onChange(value: WorkoutRange): void }) {
  return <div className="inline-flex rounded-lg bg-slate-100 p-1 dark:bg-neutral-800" aria-label="Training time range">
    {(['4w', '8w', '12w', 'all'] as WorkoutRange[]).map((range) => <button key={range} type="button" aria-pressed={value === range} onClick={() => onChange(range)} className={`${FOCUS} min-h-8 rounded-md px-2.5 text-[11px] font-semibold uppercase transition ${value === range ? 'bg-white text-slate-900 shadow-sm dark:bg-neutral-700 dark:text-white' : 'text-slate-500 hover:text-slate-800 dark:text-neutral-400 dark:hover:text-neutral-100'}`}>{range}</button>)}
  </div>;
}

function SectionTitle({ eyebrow, title, detail }: { eyebrow: string; title: string; detail: string }) {
  return <div>
    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-teal-600 dark:text-teal-400">{eyebrow}</p>
    <h2 className="mt-1 text-xl font-semibold tracking-[-0.035em] text-slate-950 dark:text-white">{title}</h2>
    <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500 dark:text-neutral-400">{detail}</p>
  </div>;
}

const METRICS: Array<{ id: OverviewMetric; label: string; unit: string }> = [
  { id: 'sessions', label: 'Sessions', unit: '' },
  { id: 'workingSets', label: 'Working sets', unit: '' },
  { id: 'volume', label: 'Training volume', unit: '' },
  { id: 'bodyweight', label: 'Bodyweight', unit: 'kg' },
];

export default function WorkoutOverview({ summary, range, compare, metric, onRangeChange, onCompareChange, onMetricChange, onNavigate }: Props) {
  const bounds = rangeBounds(summary, range);
  const current = periodMetrics(summary, bounds.from, bounds.to);
  const previous = periodMetrics(summary, bounds.previousFrom, bounds.previousTo);
  const timeline = weeklyTimeline(summary, bounds.from, bounds.to);
  const previousTimeline = weeklyTimeline(summary, bounds.previousFrom, bounds.previousTo);
  const chartData = timeline.map((point, index) => ({ ...point, previous: previousTimeline[index]?.[metric] ?? null }));
  const momentum = momentumCounts(summary.exercises);
  const strongest = [...summary.exercises].filter((item) => item.series.length >= 2).sort((a, b) => b.n_sessions - a.n_sessions).slice(0, 4);
  const strengthData = normalizedLiftSeries(summary.exercises, strongest.map((item) => item.name), bounds.from);
  const topAction = summary.next_actions[0];
  const fatigue = summary.fatigue;
  const muscleRows = Object.entries(summary.week_summary.muscle_detail)
    .filter(([, detail]) => detail.mrv != null)
    .sort((a, b) => ((a[1].sets_per_week_ewma < (a[1].mev ?? 0) ? -1 : 0) - (b[1].sets_per_week_ewma < (b[1].mev ?? 0) ? -1 : 0)) || b[1].sets_recent_7d - a[1].sets_recent_7d)
    .slice(0, 9);
  const latestBodyweight = summary.bodyweight.at(-1);
  const firstBodyweight = summary.bodyweight.find((item) => item.date >= bounds.from);
  const bodyweightChange = latestBodyweight && firstBodyweight && latestBodyweight.date !== firstBodyweight.date ? latestBodyweight.weight - firstBodyweight.weight : null;
  const forecastReady = (summary.forecast_accuracy?.n ?? 0) >= 8;

  return <div className="mx-auto w-full max-w-[1480px] space-y-5 pb-8">
    <section className={`${SURFACE} overflow-hidden`} aria-labelledby="workout-briefing-title">
      <div className="grid lg:grid-cols-[minmax(0,1.4fr)_minmax(19rem,.6fr)]">
        <div className={`relative p-5 sm:p-7 ${stateSurface(fatigue.readiness)}`}>
          <div className="absolute right-5 top-5 grid h-10 w-10 place-items-center rounded-xl bg-white/55 dark:bg-black/15"><CircleGauge size={20} /></div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.19em] opacity-70">Your weekly briefing</p>
          <h1 id="workout-briefing-title" className="mt-3 max-w-2xl text-3xl font-semibold leading-[1.05] tracking-[-0.055em] text-balance sm:text-4xl">Load is {fatigue.readiness_state.replaceAll('_', ' ')}</h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 opacity-80">{fatigue.reasons[0] ?? 'Your recent training load is within its usual pattern.'}</p>
          {fatigue.reasons[1] && <p className="mt-1.5 max-w-2xl text-xs leading-5 opacity-65">{fatigue.reasons[1]}</p>}
          <div className="mt-6 flex flex-wrap items-center gap-2">
            {topAction && <button type="button" onClick={() => onNavigate((topAction.tab || 'overview') as WorkoutView)} className={`${FOCUS} inline-flex min-h-10 items-center gap-2 rounded-lg bg-slate-950 px-3.5 text-xs font-semibold text-white transition hover:-translate-y-0.5 dark:bg-white dark:text-neutral-950`}>{topAction.title}<ArrowRight size={14} /></button>}
            <span className="text-[11px] opacity-65">Updated {summary.generated_at.slice(0, 16).replace('T', ' ')}</span>
          </div>
        </div>
        <div className="flex flex-col justify-between p-5 sm:p-6">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-neutral-500">Why this matters</p>
            <p className="mt-3 text-sm font-semibold text-slate-800 dark:text-neutral-100">{topAction?.title ?? 'Keep your current plan'}</p>
            <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-neutral-400">{topAction?.detail ?? 'No urgent change is indicated by the available data.'}</p>
          </div>
          <dl className="mt-5 grid grid-cols-3 gap-2 border-t border-slate-100 pt-4 text-center dark:border-neutral-800">
            <div><dt className="text-[10px] text-slate-400">ACWR</dt><dd className="mt-1 text-sm font-semibold tabular-nums">{fatigue.acwr_global?.toFixed(2) ?? '—'}</dd></div>
            <div><dt className="text-[10px] text-slate-400">Monotony</dt><dd className="mt-1 text-sm font-semibold tabular-nums">{fatigue.monotony?.toFixed(1) ?? '—'}</dd></div>
            <div><dt className="text-[10px] text-slate-400">Frequency</dt><dd className="mt-1 text-sm font-semibold tabular-nums">{fatigue.frequency.per_week_28d.toFixed(1)}/wk</dd></div>
          </dl>
        </div>
      </div>
    </section>

    <section className={`${SURFACE} p-4 sm:p-5`} aria-label="Period summary">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-xs font-semibold text-slate-800 dark:text-neutral-100">{bounds.from} to {bounds.to}</p><p className="mt-0.5 text-[11px] text-slate-400">Working sets exclude logged warm-ups. Volume is normalized by the coach.</p></div>
        <RangeControl value={range} onChange={onRangeChange} />
      </div>
      <div className="grid grid-cols-2 gap-y-5 sm:grid-cols-4">
        <MetricBlock label="Sessions" value={String(current.sessions)} delta={deltaPercent(current.sessions, previous.sessions)} detail={`${fatigue.frequency.per_week_28d.toFixed(1)} weekly over 28 days`} />
        <MetricBlock label="Working sets" value={String(current.workingSets)} delta={deltaPercent(current.workingSets, previous.workingSets)} detail="Non-warm-up sets" />
        <MetricBlock label="Training volume" value={compact(current.volume)} delta={deltaPercent(current.volume, previous.volume)} detail="Normalized load × repetitions" />
        <MetricBlock label="Strength momentum" value={`${momentum.progressing ?? 0} up`} delta={null} detail={`${momentum.plateau ?? 0} plateau · ${momentum.building ?? 0} building`} />
      </div>
    </section>

    <section className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(20rem,.65fr)]">
      <article className={`${SURFACE} min-w-0 p-4 sm:p-5`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <SectionTitle eyebrow="Training rhythm" title="What changed over time" detail="Switch the measure without stacking unrelated units on one axis." />
          <label className="inline-flex min-h-9 items-center gap-2 text-[11px] font-medium text-slate-500 dark:text-neutral-400"><input type="checkbox" checked={compare} onChange={(event) => onCompareChange(event.target.checked)} className="h-4 w-4 accent-teal-600" /> Compare prior period</label>
        </div>
        <div className="mt-4 flex flex-wrap gap-1.5" role="group" aria-label="Trend metric">
          {METRICS.map((item) => <button key={item.id} type="button" aria-pressed={metric === item.id} onClick={() => onMetricChange(item.id)} className={`${FOCUS} min-h-9 rounded-lg px-3 text-xs font-medium transition ${metric === item.id ? 'bg-teal-600 text-white dark:bg-teal-500 dark:text-neutral-950' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700'}`}>{item.label}</button>)}
        </div>
        <div className="mt-4 h-72 min-w-0" role="img" aria-label={`${METRICS.find((item) => item.id === metric)?.label} by week`}>
          {chartData.length > 1 ? <ResponsiveContainer width="100%" height="100%"><ComposedChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}><CartesianGrid vertical={false} stroke="currentColor" opacity={0.08} /><XAxis dataKey="label" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} /><Tooltip contentStyle={{ borderRadius: 12, borderColor: '#334155', background: '#0f172a', color: '#f8fafc', fontSize: 12 }} labelFormatter={(label) => `Week of ${label}`} /><Legend wrapperStyle={{ fontSize: 11 }} />{compare && <Line type="monotone" name="Previous period" dataKey="previous" stroke="#94a3b8" strokeDasharray="5 5" dot={false} connectNulls={false} />}<Area type="monotone" name={METRICS.find((item) => item.id === metric)?.label} dataKey={metric} stroke="#0d9488" strokeWidth={2.5} fill="#0d9488" fillOpacity={0.14} connectNulls={false} /></ComposedChart></ResponsiveContainer> : <div className="grid h-full place-items-center rounded-xl bg-slate-50 px-6 text-center text-sm text-slate-400 dark:bg-neutral-950">Log at least two weeks to draw a useful trend.</div>}
        </div>
        <details className="mt-2 text-xs text-slate-500 dark:text-neutral-400"><summary className={`${FOCUS} cursor-pointer rounded text-[11px] font-semibold text-teal-700 dark:text-teal-400`}>View chart data</summary><div className="mt-3 overflow-x-auto"><table className="w-full min-w-[28rem] text-left"><thead><tr className="border-b border-slate-200 text-[10px] uppercase tracking-wider text-slate-400 dark:border-neutral-800"><th className="py-2">Week</th><th>Sessions</th><th>Working sets</th><th>Volume</th><th>Bodyweight</th></tr></thead><tbody>{timeline.map((point) => <tr key={point.week} className="border-b border-slate-100 tabular-nums dark:border-neutral-800"><td className="py-2">{point.week}</td><td>{point.sessions}</td><td>{point.workingSets}</td><td>{compact(point.volume)}</td><td>{point.bodyweight ?? '—'}</td></tr>)}</tbody></table></div></details>
      </article>

      <aside className={`${SURFACE} overflow-hidden`} aria-label="Next actions">
        <div className="border-b border-slate-100 px-5 py-4 dark:border-neutral-800"><SectionTitle eyebrow="Coach priorities" title="Do next" detail="Ordered by urgency, not by category." /></div>
        <div className="divide-y divide-slate-100 dark:divide-neutral-800">{summary.next_actions.slice(0, 6).map((action, index) => <button key={`${action.kind}-${action.title}`} type="button" onClick={() => onNavigate((action.tab || 'overview') as WorkoutView)} className={`${FOCUS} group flex min-h-[4.75rem] w-full gap-3 px-5 py-3 text-left transition hover:bg-slate-50 dark:hover:bg-white/[0.035]`}><span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg text-xs font-semibold ${action.kind === 'declining' || action.kind === 'deload' ? 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400' : 'bg-teal-50 text-teal-700 dark:bg-teal-500/10 dark:text-teal-400'}`}>{index + 1}</span><span className="min-w-0"><span className="block text-sm font-semibold text-slate-800 dark:text-neutral-100">{action.title}</span><span className="mt-1 line-clamp-2 block text-xs leading-5 text-slate-400">{action.detail}</span></span><ArrowRight size={14} className="ml-auto mt-1 shrink-0 text-slate-300 transition group-hover:translate-x-0.5" /></button>)}</div>
      </aside>
    </section>

    <section className="grid gap-5 xl:grid-cols-2">
      <article className={`${SURFACE} min-w-0 p-4 sm:p-5`}>
        <div className="flex items-start justify-between gap-3"><SectionTitle eyebrow="Strength momentum" title="Which lifts are moving" detail="Each line starts at 100%, making unlike lifts comparable." /><button type="button" onClick={() => onNavigate('strength')} className={`${FOCUS} inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-teal-700 hover:bg-teal-50 dark:text-teal-400 dark:hover:bg-teal-500/10`}>Explore <ArrowRight size={13} /></button></div>
        <div className="mt-4 grid grid-cols-4 gap-2">{['progressing', 'plateau', 'building', 'declining'].map((status) => <button key={status} type="button" onClick={() => onNavigate('strength', { status })} className={`${FOCUS} rounded-lg bg-slate-50 px-2 py-2 text-left transition hover:bg-slate-100 dark:bg-neutral-950 dark:hover:bg-neutral-800`}><span className={`block text-lg font-semibold tabular-nums ${tone(status)}`}>{momentum[status] ?? 0}</span><span className="block truncate text-[10px] capitalize text-slate-400">{status}</span></button>)}</div>
        <div className="mt-4 h-64" role="img" aria-label="Normalized estimated one-rep max for the most frequently trained lifts">
          {strengthData.length > 1 ? <ResponsiveContainer width="100%" height="100%"><ComposedChart data={strengthData} margin={{ left: -10, right: 8 }}><CartesianGrid vertical={false} stroke="currentColor" opacity={0.08} /><XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={26} /><YAxis tick={{ fontSize: 10 }} domain={['auto', 'auto']} unit="%" /><Tooltip contentStyle={{ borderRadius: 12, borderColor: '#334155', background: '#0f172a', color: '#f8fafc', fontSize: 12 }} /><Legend wrapperStyle={{ fontSize: 10 }} />{strongest.map((exercise, index) => <Line key={exercise.name} type="monotone" dataKey={exercise.name} stroke={['#0d9488', '#38bdf8', '#f59e0b', '#a78bfa'][index]} strokeWidth={2} dot={false} connectNulls={false} />)}</ComposedChart></ResponsiveContainer> : <div className="grid h-full place-items-center rounded-xl bg-slate-50 text-sm text-slate-400 dark:bg-neutral-950">Strength trends need at least two sessions.</div>}
        </div>
      </article>

      <article className={`${SURFACE} p-4 sm:p-5`}>
        <div className="flex items-start justify-between gap-3"><SectionTitle eyebrow="Muscle balance" title="Volume against your landmarks" detail="Bars show recent weekly work relative to configured MEV, MAV, and MRV landmarks." /><button type="button" onClick={() => onNavigate('volume')} className={`${FOCUS} inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-teal-700 hover:bg-teal-50 dark:text-teal-400 dark:hover:bg-teal-500/10`}>Details <ArrowRight size={13} /></button></div>
        <div className="mt-5 space-y-3">{muscleRows.map(([muscle, detail]) => { const max = detail.mrv || Math.max(1, detail.sets_per_week_ewma); const currentWidth = Math.min(100, detail.sets_per_week_ewma / max * 100); const mevWidth = (detail.mev ?? 0) / max * 100; const mavWidth = (detail.mav ?? max) / max * 100; return <button key={muscle} type="button" onClick={() => onNavigate('body', { muscle })} className={`${FOCUS} group grid min-h-10 w-full grid-cols-[5.5rem_minmax(0,1fr)_3rem] items-center gap-3 rounded-lg text-left`}><span className="truncate text-xs font-medium capitalize text-slate-600 group-hover:text-slate-950 dark:text-neutral-300 dark:group-hover:text-white">{muscle}</span><span className="relative block h-2 rounded-full bg-slate-100 dark:bg-neutral-800"><span className="absolute inset-y-0 rounded-full bg-teal-500" style={{ width: `${currentWidth}%` }} /><span className="absolute inset-y-[-3px] w-px bg-amber-500" style={{ left: `${mevWidth}%` }} title="MEV" /><span className="absolute inset-y-[-3px] w-px bg-emerald-500" style={{ left: `${mavWidth}%` }} title="MAV" /></span><span className="text-right text-xs font-semibold tabular-nums text-slate-700 dark:text-neutral-200">{detail.sets_per_week_ewma.toFixed(1)}</span></button>; })}</div>
        <div className="mt-5 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 dark:border-neutral-800"><div><p className="text-[10px] text-slate-400">Push : pull</p><p className="mt-1 text-lg font-semibold tabular-nums">{summary.week_summary.ratios.push_pull?.toFixed(2) ?? '—'} <span className="text-[10px] font-normal text-slate-400">target {summary.week_summary.ratios.push_pull_target ?? '—'}</span></p></div><div><p className="text-[10px] text-slate-400">Upper : lower</p><p className="mt-1 text-lg font-semibold tabular-nums">{summary.week_summary.ratios.upper_lower?.toFixed(2) ?? '—'} <span className="text-[10px] font-normal text-slate-400">target {summary.week_summary.ratios.upper_lower_target ?? '—'}</span></p></div></div>
      </article>
    </section>

    <section className="grid gap-5 lg:grid-cols-3">
      <article className={`${SURFACE} p-5`}><div className="flex items-start justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-teal-600 dark:text-teal-400">Recovery signals</p><h2 className="mt-1 text-base font-semibold">What is driving the read</h2></div><Activity size={18} className="text-teal-600" /></div><div className="mt-4 space-y-3 text-xs leading-5 text-slate-500 dark:text-neutral-400"><p><strong className="text-slate-800 dark:text-neutral-100">Load change:</strong> ACWR {fatigue.acwr_global?.toFixed(2) ?? 'not available'}. This compares recent work with your established base.</p><p><strong className="text-slate-800 dark:text-neutral-100">Session strain:</strong> {fatigue.strain?.toFixed(1) ?? 'not available'} with monotony {fatigue.monotony?.toFixed(1) ?? 'not available'}.</p>{Object.entries(fatigue.acwr_by_muscle ?? {}).map(([muscle, value]) => <p key={muscle} className="flex justify-between gap-3"><span className="capitalize">{muscle}</span><span className="font-semibold tabular-nums text-amber-600 dark:text-amber-400">{value.toFixed(2)}</span></p>)}</div></article>
      <article className={`${SURFACE} p-5`}><div className="flex items-start justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-teal-600 dark:text-teal-400">Goals and bodyweight</p><h2 className="mt-1 text-base font-semibold">Personal progress</h2></div><Target size={18} className="text-teal-600" /></div><div className="mt-4 space-y-4">{summary.goals.slice(0, 2).map((goal) => <button key={goal.goal_id} type="button" onClick={() => onNavigate('goals')} className={`${FOCUS} block w-full rounded-lg bg-slate-50 p-3 text-left dark:bg-neutral-950`}><span className="text-xs font-semibold">{goal.exercise}</span><span className={`float-right text-[10px] font-semibold capitalize ${tone(goal.verdict)}`}>{goal.verdict.replaceAll('_', ' ')}</span><span className="mt-1 block text-[11px] text-slate-400">{goal.current?.toFixed(1) ?? '—'} / {goal.target_value} {goal.metric}</span></button>)}{!summary.goals.length && <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-400 dark:bg-neutral-950">No active goals. Add one to measure pace and projected dates.</p>}<div className="border-t border-slate-100 pt-3 dark:border-neutral-800"><p className="text-[10px] text-slate-400">Latest bodyweight</p><p className="mt-1 text-xl font-semibold tabular-nums">{latestBodyweight ? `${latestBodyweight.weight.toFixed(1)} ${latestBodyweight.unit}` : 'Not logged'}</p><p className="mt-1 text-[10px] text-slate-400">{bodyweightChange == null ? 'Add another entry to see change.' : `${bodyweightChange >= 0 ? '+' : ''}${bodyweightChange.toFixed(1)} kg in this range`}</p></div></div></article>
      <article className={`${SURFACE} p-5`}><div className="flex items-start justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-teal-600 dark:text-teal-400">Data confidence</p><h2 className="mt-1 text-base font-semibold">How well the coach knows you</h2></div><BrainCircuit size={18} className="text-teal-600" /></div><div className="mt-4 grid grid-cols-3 gap-2 text-center"><div className="rounded-lg bg-slate-50 p-2 dark:bg-neutral-950"><p className="text-lg font-semibold tabular-nums">{summary.grace_overview.confident ?? 0}</p><p className="text-[9px] text-slate-400">Confident</p></div><div className="rounded-lg bg-slate-50 p-2 dark:bg-neutral-950"><p className="text-lg font-semibold tabular-nums">{summary.grace_overview.learning ?? 0}</p><p className="text-[9px] text-slate-400">Learning</p></div><div className="rounded-lg bg-slate-50 p-2 dark:bg-neutral-950"><p className="text-lg font-semibold tabular-nums">{summary.grace_overview.calibrating ?? 0}</p><p className="text-[9px] text-slate-400">Calibrating</p></div></div><ul className="mt-4 space-y-2 text-[11px] leading-5 text-slate-500 dark:text-neutral-400"><li className="flex gap-2"><Info size={13} className="mt-1 shrink-0 text-teal-600" />Forecast validation: {forecastReady ? `${summary.forecast_accuracy?.n} historical checks` : 'needs more history; projections are labeled uncalibrated'}.</li><li className="flex gap-2"><Scale size={13} className="mt-1 shrink-0 text-teal-600" />RPE {summary.data_quality.rpe_present ? 'is available for personalized predictions' : 'is missing; predictions rely on broader priors'}.</li><li className="flex gap-2"><Sparkles size={13} className="mt-1 shrink-0 text-teal-600" />{summary.data_quality.anomalies_corrected.length} logged anomal{summary.data_quality.anomalies_corrected.length === 1 ? 'y was' : 'ies were'} corrected.</li></ul></article>
    </section>

    <div className="flex flex-wrap items-center gap-4 px-1 text-[10px] text-slate-400 dark:text-neutral-500"><span className="inline-flex items-center gap-1"><Dumbbell size={11} /> e1RM means estimated one-repetition maximum.</span><span className="inline-flex items-center gap-1"><BarChart3 size={11} /> MEV/MAV/MRV are configured volume landmarks, not medical limits.</span></div>
  </div>;
}

