import { useEffect, useMemo, useRef, useState } from 'react';
import type { WorkoutExerciseDTO, WorkoutExerciseHistoryDTO, WorkoutSummaryDTO } from '@timeblock/shared';
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  BrainCircuit,
  CalendarDays,
  Check,
  ChevronDown,
  CircleGauge,
  Dumbbell,
  Info,
  Layers3,
  Search,
  SlidersHorizontal,
  Sparkles,
  Target,
  Trophy,
  X,
} from 'lucide-react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useWorkoutExerciseHistory } from '../../hooks/workout.js';
import {
  epochPerformanceSeries,
  filterAndSortExercises,
  normalizedLiftSeries,
  rangeBounds,
  toggleLiftComparison,
  type StrengthSort,
  type WorkoutRange,
} from './workoutAnalytics.js';

export type StrengthMode = 'progress' | 'performance' | 'sessions' | 'coach' | 'compare';

type Props = {
  summary: WorkoutSummaryDTO;
  range: WorkoutRange;
  exerciseName: string;
  search: string;
  status: string;
  muscle: string;
  sort: StrengthSort;
  mode: StrengthMode;
  onParam(key: string, value: string, replace?: boolean): void;
};

const SURFACE = 'rounded-2xl bg-white ring-1 ring-slate-200/80 dark:bg-neutral-900 dark:ring-white/[0.08]';
const CONTROL = 'min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-700 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-200';
const FOCUS = 'outline-none focus-visible:ring-2 focus-visible:ring-teal-500/60';

function tone(status: string) {
  if (['progressing', 'recovering_well', 'green', 'achieved', 'on_track'].includes(status)) return 'text-emerald-600 dark:text-emerald-400';
  if (['declining', 'under_recovering', 'red', 'off_track'].includes(status)) return 'text-rose-600 dark:text-rose-400';
  return 'text-amber-600 dark:text-amber-400';
}

function statusIcon(status: string) {
  if (status === 'progressing') return ArrowUpRight;
  if (status === 'declining') return ArrowDownRight;
  return Activity;
}

function Sparkline({ series }: { series: Array<[string, number]> }) {
  if (series.length < 2) return <span className="h-7 w-14 rounded bg-slate-100 dark:bg-neutral-800" />;
  const values = series.slice(-8).map(([, value]) => value);
  const min = Math.min(...values);
  const span = Math.max(1, Math.max(...values) - min);
  const points = values.map((value, index) => `${index / Math.max(1, values.length - 1) * 54},${24 - (value - min) / span * 20}`).join(' ');
  return <svg width="56" height="28" viewBox="0 0 56 28" role="img" aria-label="Recent strength sparkline"><polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" className="text-teal-600 dark:text-teal-400" /></svg>;
}

export function ExerciseRow({ exercise, selected, onClick }: { exercise: WorkoutExerciseDTO; selected: boolean; onClick(): void }) {
  const Icon = statusIcon(exercise.status);
  return <button type="button" aria-selected={selected} onClick={onClick} className={`${FOCUS} group grid min-h-[4.8rem] w-full grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-slate-100 px-3 py-3 text-left transition last:border-0 hover:bg-slate-50 dark:border-neutral-800 dark:hover:bg-white/[0.035] ${selected ? 'bg-teal-50/70 dark:bg-teal-500/[0.075]' : ''}`}>
    <span className="min-w-0"><span className="block truncate text-sm font-semibold text-slate-800 dark:text-neutral-100">{exercise.name}</span><span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] capitalize text-slate-400"><span>{exercise.muscle}</span><span>{exercise.n_sessions} sessions</span><span>{exercise.last_trained ?? 'not trained'}</span></span><span className={`mt-1 inline-flex items-center gap-1 text-[10px] font-semibold capitalize ${tone(exercise.status)}`}><Icon size={11} />{exercise.status}{exercise.e1rm_trend_per_week != null && <span className="font-normal text-slate-400">{exercise.e1rm_trend_per_week >= 0 ? '+' : ''}{exercise.e1rm_trend_per_week.toFixed(1)} kg/wk</span>}</span></span>
    <span className="flex flex-col items-end gap-1"><Sparkline series={exercise.series} /><span className="text-[10px] font-semibold tabular-nums text-slate-500 dark:text-neutral-400">{exercise.best_e1rm?.toFixed(1) ?? '—'} kg</span></span>
  </button>;
}

