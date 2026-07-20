import { useMemo, useState, type ComponentType } from 'react';
import { DateTime } from 'luxon';
import { useQueries } from '@tanstack/react-query';
import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Award,
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
  Clock,
  Flame,
  Folder,
  Hourglass,
  Lightbulb,
  Lock,
  Moon,
  Snowflake,
  Sparkles,
  Sun,
  Tag,
  Timer,
  TrendingDown,
  TrendingUp,
  Trophy,
  Zap,
} from 'lucide-react';
import type { DayResultDTO, HabitWeekDay, WeeklyAnalyticsDTO } from '@timeblock/shared';
import {
  useAchievements,
  useAnalyticsWeekly,
  useGamificationSummary,
  useHabits,
  useLearningStats,
  useStreakCalendar,
  useXpHistory,
} from '../hooks.js';
import { api } from './../api';
import { useTheme } from '../hooks/useTheme.js';

// ---------------- formatting helpers ----------------

function fmtMin(min: number): string {
  const m = Math.round(min);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h}h ${rest}m` : `${h}h`;
}

function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

function fmtHour(hour: number): string {
  return DateTime.fromObject({ hour }).toFormat('h a');
}

const REDUCED_MOTION = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Chart series colors — match the app's kind accents (index.css design tokens).
const C = {
  done: '#10b981',
  missed: '#f43f5e',
  external: '#94a3b8',
  planned: '#0d9488',
  xp: '#6366f1',
};

const CARD = 'rounded-xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900';

// ---------------- shared chart chrome ----------------

function useChartTheme() {
  const { resolved } = useTheme();
  const dark = resolved === 'dark';
  return {
    dark,
    grid: dark ? 'rgba(163,163,163,0.14)' : '#eef2f6',
    axis: dark ? '#a3a3a3' : '#64748b',
    cursor: dark ? 'rgba(255,255,255,0.05)' : 'rgba(15,23,42,0.04)',
  };
}

function TooltipShell({ title, rows, footer }: { title: string; rows: { color?: string; label: string; value: string }[]; footer?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
      <p className="mb-1 font-semibold text-slate-900 dark:text-neutral-100">{title}</p>
      <div className="space-y-0.5">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-slate-500 dark:text-neutral-400">
              {r.color && <span className="h-2 w-2 rounded-full" style={{ background: r.color }} />}
              {r.label}
            </span>
            <span className="font-semibold tabular-nums text-slate-800 dark:text-neutral-200">{r.value}</span>
          </div>
        ))}
      </div>
      {footer && <p className="mt-1.5 border-t border-slate-100 pt-1.5 font-medium text-teal-600 dark:border-neutral-800 dark:text-teal-400">{footer}</p>}
    </div>
  );
}

// ---------------- small building blocks ----------------

function DeltaChip({ delta, text, goodWhenUp = true }: { delta: number; text: string; goodWhenUp?: boolean }) {
  if (delta === 0) return null;
  const up = delta > 0;
  const good = goodWhenUp ? up : !up;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
        good
          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400'
          : 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400'
      }`}
      title="vs last week"
    >
      <Icon className="h-3 w-3" />
      {text}
    </span>
  );
}

function ProgressRing({ value }: { value: number }) {
  const clamped = Math.max(0, Math.min(100, value));
  const r = 25;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative h-16 w-16 flex-none">
      <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" strokeWidth="6" className="stroke-slate-100 dark:stroke-neutral-800" />
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={`${(c * clamped) / 100} ${c}`}
          className="stroke-teal-500 transition-all duration-500"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-sm font-bold tabular-nums text-slate-900 dark:text-neutral-100">
        {clamped}%
      </span>
    </div>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  chip,
  ring,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
  chip?: JSX.Element | null;
  ring?: number;
}) {
  return (
    <div className={`${CARD} flex items-center gap-3`}>
      {ring !== undefined ? (
        <ProgressRing value={ring} />
      ) : (
        <div className="flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-slate-50 text-slate-500 dark:bg-neutral-800 dark:text-neutral-400">
          <Icon className="h-5 w-5" />
        </div>
      )}
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-xs text-slate-400 dark:text-neutral-500">
          {label} {chip}
        </p>
        {ring === undefined && <p className="text-xl font-bold tabular-nums leading-tight text-slate-900 dark:text-neutral-100">{value}</p>}
        {ring !== undefined && <p className="text-sm font-semibold leading-tight text-slate-900 dark:text-neutral-100">{value}</p>}
        {sub && <p className="truncate text-[11px] text-slate-400 dark:text-neutral-500">{sub}</p>}
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: string }) {
  return <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-neutral-500">{children}</h2>;
}

function EmptyNote({ children }: { children: string }) {
  return <p className="py-6 text-center text-sm text-slate-400 dark:text-neutral-500">{children}</p>;
}

// ---------------- insight banner ----------------