export function ExerciseFilters({ search, status, muscle, sort, muscles, onParam }: Omit<Props, 'summary' | 'range' | 'exerciseName' | 'mode'> & { muscles: string[] }) {
  return <div className="grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-1">
    <label className="relative block sm:col-span-2 lg:col-span-1"><span className="sr-only">Search exercises</span><Search size={14} className="pointer-events-none absolute left-3 top-3.5 text-slate-400" /><input value={search} onChange={(event) => onParam('search', event.target.value, true)} className={`${CONTROL} w-full pl-9`} placeholder="Search exercises" /></label>
    <div className="grid grid-cols-2 gap-2"><label><span className="sr-only">Status</span><select value={status} onChange={(event) => onParam('status', event.target.value, true)} className={`${CONTROL} w-full`}><option value="all">All statuses</option><option value="progressing">Progressing</option><option value="plateau">Plateau</option><option value="declining">Declining</option><option value="building">Building</option><option value="insufficient">Insufficient</option></select></label><label><span className="sr-only">Muscle</span><select value={muscle} onChange={(event) => onParam('muscle', event.target.value, true)} className={`${CONTROL} w-full capitalize`}><option value="all">All muscles</option>{muscles.map((item) => <option key={item} value={item}>{item}</option>)}</select></label></div>
    <label className="relative"><span className="sr-only">Sort exercises</span><SlidersHorizontal size={13} className="pointer-events-none absolute left-3 top-3.5 text-slate-400" /><select value={sort} onChange={(event) => onParam('sort', event.target.value, true)} className={`${CONTROL} w-full pl-8`}><option value="attention">Needs attention</option><option value="trend">Strongest trend</option><option value="recent">Last trained</option><option value="sessions">Most sessions</option><option value="e1rm">Best e1RM</option><option value="name">Name</option></select></label>
  </div>;
}

export function EmptyPanel({ children }: { children: string }) {
  return <div className="grid min-h-64 place-items-center rounded-xl bg-slate-50 px-8 text-center text-sm leading-6 text-slate-400 dark:bg-neutral-950">{children}</div>;
}

function addWeeks(date: string, weeks: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + weeks * 7);
  return value.toISOString().slice(0, 10);
}

function ProgressView({ exercise, summary, from }: { exercise: WorkoutExerciseDTO; summary: WorkoutSummaryDTO; from: string }) {
  const points = exercise.series.filter(([date]) => date >= from).map(([date, value]) => ({ date, value, forecast: null as number | null, band: null as [number, number] | null }));
  const forecast = exercise.forecast;
  const forecastValidated = (summary.forecast_accuracy?.n ?? 0) >= 8 && Boolean(forecast?.band);
  if (points.length && forecast?.e1rm_in_horizon != null) {
    points[points.length - 1].forecast = points[points.length - 1].value;
    points.push({ date: addWeeks(points[points.length - 1].date, forecast.horizon_weeks), value: null as unknown as number, forecast: forecast.e1rm_in_horizon, band: forecastValidated ? forecast.band : null });
  }
  return <div>
    <div className="mb-3 flex flex-wrap items-center gap-2 text-[10px]"><span className="rounded-md bg-slate-100 px-2 py-1 text-slate-500 dark:bg-neutral-800 dark:text-neutral-400">Solid: recorded e1RM</span>{forecast?.e1rm_in_horizon != null && <span className="rounded-md bg-teal-50 px-2 py-1 text-teal-700 dark:bg-teal-500/10 dark:text-teal-400">Dashed: {forecastValidated ? 'validated forecast' : 'uncalibrated projection'}</span>}</div>
    <div className="h-80 min-w-0" role="img" aria-label={`${exercise.name} estimated one-repetition maximum progression`}>
      {points.length > 1 ? <ResponsiveContainer width="100%" height="100%"><ComposedChart data={points} margin={{ left: -5, right: 12, top: 10 }}><CartesianGrid vertical={false} stroke="currentColor" opacity={0.08} /><XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={28} /><YAxis tick={{ fontSize: 10 }} domain={['auto', 'auto']} unit=" kg" /><Tooltip contentStyle={{ borderRadius: 12, borderColor: '#334155', background: '#0f172a', color: '#f8fafc', fontSize: 12 }} /><Legend wrapperStyle={{ fontSize: 11 }} />{forecastValidated && <Area type="monotone" dataKey="band" name="Forecast range" stroke="none" fill="#0d9488" fillOpacity={0.12} connectNulls={false} />}<Line type="monotone" dataKey="value" name="Recorded e1RM" stroke="#0d9488" strokeWidth={2.5} dot={{ r: 2.5 }} connectNulls={false} /><Line type="monotone" dataKey="forecast" name="Projection" stroke="#0d9488" strokeDasharray="6 5" strokeWidth={2} dot={false} connectNulls />{exercise.recent_pr && <ReferenceLine x={exercise.recent_pr.date} stroke="#f59e0b" strokeDasharray="3 4" label={{ value: 'PR', fill: '#f59e0b', fontSize: 10 }} />}{exercise.plateau.onset && <ReferenceLine x={exercise.plateau.onset} stroke="#fb7185" strokeDasharray="3 4" label={{ value: 'Plateau', fill: '#fb7185', fontSize: 10 }} />}</ComposedChart></ResponsiveContainer> : <EmptyPanel>Log at least two clean sessions in this unit epoch to draw a progression line.</EmptyPanel>}
    </div>
    {forecast && <div className="mt-4 grid gap-3 rounded-xl bg-slate-50 p-4 text-xs dark:bg-neutral-950 sm:grid-cols-3"><div><p className="text-[10px] text-slate-400">{forecast.horizon_weeks}-week projection</p><p className="mt-1 text-lg font-semibold tabular-nums">{forecast.e1rm_in_horizon?.toFixed(1) ?? '—'} kg</p></div><div><p className="text-[10px] text-slate-400">Reliability</p><p className={`mt-1 text-sm font-semibold ${forecastValidated ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>{forecastValidated ? `${summary.forecast_accuracy?.n} backtests` : 'Not yet validated'}</p></div><div><p className="text-[10px] text-slate-400">Coach note</p><p className="mt-1 leading-5 text-slate-600 dark:text-neutral-300">{forecast.note ?? (forecastValidated ? 'The band uses your historical forecast errors.' : 'Treat this as a direction, not a promise.')}</p></div></div>}
  </div>;
}

type PerformanceMetric = 'topWeight' | 'topReps' | 'volume' | 'workingSets';
function PerformanceView({ history }: { history: WorkoutExerciseHistoryDTO | undefined }) {
  const [metric, setMetric] = useState<PerformanceMetric>('topWeight');
  const labels: Record<PerformanceMetric, string> = { topWeight: 'Top weight', topReps: 'Top-set reps', volume: 'Session volume', workingSets: 'Working sets' };
  const timeline = history ? epochPerformanceSeries(history, metric) : { rows: [], epochs: [] };
  const colors = ['#0d9488', '#38bdf8', '#f59e0b', '#a78bfa'];
  return <div><div className="mb-4 flex flex-wrap gap-1.5">{(Object.keys(labels) as PerformanceMetric[]).map((item) => <button key={item} type="button" aria-pressed={metric === item} onClick={() => setMetric(item)} className={`${FOCUS} min-h-9 rounded-lg px-3 text-xs font-medium ${metric === item ? 'bg-teal-600 text-white dark:bg-teal-500 dark:text-neutral-950' : 'bg-slate-100 text-slate-600 dark:bg-neutral-800 dark:text-neutral-300'}`}>{labels[item]}</button>)}</div><div className="h-80" role="img" aria-label={`${labels[metric]} by session, separated at unit changes`}>{timeline.rows.length > 1 ? <ResponsiveContainer width="100%" height="100%"><ComposedChart data={timeline.rows} margin={{ left: -5, right: 10 }}><CartesianGrid vertical={false} stroke="currentColor" opacity={0.08} /><XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={28} /><YAxis tick={{ fontSize: 10 }} domain={['auto', 'auto']} /><Tooltip contentStyle={{ borderRadius: 12, borderColor: '#334155', background: '#0f172a', color: '#f8fafc', fontSize: 12 }} /><Legend wrapperStyle={{ fontSize: 10 }} />{timeline.epochs.map((epoch, index) => <Line key={epoch} type="monotone" dataKey={`epoch${epoch}`} name={timeline.epochs.length > 1 ? `${labels[metric]} · epoch ${epoch + 1}` : labels[metric]} stroke={colors[index % colors.length]} strokeWidth={2.5} dot={{ r: 2.5 }} connectNulls={false} />)}</ComposedChart></ResponsiveContainer> : <EmptyPanel>More session history is needed for this performance view.</EmptyPanel>}</div>{timeline.epochs.length > 1 && <p className="mt-2 text-[10px] text-amber-600 dark:text-amber-400">Unit epochs are drawn as separate series; values are never connected across a unit correction.</p>}</div>;
}

export function SessionHistory({ history, loading, error }: { history?: WorkoutExerciseHistoryDTO; loading: boolean; error: Error | null }) {
  if (loading) return <div className="space-y-3">{Array.from({ length: 4 }, (_, index) => <div key={index} className="h-20 animate-pulse rounded-xl bg-slate-100 dark:bg-neutral-800" />)}</div>;
  if (error) return <EmptyPanel>{error.message}</EmptyPanel>;
  if (!history?.sessions.length) return <EmptyPanel>No sessions fall inside this date range.</EmptyPanel>;
  return <div className="space-y-2">{history.sessions.map((session) => <details key={session.date} className="group rounded-xl bg-slate-50 open:ring-1 open:ring-teal-500/25 dark:bg-neutral-950"><summary className={`${FOCUS} flex min-h-[4.5rem] cursor-pointer list-none items-center gap-3 rounded-xl px-4 py-3`}><CalendarDays size={15} className="shrink-0 text-teal-600" /><span className="min-w-0"><span className="block truncate text-sm font-semibold text-slate-800 dark:text-neutral-100">{session.title}</span><span className="mt-0.5 block text-[10px] text-slate-400">{session.date} · {session.working_sets} working sets · {Math.round(session.total_volume).toLocaleString()} volume</span></span><span className="ml-auto text-right"><span className="block text-xs font-semibold tabular-nums">{session.top_weight ?? '—'} kg × {session.top_reps ?? '—'}</span><span className="text-[10px] text-slate-400">{session.top_e1rm ?? '—'} e1RM</span></span><ChevronDown size={14} className="shrink-0 text-slate-400 transition group-open:rotate-180" /></summary><div className="border-t border-slate-200 p-3 dark:border-neutral-800"><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{session.sets.map((set) => <div key={`${session.date}-${set.index}`} className={`rounded-lg p-3 text-xs ${set.is_working ? 'bg-white dark:bg-neutral-900' : 'bg-slate-100 text-slate-500 dark:bg-neutral-800 dark:text-neutral-400'}`}><div className="flex items-center justify-between"><span className="font-semibold">Set {set.index + 1}</span><span className="text-[9px] uppercase tracking-wider text-slate-400">{set.type ?? (set.is_working ? 'working' : 'warm-up')}</span></div><p className="mt-2 text-base font-semibold tabular-nums text-slate-900 dark:text-white">{set.weight ?? '—'} kg × {set.reps ?? '—'}</p><div className="mt-2 grid grid-cols-3 gap-2 text-[10px] text-slate-400"><span>RPE <strong className="block text-xs text-slate-600 dark:text-neutral-300">{set.rpe ?? '—'}</strong></span><span>RIR <strong className="block text-xs text-slate-600 dark:text-neutral-300">{set.rir ?? '—'}</strong></span><span>Rest <strong className="block text-xs text-slate-600 dark:text-neutral-300">{set.rest_seconds != null ? `${Math.round(set.rest_seconds)}s` : '—'}</strong></span><span>e1RM <strong className="block text-xs text-slate-600 dark:text-neutral-300">{set.e1rm ?? '—'}</strong></span><span>Volume <strong className="block text-xs text-slate-600 dark:text-neutral-300">{set.volume ?? '—'}</strong></span><span>Epoch <strong className="block text-xs text-slate-600 dark:text-neutral-300">{set.epoch + 1}</strong></span></div>{set.quality_flag && <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-[9px] text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">Data note: {set.quality_flag.replaceAll('_', ' ')}</p>}</div>)}</div></div></details>)}</div>;
}

function CoachView({ exercise, summary }: { exercise: WorkoutExerciseDTO; summary: WorkoutSummaryDTO }) {
  const individual = exercise.individualization;
  const plateau = exercise.plateau;
  return <div className="grid gap-4 lg:grid-cols-2"><section className="rounded-xl bg-slate-50 p-4 dark:bg-neutral-950"><div className="flex items-center gap-2"><CircleGauge size={16} className="text-teal-600" /><h3 className="text-sm font-semibold">Plateau and potential</h3></div><dl className="mt-4 grid grid-cols-2 gap-3 text-xs"><div><dt className="text-[10px] text-slate-400">Verdict</dt><dd className={`mt-1 font-semibold capitalize ${tone(plateau.verdict)}`}>{plateau.verdict}</dd></div><div><dt className="text-[10px] text-slate-400">Detected onset</dt><dd className="mt-1 font-semibold tabular-nums">{plateau.onset ?? 'None'}</dd></div><div><dt className="text-[10px] text-slate-400">Estimated ceiling</dt><dd className="mt-1 font-semibold tabular-nums">{plateau.ceiling?.ceiling?.toFixed(1) ?? '—'} kg</dd></div><div><dt className="text-[10px] text-slate-400">Current position</dt><dd className="mt-1 font-semibold tabular-nums">{plateau.ceiling?.pct_of_ceiling?.toFixed(0) ?? '—'}%</dd></div></dl><p className="mt-4 text-[11px] leading-5 text-slate-500 dark:text-neutral-400">The ceiling is a fitted training estimate, not a physiological limit. A plateau means the recent slope flattened after enough sessions.</p></section><section className="rounded-xl bg-slate-50 p-4 dark:bg-neutral-950"><div className="flex items-center gap-2"><BrainCircuit size={16} className="text-teal-600" /><h3 className="text-sm font-semibold">Personal model</h3></div><div className="mt-4 flex items-end justify-between"><div><p className="text-2xl font-semibold capitalize tracking-[-0.035em]">{individual.grace_state}</p><p className="mt-1 text-[10px] text-slate-400">{individual.n_fresh} fresh sets available</p></div><p className="text-xl font-semibold tabular-nums text-teal-600 dark:text-teal-400">{individual.confidence}%</p></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-neutral-800"><div className="h-full rounded-full bg-teal-500" style={{ width: `${Math.max(2, individual.confidence)}%` }} /></div><p className="mt-4 text-[11px] leading-5 text-slate-500 dark:text-neutral-400">Prediction basis: {exercise.next_target?.prediction_basis ?? individual.anchor?.basis ?? 'general prior'}. Personalized 1RM: {individual.individ_1rm?.toFixed(1) ?? 'not ready'}.</p></section><section className="rounded-xl bg-slate-50 p-4 dark:bg-neutral-950 lg:col-span-2"><div className="flex items-center gap-2"><Info size={16} className="text-teal-600" /><h3 className="text-sm font-semibold">Recommendation reliability</h3></div><div className="mt-4 grid gap-3 sm:grid-cols-3"><div><p className="text-[10px] text-slate-400">Trend confidence</p><p className="mt-1 text-sm font-semibold capitalize">{exercise.trend_confidence}</p></div><div><p className="text-[10px] text-slate-400">Rep prediction</p><p className="mt-1 text-sm font-semibold">{exercise.next_target?.prediction_confidence ?? '—'}% confidence</p></div><div><p className="text-[10px] text-slate-400">Forecast checks</p><p className="mt-1 text-sm font-semibold">{summary.forecast_accuracy?.n ?? 0}</p></div></div><p className="mt-4 text-[11px] leading-5 text-slate-500 dark:text-neutral-400">Low confidence is shown rather than hidden. More consistent RPE entries across varied loads help the model move from calibrating to learning and confident.</p></section></div>;
}

function CompareView({ exercises, from, selectedName }: { exercises: WorkoutExerciseDTO[]; from: string; selectedName: string }) {
  const candidates = exercises.filter((item) => item.series.filter(([date]) => date >= from).length >= 2);
  const [selected, setSelected] = useState<string[]>(() => [selectedName, ...candidates.filter((item) => item.name !== selectedName).slice(0, 2).map((item) => item.name)].slice(0, 4));
  const [normalized, setNormalized] = useState(true);
  useEffect(() => { if (selectedName && !selected.includes(selectedName)) setSelected((items) => [selectedName, ...items].slice(0, 4)); }, [selectedName]);
  const data = useMemo(() => {
    if (normalized) return normalizedLiftSeries(exercises, selected, from);
    const chosen = exercises.filter((item) => selected.includes(item.name));
    const dates = [...new Set(chosen.flatMap((item) => item.series.filter(([date]) => date >= from).map(([date]) => date)))].sort();
    return dates.map((date) => Object.assign({ date }, ...chosen.map((item) => ({ [item.name]: item.series.find(([day]) => day === date)?.[1] ?? null }))));
  }, [exercises, from, normalized, selected]);
  const toggle = (name: string) => setSelected((items) => toggleLiftComparison(items, name));
  return <div><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">{candidates.map((item) => <button key={item.name} type="button" aria-pressed={selected.includes(item.name)} onClick={() => toggle(item.name)} className={`${FOCUS} inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-[10px] ${selected.includes(item.name) ? 'bg-teal-600 text-white dark:bg-teal-500 dark:text-neutral-950' : 'bg-slate-100 text-slate-500 dark:bg-neutral-800 dark:text-neutral-400'} ${!selected.includes(item.name) && selected.length >= 4 ? 'opacity-45' : ''}`}>{selected.includes(item.name) && <Check size={10} />}{item.name}</button>)}</div><label className="inline-flex items-center gap-2 text-[11px] text-slate-500"><input type="checkbox" checked={normalized} onChange={(event) => setNormalized(event.target.checked)} className="accent-teal-600" /> Normalize to 100%</label></div><p className="mt-3 text-[10px] text-slate-400">Choose up to four lifts. Normalized mode compares change, not absolute strength.</p><div className="mt-4 h-80" role="img" aria-label="Comparison of selected exercise strength trends">{data.length > 1 ? <ResponsiveContainer width="100%" height="100%"><ComposedChart data={data} margin={{ left: -4, right: 12 }}><CartesianGrid vertical={false} stroke="currentColor" opacity={0.08} /><XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={28} /><YAxis tick={{ fontSize: 10 }} unit={normalized ? '%' : ' kg'} domain={['auto', 'auto']} /><Tooltip contentStyle={{ borderRadius: 12, borderColor: '#334155', background: '#0f172a', color: '#f8fafc', fontSize: 12 }} /><Legend wrapperStyle={{ fontSize: 10 }} />{selected.map((name, index) => <Line key={name} type="monotone" dataKey={name} stroke={['#0d9488', '#38bdf8', '#f59e0b', '#a78bfa'][index]} strokeWidth={2.5} dot={false} connectNulls={false} />)}</ComposedChart></ResponsiveContainer> : <EmptyPanel>Choose lifts with at least two sessions in this range.</EmptyPanel>}</div></div>;
}

export default function WorkoutStrength({ summary, range, exerciseName, search, status, muscle, sort, mode, onParam }: Props) {
  const bounds = rangeBounds(summary, range);
  const muscles = [...new Set(summary.exercises.map((item) => item.muscle))].sort();
  const filtered = filterAndSortExercises(summary.exercises, { search, status, muscle, sort });
  const selected = summary.exercises.find((item) => item.name === exerciseName) ?? filtered[0] ?? summary.exercises[0];
  const history = useWorkoutExerciseHistory(selected?.name ?? null, bounds.from, bounds.to);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (selected && selected.name !== exerciseName) onParam('exercise', selected.name, true);
  }, [selected?.name, exerciseName]);
  if (!selected) return <EmptyPanel>No exercises are available. Import or sync workout history first.</EmptyPanel>;
  const target = selected.next_target;
  const StatusIcon = statusIcon(selected.status);
  const modes: Array<{ id: StrengthMode; label: string; icon: typeof Activity }> = [
    { id: 'progress', label: 'Progress', icon: BarChart3 },
    { id: 'performance', label: 'Performance', icon: Activity },
    { id: 'sessions', label: 'Sessions', icon: CalendarDays },
    { id: 'coach', label: 'Coach', icon: BrainCircuit },
    { id: 'compare', label: 'Compare', icon: Layers3 },
  ];
  const choose = (name: string) => { onParam('exercise', name); dialogRef.current?.close(); };
  return <div className="mx-auto w-full max-w-[1480px] pb-8">
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.19em] text-teal-600 dark:text-teal-400">Strength explorer</p><h1 className="mt-1 text-3xl font-semibold tracking-[-0.055em] text-slate-950 dark:text-white">Understand every lift</h1><p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500 dark:text-neutral-400">Recorded performance, the next prescription, and the evidence behind the coach’s recommendation.</p></div><button type="button" onClick={() => dialogRef.current?.showModal()} className={`${FOCUS} inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 lg:hidden`}><Search size={14} /> Choose exercise</button></div>
    <div className="grid min-w-0 gap-5 lg:grid-cols-[19rem_minmax(0,1fr)]">
      <aside className={`${SURFACE} hidden self-start overflow-hidden lg:sticky lg:top-2 lg:block`} aria-label="Exercise navigator"><ExerciseFilters search={search} status={status} muscle={muscle} sort={sort} muscles={muscles} onParam={onParam} /><div className="max-h-[calc(100dvh-17rem)] overflow-y-auto border-t border-slate-100 dark:border-neutral-800">{filtered.length ? filtered.map((item) => <ExerciseRow key={item.name} exercise={item} selected={item.name === selected.name} onClick={() => choose(item.name)} />) : <p className="p-6 text-center text-xs text-slate-400">No exercises match these filters.</p>}</div></aside>

      <div className="min-w-0 space-y-4">
        <section className={`${SURFACE} overflow-hidden`}>
          <div className="grid xl:grid-cols-[minmax(0,1.15fr)_minmax(18rem,.85fr)]">
            <div className="p-5 sm:p-6"><div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">{selected.muscle} · last trained {selected.last_trained ?? 'unknown'}</p><h2 className="mt-1 text-2xl font-semibold tracking-[-0.045em] text-slate-950 text-balance dark:text-white">{selected.name}</h2><span className={`mt-2 inline-flex items-center gap-1 text-xs font-semibold capitalize ${tone(selected.status)}`}><StatusIcon size={13} />{selected.status} · {selected.trend_confidence} confidence</span></div><div className="text-left sm:text-right"><p className="text-3xl font-semibold tracking-[-0.05em] tabular-nums text-slate-950 dark:text-white">{selected.best_e1rm?.toFixed(1) ?? '—'} <span className="text-xs font-medium tracking-normal text-slate-400">kg e1RM</span></p><p className="mt-1 text-[10px] text-slate-400">Best set {selected.best_e1rm_set ?? 'not available'} · heaviest {selected.heaviest ?? '—'}</p></div></div><dl className="mt-6 grid grid-cols-2 gap-4 border-t border-slate-100 pt-5 sm:grid-cols-4 dark:border-neutral-800"><div><dt className="text-[10px] text-slate-400">Weekly trend</dt><dd className={`mt-1 text-sm font-semibold tabular-nums ${tone(selected.status)}`}>{selected.e1rm_trend_per_week == null ? '—' : `${selected.e1rm_trend_per_week >= 0 ? '+' : ''}${selected.e1rm_trend_per_week.toFixed(1)} kg`}</dd></div><div><dt className="text-[10px] text-slate-400">Sessions</dt><dd className="mt-1 text-sm font-semibold tabular-nums">{selected.n_sessions}</dd></div><div><dt className="text-[10px] text-slate-400">Recent PR</dt><dd className="mt-1 text-sm font-semibold tabular-nums">{selected.recent_pr ? `${selected.recent_pr.value.toFixed(1)} kg` : 'None'}</dd></div><div><dt className="text-[10px] text-slate-400">Model state</dt><dd className="mt-1 text-sm font-semibold capitalize">{selected.individualization.grace_state}</dd></div></dl></div>
            <div className="bg-slate-950 p-5 text-white dark:bg-teal-950/40 sm:p-6"><div className="flex items-center justify-between"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-teal-300">Next session</p><Target size={17} className="text-teal-300" /></div><div className="mt-5 flex flex-wrap items-end gap-x-4 gap-y-2"><p className="text-4xl font-semibold tracking-[-0.055em] tabular-nums">{target?.weight ?? '—'}<span className="ml-1 text-xs font-medium text-slate-400">kg</span></p><p className="pb-1 text-lg font-semibold tabular-nums text-slate-200">× {target?.reps ?? '—'} reps × {target?.n_sets ?? target?.sets?.length ?? '—'} sets</p></div><p className="mt-4 text-xs leading-5 text-slate-300">{target?.rationale ?? 'Build more clean sessions before the coach sets a specific target.'}</p><details className="mt-4 border-t border-white/10 pt-3"><summary className={`${FOCUS} cursor-pointer rounded text-[11px] font-semibold text-teal-300`}>Why this target?</summary><div className="mt-3 grid grid-cols-2 gap-3 text-[10px] text-slate-400"><span>Predicted reps <strong className="block text-xs text-white">{target?.predicted_reps ?? '—'} {target?.predicted_range ? `(${target.predicted_range[0]}–${target.predicted_range[1]})` : ''}</strong></span><span>Confidence <strong className="block text-xs text-white">{target?.prediction_confidence ?? '—'}%</strong></span><span>Basis <strong className="block text-xs text-white">{target?.prediction_basis ?? 'general model'}</strong></span><span>Last effort <strong className="block text-xs text-white">RPE {target?.last_rpe ?? '—'} · RIR {target?.last_reserve ?? '—'}</strong></span></div></details></div>
          </div>
        </section>

        <section className={`${SURFACE} min-w-0 overflow-hidden`}>
          <nav className="flex overflow-x-auto border-b border-slate-100 px-2 dark:border-neutral-800" aria-label="Exercise details">{modes.map(({ id, label, icon: Icon }) => <button key={id} type="button" aria-current={mode === id ? 'page' : undefined} onClick={() => onParam('metric', id)} className={`${FOCUS} relative inline-flex min-h-12 shrink-0 items-center gap-1.5 px-3 text-xs font-semibold transition ${mode === id ? 'text-teal-700 dark:text-teal-400' : 'text-slate-500 hover:text-slate-900 dark:text-neutral-400 dark:hover:text-white'}`}><Icon size={13} />{label}{mode === id && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded bg-teal-500" />}</button>)}</nav>
          <div className="p-4 sm:p-5">{mode === 'progress' && <ProgressView exercise={selected} summary={summary} from={bounds.from} />}{mode === 'performance' && <PerformanceView history={history.data} />}{mode === 'sessions' && <SessionHistory history={history.data} loading={history.isLoading} error={history.error} />}{mode === 'coach' && <CoachView exercise={selected} summary={summary} />}{mode === 'compare' && <CompareView exercises={summary.exercises} from={bounds.from} selectedName={selected.name} />}</div>
        </section>
      </div>
    </div>

    <dialog ref={dialogRef} className="m-0 h-dvh max-h-none w-full max-w-none bg-slate-50 p-0 text-slate-900 backdrop:bg-slate-950/55 dark:bg-neutral-950 dark:text-neutral-100 lg:hidden"><div className="flex h-full min-h-0 flex-col"><header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900"><div><p className="text-[10px] uppercase tracking-wider text-teal-600">Strength</p><h2 className="text-lg font-semibold">Choose an exercise</h2></div><button type="button" aria-label="Close exercise chooser" onClick={() => dialogRef.current?.close()} className={`${FOCUS} grid h-11 w-11 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-neutral-800`}><X size={18} /></button></header><ExerciseFilters search={search} status={status} muscle={muscle} sort={sort} muscles={muscles} onParam={onParam} /><div className="min-h-0 flex-1 overflow-y-auto bg-white dark:bg-neutral-900">{filtered.length ? filtered.map((item) => <ExerciseRow key={item.name} exercise={item} selected={item.name === selected.name} onClick={() => choose(item.name)} />) : <p className="p-8 text-center text-sm text-slate-400">No exercises match these filters.</p>}</div></div></dialog>
  </div>;
}