function buildInsights(weekly: WeeklyAnalyticsDTO, prev: WeeklyAnalyticsDTO | undefined): string[] {
  const out: string[] = [];
  const t = weekly.totals;
  if (t.plannedMin <= 0) return out;
  const rate = pct(t.completedMin, t.plannedMin);
  let s = `You followed through on ${rate}% of the time you planned`;
  if (prev && prev.totals.plannedMin > 0) {
    const prevRate = pct(prev.totals.completedMin, prev.totals.plannedMin);
    const d = rate - prevRate;
    if (d !== 0) s += `, ${d > 0 ? 'up' : 'down'} ${Math.abs(d)} pts from last week`;
  }
  out.push(s + '.');

  const best = [...weekly.days].sort((a, b) => b.completedMin - a.completedMin)[0];
  if (best && best.completedMin > 0) {
    out.push(`${DateTime.fromISO(best.date).toFormat('EEEE')} was your strongest day — ${fmtMin(best.completedMin)} completed.`);
  }

  const projects = Object.entries(weekly.byProject).sort((a, b) => b[1].done - a[1].done);
  if (projects.length && projects[0][1].done > 0 && t.completedMin > 0) {
    const [name, v] = projects[0];
    out.push(`Most of that time went to ${name} (${pct(v.done, t.completedMin)}% of completed work).`);
  }

  const missedRate = pct(t.missedMin, t.plannedMin);
  if (missedRate >= 30) out.push(`Heads up: ${missedRate}% of planned time was missed — consider planning fewer, bigger blocks.`);
  return out;
}

function InsightBanner({ sentences }: { sentences: string[] }) {
  if (!sentences.length) return null;
  return (
    <div className="flex gap-3 rounded-xl border border-teal-200/70 bg-gradient-to-r from-teal-50 to-white p-4 dark:border-teal-500/20 dark:from-teal-500/10 dark:to-transparent">
      <div className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-teal-500/15 text-teal-600 dark:text-teal-400">
        <Lightbulb className="h-5 w-5" />
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-400">This week at a glance</p>
        <p className="mt-0.5 text-sm leading-relaxed text-slate-700 dark:text-neutral-300">{sentences.join(' ')}</p>
      </div>
    </div>
  );
}

// ---------------- daily rhythm chart ----------------

type SeriesKey = 'Completed' | 'Missed' | 'External';
const SERIES: { key: SeriesKey; color: string }[] = [
  { key: 'Completed', color: C.done },
  { key: 'Missed', color: C.missed },
  { key: 'External', color: C.external },
];

function DailyRhythmCard({ weekly }: { weekly: WeeklyAnalyticsDTO }) {
  const theme = useChartTheme();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [showPlanned, setShowPlanned] = useState(true);
  const today = DateTime.now().toISODate()!;

  const data = weekly.days.map((d) => ({
    iso: d.date,
    day: DateTime.fromISO(d.date).toFormat('EEE'),
    Planned: d.plannedMin,
    Completed: d.completedMin,
    Missed: d.missedMin,
    External: d.externalBusyMin,
  }));

  const toggle = (key: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const renderTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const d = data.find((x) => x.day === label);
    if (!d) return null;
    const rows = [
      { color: C.planned, label: 'Planned', value: fmtMin(d.Planned) },
      { color: C.done, label: 'Completed', value: fmtMin(d.Completed) },
      { color: C.missed, label: 'Missed', value: fmtMin(d.Missed) },
      { color: C.external, label: 'External busy', value: fmtMin(d.External) },
    ];
    const footer = d.Planned > 0 ? `Follow-through ${pct(d.Completed, d.Planned)}%` : undefined;
    return <TooltipShell title={DateTime.fromISO(d.iso).toFormat('EEEE, MMM d')} rows={rows} footer={footer} />;
  };

  const dayTick = ({ x, y, payload }: any) => {
    const d = data[payload.index];
    const isToday = d?.iso === today;
    return (
      <text x={x} y={y + 12} textAnchor="middle" fontSize={12} fontWeight={isToday ? 700 : 500} fill={isToday ? C.planned : theme.axis}>
        {payload.value}
      </text>
    );
  };

  return (
    <div className={CARD}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold text-slate-900 dark:text-neutral-100">Daily rhythm</h3>
          <p className="text-xs text-slate-400 dark:text-neutral-500">What you planned vs. what actually happened, day by day</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {SERIES.map((s) => {
            const off = hidden.has(s.key);
            return (
              <button
                key={s.key}
                onClick={() => toggle(s.key)}
                aria-pressed={!off}
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium transition-colors ${
                  off
                    ? 'border-slate-200 text-slate-400 opacity-60 dark:border-neutral-700 dark:text-neutral-500'
                    : 'border-slate-200 bg-slate-50 text-slate-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300'
                }`}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: off ? '#cbd5e1' : s.color }} />
                {s.key}
              </button>
            );
          })}
          <button
            onClick={() => setShowPlanned((v) => !v)}
            aria-pressed={showPlanned}
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium transition-colors ${
              showPlanned
                ? 'border-slate-200 bg-slate-50 text-slate-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300'
                : 'border-slate-200 text-slate-400 opacity-60 dark:border-neutral-700 dark:text-neutral-500'
            }`}
          >
            <span className="h-0.5 w-3 rounded" style={{ background: showPlanned ? C.planned : '#cbd5e1' }} />
            Planned
          </button>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={data} barCategoryGap="28%">
          <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} vertical={false} />
          <XAxis dataKey="day" tick={dayTick} axisLine={false} tickLine={false} />
          <YAxis
            tick={{ fontSize: 11, fill: theme.axis }}
            tickFormatter={(v: number) => `${Math.round(v / 60)}h`}
            axisLine={false}
            tickLine={false}
            width={34}
          />
          <Tooltip content={renderTooltip} cursor={{ fill: theme.cursor }} />
          {!hidden.has('Completed') && (
            <Bar dataKey="Completed" stackId="outcome" fill={C.done} isAnimationActive={!REDUCED_MOTION} animationDuration={400} />
          )}
          {!hidden.has('Missed') && (
            <Bar dataKey="Missed" stackId="outcome" fill={C.missed} radius={[3, 3, 0, 0]} isAnimationActive={!REDUCED_MOTION} animationDuration={400} />
          )}
          {!hidden.has('External') && (
            <Bar dataKey="External" fill={C.external} radius={[3, 3, 0, 0]} fillOpacity={0.55} isAnimationActive={!REDUCED_MOTION} animationDuration={400} />
          )}
          {showPlanned && (
            <Line
              dataKey="Planned"
              stroke={C.planned}
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={{ r: 3, fill: C.planned, strokeWidth: 0 }}
              isAnimationActive={!REDUCED_MOTION}
              animationDuration={400}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------- breakdown (projects / labels) ----------------

function BreakdownCard({
  title,
  subtitle,
  icon: Icon,
  rows,
  accent,
  emptyText,
}: {
  title: string;
  subtitle: string;
  icon: ComponentType<{ className?: string }>;
  rows: [string, { planned: number; done: number }][];
  accent: { bar: string; track: string };
  emptyText: string;
}) {
  const maxPlanned = Math.max(1, ...rows.map(([, v]) => Math.max(v.planned, v.done)));
  return (
    <div className={CARD}>
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-4 w-4 text-slate-400 dark:text-neutral-500" />
        <div>
          <h3 className="font-semibold leading-tight text-slate-900 dark:text-neutral-100">{title}</h3>
          <p className="text-xs text-slate-400 dark:text-neutral-500">{subtitle}</p>
        </div>
      </div>
      {rows.length === 0 ? (
        <EmptyNote>{emptyText}</EmptyNote>
      ) : (
        <ul className="space-y-3">
          {rows.map(([name, v]) => {
            const followThrough = pct(v.done, v.planned);
            const outer = Math.min(100, (Math.max(v.planned, v.done) / maxPlanned) * 100);
            const inner = v.planned > 0 ? Math.min(100, (v.done / Math.max(v.planned, v.done)) * 100) : 100;
            return (
              <li key={name} className="group">
                <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
                  <span className="truncate font-medium text-slate-700 dark:text-neutral-300">{name}</span>
                  <span className="flex-none tabular-nums text-slate-400 dark:text-neutral-500">
                    {fmtMin(v.done)} <span className="opacity-60">/ {fmtMin(v.planned)}</span>
                    {v.planned > 0 && <span className="ml-1.5 font-semibold text-slate-500 dark:text-neutral-400">{followThrough}%</span>}
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-slate-100 transition-colors group-hover:bg-slate-200/70 dark:bg-neutral-800 dark:group-hover:bg-neutral-700/60">
                  <div className={`relative h-full rounded-full ${accent.track}`} style={{ width: `${outer}%` }}>
                    <div className={`absolute inset-y-0 left-0 rounded-full ${accent.bar}`} style={{ width: `${inner}%` }} />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ---------------- 8-week trend ----------------

function TrendCard({ anchorWeekStart }: { anchorWeekStart: string }) {
  const theme = useChartTheme();
  const anchor = DateTime.fromISO(anchorWeekStart);
  const weekStarts = useMemo(
    () => Array.from({ length: 8 }, (_, i) => anchor.minus({ weeks: 7 - i }).toISODate()!),
    [anchorWeekStart],
  );
  const queries = useQueries({
    queries: weekStarts.map((ws) => ({
      queryKey: ['analytics', 'weekly', ws],
      queryFn: () => api.get<WeeklyAnalyticsDTO>(`/analytics/weekly?weekStart=${ws}`),
      staleTime: 5 * 60_000,
    })),
  });

  const points = weekStarts.map((ws, i) => {
    const w = queries[i].data;
    const planned = w?.totals.plannedMin ?? 0;
    return {
      weekStart: ws,
      label: DateTime.fromISO(ws).toFormat('MMM d'),
      rate: planned > 0 ? pct(w!.totals.completedMin, planned) : null,
      focus: w?.totals.completedMin ?? 0,
    };
  });
  const withData = points.filter((p) => p.rate !== null);

  const renderTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const p = points.find((x) => x.label === label);
    if (!p || p.rate === null) return null;
    const end = DateTime.fromISO(p.weekStart).plus({ days: 6 });
    return (
      <TooltipShell
        title={`${DateTime.fromISO(p.weekStart).toFormat('MMM d')} – ${end.toFormat('MMM d')}`}
        rows={[
          { color: C.planned, label: 'Follow-through', value: `${p.rate}%` },
          { color: C.done, label: 'Focus time', value: fmtMin(p.focus) },
        ]}
      />
    );
  };

  return (
    <div className={CARD}>
      <div className="mb-3">
        <h3 className="font-semibold text-slate-900 dark:text-neutral-100">Are you improving?</h3>
        <p className="text-xs text-slate-400 dark:text-neutral-500">Follow-through rate over the last 8 weeks</p>
      </div>
      {withData.length < 2 ? (
        <EmptyNote>Not enough history yet — complete a couple of weeks to see your trend.</EmptyNote>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={points}>
            <defs>
              <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={C.planned} stopOpacity={0.25} />
                <stop offset="100%" stopColor={C.planned} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: theme.axis }} axisLine={false} tickLine={false} />
            <YAxis
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
              tickFormatter={(v: number) => `${v}%`}
              tick={{ fontSize: 11, fill: theme.axis }}
              axisLine={false}
              tickLine={false}
              width={38}
            />
            <Tooltip content={renderTooltip} />
            <ReferenceLine x={points[points.length - 1].label} stroke={theme.grid} strokeDasharray="4 3" />
            <Area
              type="monotone"
              dataKey="rate"
              stroke={C.planned}
              strokeWidth={2}
              fill="url(#trendFill)"
              connectNulls={false}
              dot={{ r: 3, fill: C.planned, strokeWidth: 0 }}
              activeDot={{ r: 5 }}
              isAnimationActive={!REDUCED_MOTION}
              animationDuration={400}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// ---------------- peak hours / rhythm insights ----------------

function PeakHoursCard({ weekly }: { weekly: WeeklyAnalyticsDTO | undefined }) {
  const { data: stats } = useLearningStats();

  const bestDay = weekly ? [...weekly.days].filter((d) => d.completedMin > 0).sort((a, b) => b.completedMin - a.completedMin)[0] : undefined;
  const toughDay = weekly ? [...weekly.days].filter((d) => d.missedMin > 0).sort((a, b) => b.missedMin - a.missedMin)[0] : undefined;
  const hasHours = !!stats && stats.enabled && stats.hourWeight > 0 && (stats.bestHours.length > 0 || stats.worstHours.length > 0);

  return (
    <div className={CARD}>
      <div className="mb-3">
        <h3 className="font-semibold text-slate-900 dark:text-neutral-100">Know your rhythm</h3>
        <p className="text-xs text-slate-400 dark:text-neutral-500">When you actually get things done</p>
      </div>
      <div className="space-y-4">
        {(bestDay || toughDay) && (
          <div className="grid grid-cols-2 gap-3">
            {bestDay && (
              <div className="rounded-lg bg-emerald-50 p-3 dark:bg-emerald-500/10">
                <p className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400">Strongest day this week</p>
                <p className="mt-0.5 text-sm font-bold text-slate-900 dark:text-neutral-100">{DateTime.fromISO(bestDay.date).toFormat('EEEE')}</p>
                <p className="text-[11px] tabular-nums text-emerald-700/80 dark:text-emerald-400/80">{fmtMin(bestDay.completedMin)} completed</p>
              </div>
            )}
            {toughDay && (
              <div className="rounded-lg bg-rose-50 p-3 dark:bg-rose-500/10">
                <p className="text-[11px] font-medium text-rose-700 dark:text-rose-400">Toughest day this week</p>
                <p className="mt-0.5 text-sm font-bold text-slate-900 dark:text-neutral-100">{DateTime.fromISO(toughDay.date).toFormat('EEEE')}</p>
                <p className="text-[11px] tabular-nums text-rose-700/80 dark:text-rose-400/80">{fmtMin(toughDay.missedMin)} missed</p>
              </div>
            )}
          </div>
        )}
        {hasHours ? (
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="flex items-center gap-1 text-xs font-medium text-slate-500 dark:text-neutral-400">
                <Sun className="h-3.5 w-3.5 text-amber-500" /> Best hours
              </span>
              {stats!.bestHours.map((h) => (
                <span
                  key={h.hour}
                  className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"
                >
                  {fmtHour(h.hour)} · {Math.round(h.rate * 100)}%
                </span>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="flex items-center gap-1 text-xs font-medium text-slate-500 dark:text-neutral-400">
                <Moon className="h-3.5 w-3.5 text-indigo-400" /> Risky hours
              </span>
              {stats!.worstHours.map((h) => (
                <span
                  key={h.hour}
                  className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-rose-700 dark:bg-rose-500/10 dark:text-rose-400"
                >
                  {fmtHour(h.hour)} · {Math.round(h.rate * 100)}%
                </span>
              ))}
            </div>
            <p className="text-[11px] leading-relaxed text-slate-400 dark:text-neutral-500">
              Success rate of blocks scheduled at each hour, learned from your whole history. Schedule deep work in your best hours.
            </p>
          </div>
        ) : (
          <p className="text-xs leading-relaxed text-slate-400 dark:text-neutral-500">
            TimeBlock is still learning your hourly patterns — keep completing scheduled blocks and your best hours will show up here.
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------- habits ----------------

const HABIT_DOT: Record<HabitWeekDay['status'], string> = {
  done: 'bg-emerald-500',
  missed: 'bg-rose-400',
  skipped: 'bg-sky-400',
  pending: 'border-2 border-teal-500 bg-transparent',
  upcoming: 'bg-slate-200 dark:bg-neutral-700',
  off: 'bg-slate-100 dark:bg-neutral-800/70',
};

function HabitsCard() {
  const { data: habits } = useHabits();
  return (
    <div className={CARD}>
      <div className="mb-3">
        <h3 className="font-semibold text-slate-900 dark:text-neutral-100">Habit consistency</h3>
        <p className="text-xs text-slate-400 dark:text-neutral-500">This week, day by day</p>
      </div>
      {!habits?.length ? (
        <EmptyNote>No habits yet — create one to start building streaks.</EmptyNote>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-neutral-800">
          {habits.map((h) => {
            const weekPct = pct(h.weekDoneMin, h.weekPlannedMin);
            return (
              <li key={h.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-700 dark:text-neutral-300">{h.name}</p>
                  {h.weekPlannedMin > 0 && (
                    <p className="text-[11px] tabular-nums text-slate-400 dark:text-neutral-500">
                      {fmtMin(h.weekDoneMin)} of {fmtMin(h.weekPlannedMin)} · {weekPct}%
                    </p>
                  )}
                </div>
                <div className="flex flex-none items-center gap-1" aria-label={`${h.name} week history`}>
                  {h.weekHistory.map((d) => (
                    <span
                      key={d.date}
                      title={`${DateTime.fromISO(d.date).toFormat('EEE MMM d')} · ${d.status}`}
                      className={`h-3 w-3 rounded-[4px] ${HABIT_DOT[d.status]}`}
                    />
                  ))}
                </div>
                <span
                  className={`flex w-14 flex-none items-center justify-end gap-1 text-sm font-semibold tabular-nums ${
                    h.streakDays > 0 ? 'text-orange-500' : 'text-slate-300 dark:text-neutral-600'
                  }`}
                  title={`${h.streakDays}-day streak`}
                >
                  <Flame className="h-4 w-4" />
                  {h.streakDays}d
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ---------------- gamification ----------------

const DAY_RESULT_COLOR: Record<DayResultDTO['result'], string> = {
  met: 'bg-emerald-500',
  freeze: 'bg-sky-400',
  missed: 'bg-rose-400',
  rest: 'bg-slate-200 dark:bg-neutral-700',
};

function ConsistencyHeatmap() {
  const { data: days } = useStreakCalendar(16);
  if (!days?.length) return <EmptyNote>No history yet — your daily results will appear here.</EmptyNote>;
  const byDate = new Map(days.map((d) => [d.date, d]));
  const start = DateTime.fromISO(days[0].date).startOf('week');
  const end = DateTime.fromISO(days[days.length - 1].date).endOf('week');
  const weeks: DateTime[] = [];
  for (let cursor = start; cursor <= end; cursor = cursor.plus({ weeks: 1 })) weeks.push(cursor);
  const today = DateTime.now().toISODate()!;

  return (
    <div>
      <div className="flex gap-1 overflow-x-auto pb-1">
        <div className="mr-1 flex flex-col gap-1 pt-5 text-[9px] leading-3 text-slate-400 dark:text-neutral-500">
          {['Mon', '', 'Wed', '', 'Fri', '', ''].map((l, i) => (
            <span key={i} className="h-3">
              {l}
            </span>
          ))}
        </div>
        {weeks.map((monday, i) => {
          const prev = weeks[i - 1];
          const showMonth = !prev || prev.month !== monday.month;
          return (
            <div key={monday.toISODate()} className="flex flex-col gap-1">
              <span className="h-4 text-[9px] text-slate-400 dark:text-neutral-500">{showMonth ? monday.toFormat('MMM') : ''}</span>
              {Array.from({ length: 7 }, (_, di) => {
                const d = monday.plus({ days: di });
                const iso = d.toISODate()!;
                const r = byDate.get(iso);
                return (
                  <span
                    key={iso}
                    title={r ? `${d.toFormat('EEE MMM d')} · ${r.result} (${r.doneCount}/${r.plannedCount} done)` : d.toFormat('EEE MMM d')}
                    className={`h-3 w-3 rounded-[3px] ${r ? DAY_RESULT_COLOR[r.result] : 'bg-slate-50 dark:bg-neutral-800/40'} ${
                      iso === today ? 'ring-1 ring-teal-500 ring-offset-1 ring-offset-white dark:ring-offset-neutral-900' : ''
                    }`}
                  />
                );
              })}
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-slate-400 dark:text-neutral-500">
        {(
          [
            ['met', 'Goal met'],
            ['freeze', 'Freeze used'],
            ['missed', 'Missed'],
            ['rest', 'Rest day'],
          ] as const
        ).map(([k, label]) => (
          <span key={k} className="flex items-center gap-1">
            <span className={`h-2.5 w-2.5 rounded-[3px] ${DAY_RESULT_COLOR[k]}`} /> {label}
          </span>
        ))}
      </div>
    </div>
  );
}

function XpCard() {
  const theme = useChartTheme();
  const [range, setRange] = useState(30);
  const { data: xpHistory } = useXpHistory(range);

  const renderTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <TooltipShell
        title={DateTime.fromISO(label).toFormat('EEE, MMM d')}
        rows={[{ color: C.xp, label: 'XP earned', value: `${payload[0].value}` }]}
      />
    );
  };

  return (
    <div className={CARD}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold text-slate-900 dark:text-neutral-100">XP earned</h3>
          <p className="text-xs text-slate-400 dark:text-neutral-500">Daily experience from completed work</p>
        </div>
        <div className="flex rounded-lg border border-slate-200 p-0.5 text-xs dark:border-neutral-700">
          {[30, 60, 90].map((d) => (
            <button
              key={d}
              onClick={() => setRange(d)}
              aria-pressed={range === d}
              className={`rounded-md px-2 py-1 font-medium transition-colors ${
                range === d
                  ? 'bg-slate-100 text-slate-900 dark:bg-neutral-800 dark:text-neutral-100'
                  : 'text-slate-400 hover:text-slate-600 dark:text-neutral-500 dark:hover:text-neutral-300'
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={180}>
        <AreaChart data={xpHistory ?? []}>
          <defs>
            <linearGradient id="xpFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={C.xp} stopOpacity={0.3} />
              <stop offset="100%" stopColor={C.xp} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10, fill: theme.axis }}
            tickFormatter={(d: string) => DateTime.fromISO(d).toFormat('MMM d')}
            axisLine={false}
            tickLine={false}
            minTickGap={28}
          />
          <YAxis tick={{ fontSize: 11, fill: theme.axis }} axisLine={false} tickLine={false} width={34} />
          <Tooltip content={renderTooltip} />
          <Area
            type="monotone"
            dataKey="xp"
            stroke={C.xp}
            strokeWidth={2}
            fill="url(#xpFill)"
            isAnimationActive={!REDUCED_MOTION}
            animationDuration={400}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function ProgressStats() {
  const { data: g } = useGamificationSummary();
  if (!g?.enabled) return null;
  const xpPct = pct(g.xpIntoLevel, g.xpForNextLevel);
  return (
    <div className={CARD}>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50 text-amber-500 dark:bg-amber-500/10">
            <Trophy className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs text-slate-400 dark:text-neutral-500">Level</p>
            <p className="text-xl font-bold tabular-nums leading-tight text-slate-900 dark:text-neutral-100">{g.level}</p>
          </div>
        </div>
        <div className="min-w-40 flex-1">
          <div className="mb-1 flex justify-between text-[11px] tabular-nums text-slate-400 dark:text-neutral-500">
            <span>
              {g.xpIntoLevel.toLocaleString()} / {g.xpForNextLevel.toLocaleString()} XP to level {g.level + 1}
            </span>
            <span className="flex items-center gap-1 font-medium text-indigo-500 dark:text-indigo-400">
              <Zap className="h-3 w-3" /> {g.totalXp.toLocaleString()} total
            </span>
          </div>
          <div className="tb-xpbar h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-neutral-800">
            <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-teal-400" style={{ width: `${xpPct}%` }} />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-50 text-orange-500 dark:bg-orange-500/10">
            <Flame className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs text-slate-400 dark:text-neutral-500">Streak</p>
            <p className="text-xl font-bold tabular-nums leading-tight text-slate-900 dark:text-neutral-100">
              {g.streak.current}d <span className="text-xs font-medium text-slate-400 dark:text-neutral-500">best {g.streak.longest}d</span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2" title="Streak freezes protect your streak on a missed day">
          <Snowflake className="h-4 w-4 text-sky-400" />
          <span className="text-sm font-semibold tabular-nums text-slate-700 dark:text-neutral-300">{g.streak.freezes}</span>
          <span className="text-xs text-slate-400 dark:text-neutral-500">freezes</span>
        </div>
      </div>
    </div>
  );
}

function AchievementsCard() {
  const { data: achievements } = useAchievements();
  if (!achievements?.length) return null;
  const unlocked = achievements.filter((a) => a.unlockedAt).length;
  return (
    <div className={CARD}>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Award className="h-4 w-4 text-slate-400 dark:text-neutral-500" />
          <h3 className="font-semibold text-slate-900 dark:text-neutral-100">Achievements</h3>
        </div>
        <span className="text-xs font-medium tabular-nums text-slate-400 dark:text-neutral-500">
          {unlocked} of {achievements.length} unlocked
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {achievements.map((a) => {
          const isUnlocked = !!a.unlockedAt;
          return (
            <div
              key={a.id}
              title={isUnlocked ? `Unlocked ${DateTime.fromISO(a.unlockedAt!).toFormat('MMM d, yyyy')}` : 'Locked'}
              className={`relative flex items-start gap-2.5 rounded-lg border p-3 transition-colors ${
                isUnlocked
                  ? 'border-slate-200 bg-white hover:border-teal-200 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-teal-500/30'
                  : 'border-slate-100 bg-slate-50 opacity-60 grayscale dark:border-neutral-800 dark:bg-neutral-800/40'
              }`}
            >
              <span className="text-xl leading-none">{a.icon}</span>
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-slate-700 dark:text-neutral-300">{a.name}</p>
                <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-slate-400 dark:text-neutral-500">{a.description}</p>
                <p className="mt-1 text-[10px] font-semibold tabular-nums text-indigo-500 dark:text-indigo-400">+{a.xp} XP</p>
              </div>
              {!isUnlocked && <Lock className="absolute right-2 top-2 h-3 w-3 text-slate-400 dark:text-neutral-500" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------- loading skeleton ----------------

function Skeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-24 rounded-xl bg-slate-100 dark:bg-neutral-800/60" />
        ))}
      </div>
      <div className="h-80 rounded-xl bg-slate-100 dark:bg-neutral-800/60" />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="h-56 rounded-xl bg-slate-100 dark:bg-neutral-800/60" />
        <div className="h-56 rounded-xl bg-slate-100 dark:bg-neutral-800/60" />
      </div>
    </div>
  );
}

// ---------------- page ----------------

export default function AnalyticsPage() {
  const [weekStart, setWeekStart] = useState(() => DateTime.now().startOf('week').toISODate()!);
  const currentWeekStart = DateTime.now().startOf('week').toISODate()!;
  const isCurrentWeek = weekStart === currentWeekStart;
  const prevWeekStart = DateTime.fromISO(weekStart).minus({ weeks: 1 }).toISODate()!;

  const { data: weekly, isLoading } = useAnalyticsWeekly(weekStart);
  const { data: prevWeekly } = useAnalyticsWeekly(prevWeekStart);
  const { data: gamification } = useGamificationSummary();

  const weekEnd = DateTime.fromISO(weekStart).plus({ days: 6 });
  const weekLabel = `${DateTime.fromISO(weekStart).toFormat('MMM d')} – ${weekEnd.toFormat(
    weekEnd.month === DateTime.fromISO(weekStart).month ? 'd' : 'MMM d',
  )}`;

  const t = weekly?.totals;
  const p = prevWeekly?.totals;
  const rate = t ? pct(t.completedMin, t.plannedMin) : 0;
  const prevRate = p && p.plannedMin > 0 ? pct(p.completedMin, p.plannedMin) : null;
  const hasData = !!t && (t.plannedMin > 0 || t.completedMin > 0 || t.externalBusyMin > 0);

  const byLabel = useMemo(() => {
    const acc: Record<string, { planned: number; done: number }> = {};
    for (const d of weekly?.days ?? []) {
      for (const [k, v] of Object.entries(d.byLabel)) {
        if (!acc[k]) acc[k] = { planned: 0, done: 0 };
        acc[k].planned += v.planned;
        acc[k].done += v.done;
      }
    }
    return Object.entries(acc).sort((a, b) => b[1].planned - a[1].planned);
  }, [weekly]);

  const projectRows = useMemo(
    () => Object.entries(weekly?.byProject ?? {}).sort((a, b) => b[1].planned - a[1].planned),
    [weekly],
  );

  const insights = weekly ? buildInsights(weekly, prevWeekly) : [];

  const navBtn =
    'flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40 dark:border-neutral-800 dark:text-neutral-400 dark:hover:bg-white/5 dark:hover:text-neutral-200';

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-neutral-100">Analytics</h1>
          <p className="text-xs text-slate-400 dark:text-neutral-500">Understand where your time really goes</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setWeekStart(DateTime.fromISO(weekStart).minus({ weeks: 1 }).toISODate()!)} className={navBtn} aria-label="Previous week">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-28 text-center text-sm font-medium tabular-nums text-slate-700 dark:text-neutral-300">{weekLabel}</span>
          <button
            onClick={() => setWeekStart(DateTime.fromISO(weekStart).plus({ weeks: 1 }).toISODate()!)}
            className={navBtn}
            aria-label="Next week"
            disabled={isCurrentWeek}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          {!isCurrentWeek && (
            <button
              onClick={() => setWeekStart(currentWeekStart)}
              className="rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-xs font-semibold text-teal-700 transition-colors hover:bg-teal-100 dark:border-teal-500/30 dark:bg-teal-500/10 dark:text-teal-400 dark:hover:bg-teal-500/20"
            >
              This week
            </button>
          )}
        </div>
      </div>

      {isLoading ? (
        <Skeleton />
      ) : !weekly ? null : (
        <>
          {hasData ? (
            <InsightBanner sentences={insights} />
          ) : (
            <div className={`${CARD} flex items-center gap-3`}>
              <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-slate-50 text-slate-400 dark:bg-neutral-800 dark:text-neutral-500">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-700 dark:text-neutral-300">Nothing tracked this week yet</p>
                <p className="text-xs text-slate-400 dark:text-neutral-500">Plan and complete time blocks and your analytics will light up here.</p>
              </div>
            </div>
          )}

          <SectionLabel>This week</SectionLabel>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard
              icon={CalendarCheck}
              label="Follow-through"
              ring={rate}
              value={t!.plannedMin > 0 ? `${fmtMin(t!.completedMin)} of ${fmtMin(t!.plannedMin)}` : 'Nothing planned'}
              chip={prevRate !== null && rate !== prevRate ? <DeltaChip delta={rate - prevRate} text={`${Math.abs(rate - prevRate)} pts`} /> : null}
            />
            <KpiCard
              icon={Timer}
              label="Focus time"
              value={fmtMin(t!.completedMin)}
              sub="completed"
              chip={
                p && p.completedMin !== t!.completedMin ? (
                  <DeltaChip delta={t!.completedMin - p.completedMin} text={fmtMin(Math.abs(t!.completedMin - p.completedMin))} />
                ) : null
              }
            />
            <KpiCard
              icon={Hourglass}
              label="Missed"
              value={fmtMin(t!.missedMin)}
              sub={t!.plannedMin > 0 ? `${pct(t!.missedMin, t!.plannedMin)}% of planned` : undefined}
              chip={
                p && p.missedMin !== t!.missedMin ? (
                  <DeltaChip delta={t!.missedMin - p.missedMin} text={fmtMin(Math.abs(t!.missedMin - p.missedMin))} goodWhenUp={false} />
                ) : null
              }
            />
            <KpiCard icon={Clock} label="External busy" value={fmtMin(t!.externalBusyMin)} sub="meetings & calendar events" />
          </div>

          <DailyRhythmCard weekly={weekly} />

          <SectionLabel>Where your time goes</SectionLabel>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <BreakdownCard
              title="By project"
              subtitle="Completed vs planned time"
              icon={Folder}
              rows={projectRows}
              accent={{ bar: 'bg-teal-500', track: 'bg-teal-500/25' }}
              emptyText="No project time this week."
            />
            <BreakdownCard
              title="By label"
              subtitle="Completed vs planned time"
              icon={Tag}
              rows={byLabel}
              accent={{ bar: 'bg-indigo-500', track: 'bg-indigo-500/25' }}
              emptyText="No labelled time this week."
            />
          </div>

          <SectionLabel>Patterns</SectionLabel>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TrendCard anchorWeekStart={weekStart} />
            <PeakHoursCard weekly={weekly} />
          </div>

          <HabitsCard />

          {gamification?.enabled && (
            <>
              <SectionLabel>Progress & rewards</SectionLabel>
              <ProgressStats />
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <XpCard />
                <div className={CARD}>
                  <div className="mb-3">
                    <h3 className="font-semibold text-slate-900 dark:text-neutral-100">Consistency map</h3>
                    <p className="text-xs text-slate-400 dark:text-neutral-500">Your last 16 weeks, one square per day</p>
                  </div>
                  <ConsistencyHeatmap />
                </div>
              </div>
              <AchievementsCard />
            </>
          )}
        </>
      )}
    </div>
  );
}
