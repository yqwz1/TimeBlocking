import type { ActivityClassification, ActivityTimelineSegment } from '@timeblock/shared';
import { DateTime } from 'luxon';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Clock3,
  Eye,
  FlaskConical,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Target,
  WifiOff,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  useActivityCenterOverview,
  useActivityCenterTimeline,
  useActivityStatus,
  useCreateActivityExperiment,
  useSyncActivity,
} from '../hooks.js';

const CLASSIFICATION_META: Record<ActivityClassification, { label: string; color: string }> = {
  relevant: { label: 'Focused', color: '#0f9f8a' },
  supporting: { label: 'Supporting', color: '#38bdf8' },
  neutral: { label: 'Neutral', color: '#64748b' },
  distraction: { label: 'Distracting', color: '#f9735b' },
  unknown: { label: 'Unknown', color: '#a1a1aa' },
  sensitive: { label: 'Private', color: '#d4d4d8' },
  ignore: { label: 'Ignored', color: '#d4d4d8' },
};

const DISPLAY_CLASSIFICATIONS: ActivityClassification[] = ['relevant', 'supporting', 'distraction', 'unknown'];
type RangeDays = 7 | 30;

function formatMinutes(value: number) {
  const minutes = Math.round(value);
  if (minutes < 60) return `${minutes}m`;
  const remainder = minutes % 60;
  return `${Math.floor(minutes / 60)}h${remainder ? ` ${remainder}m` : ''}`;
}

function segmentMinutes(segment: ActivityTimelineSegment) {
  return Math.max(0, (Date.parse(segment.endUtc) - Date.parse(segment.startUtc)) / 60_000);
}

function segmentLabel(segment: ActivityTimelineSegment) {
  return segment.domain ?? segment.application ?? segment.category ?? 'Unclassified activity';
}

function localDay(iso: string) {
  return DateTime.fromISO(iso).toLocal().toFormat('yyyy-MM-dd');
}

function localHour(iso: string) {
  return DateTime.fromISO(iso).toLocal().hour;
}

function Panel({ children, className = '', id }: { children: React.ReactNode; className?: string; id?: string }) {
  return <section id={id} className={`rounded-[1.35rem] border border-slate-200/90 bg-white/90 shadow-[0_18px_55px_-40px_rgba(15,23,42,.45)] backdrop-blur-sm dark:border-neutral-800 dark:bg-neutral-900/90 ${className}`}>{children}</section>;
}

function SectionHeading({ eyebrow, title, detail, action }: { eyebrow: string; title: string; detail: string; action?: React.ReactNode }) {
  return <div className="flex flex-wrap items-end justify-between gap-3">
    <div>
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-teal-700 dark:text-teal-300">{eyebrow}</p>
      <h2 className="mt-1 font-['Iowan_Old_Style',Baskerville,Georgia,serif] text-2xl font-semibold tracking-[-0.025em] text-slate-950 dark:text-neutral-50">{title}</h2>
      <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500 dark:text-neutral-400">{detail}</p>
    </div>
    {action}
  </div>;
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return <div className="min-w-40 rounded-xl border border-slate-200 bg-white/95 p-3 text-xs shadow-xl backdrop-blur dark:border-neutral-700 dark:bg-neutral-900/95">
    {label && <p className="mb-2 font-semibold text-slate-800 dark:text-neutral-100">{label}</p>}
    <div className="space-y-1.5">{payload.filter((item) => item.value > 0).map((item) => <div key={item.name} className="flex items-center justify-between gap-5"><span className="flex items-center gap-1.5 text-slate-500 dark:text-neutral-400"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />{CLASSIFICATION_META[item.name as ActivityClassification]?.label ?? item.name}</span><strong className="tabular-nums text-slate-800 dark:text-neutral-100">{formatMinutes(item.value)}</strong></div>)}</div>
  </div>;
}

function Skeleton() {
  return <div className="space-y-4" aria-label="Loading activity dashboard">
    <div className="h-52 animate-pulse rounded-[1.5rem] bg-slate-100 dark:bg-neutral-800" />
    <div className="grid gap-4 lg:grid-cols-[1.6fr_.8fr]"><div className="h-96 animate-pulse rounded-[1.5rem] bg-slate-100 dark:bg-neutral-800" /><div className="h-96 animate-pulse rounded-[1.5rem] bg-slate-100 dark:bg-neutral-800" /></div>
  </div>;
}

export default function ActivityCenterPage() {
  const [rangeDays, setRangeDays] = useState<RangeDays>(7);
  const [selectedClassification, setSelectedClassification] = useState<ActivityClassification | 'all'>('all');
  const [selectedDay, setSelectedDay] = useState(() => DateTime.local().toFormat('yyyy-MM-dd'));

  // Keep the clock anchor stable. Only an intentional range change should alter
  // these query keys; recalculating "now" on every render causes a fetch loop.
  const anchor = useMemo(() => DateTime.now(), []);
  const { from, to } = useMemo(() => ({
    from: anchor.minus({ days: rangeDays - 1 }).startOf('day').toUTC().toISO()!,
    to: anchor.endOf('day').toUTC().toISO()!,
  }), [anchor, rangeDays]);

  const overview = useActivityCenterOverview(from, to);
  const timeline = useActivityCenterTimeline(from, to);
  const status = useActivityStatus();
  const sync = useSyncActivity();
  const createExperiment = useCreateActivityExperiment();
  const data = overview.data;
  const timelineData = timeline.data ?? [];

  const dailyTrend = useMemo(() => {
    const days = Array.from({ length: rangeDays }, (_, index) => anchor.minus({ days: rangeDays - index - 1 }));
    const rows = new Map(days.map((day) => [day.toFormat('yyyy-MM-dd'), {
      day: day.toFormat('yyyy-MM-dd'),
      label: day.toFormat(rangeDays === 7 ? 'ccc' : 'MMM d'),
      relevant: 0,
      supporting: 0,
      distraction: 0,
      unknown: 0,
    }]));
    for (const segment of timelineData) {
      const row = rows.get(localDay(segment.startUtc));
      if (!row) continue;
      switch (segment.classification) {
        case 'relevant':
        case 'supporting':
        case 'distraction':
        case 'unknown':
          row[segment.classification] += segmentMinutes(segment);
          break;
      }
    }
    return [...rows.values()];
  }, [anchor, rangeDays, timelineData]);

  const activityMix = useMemo(() => {
    if (!data) return [];
    return [
      { classification: 'relevant' as const, value: data.totals.relevantMinutes },
      { classification: 'supporting' as const, value: data.totals.supportingMinutes },
      { classification: 'distraction' as const, value: data.totals.distractionMinutes },
      { classification: 'unknown' as const, value: data.totals.unknownMinutes },
    ].filter((item) => item.value > 0);
  }, [data]);

  const hourlyRhythm = useMemo(() => {
    const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, label: DateTime.local().set({ hour }).toFormat('ha').toLowerCase(), focus: 0, distraction: 0 }));
    for (const segment of timelineData) {
      const row = hours[localHour(segment.startUtc)];
      if (segment.classification === 'relevant' || segment.classification === 'supporting') row.focus += segmentMinutes(segment);
      if (segment.classification === 'distraction') row.distraction += segmentMinutes(segment);
    }
    return hours;
  }, [timelineData]);

  const selectedSegments = useMemo(() => timelineData
    .filter((segment) => localDay(segment.startUtc) === selectedDay)
    .filter((segment) => selectedClassification === 'all' || segment.classification === selectedClassification)
    .sort((a, b) => Date.parse(a.startUtc) - Date.parse(b.startUtc)), [selectedClassification, selectedDay, timelineData]);

  const selectedDayTotals = useMemo(() => selectedSegments.reduce((sum, segment) => sum + segmentMinutes(segment), 0), [selectedSegments]);
  const suggestion = data?.insights[0];
  const coverageGap = data ? Math.max(0, 100 - data.confidenceInputs.classificationCoverage) : 0;

  const verdict = useMemo(() => {
    if (!data || data.totals.observedMinutes === 0) return { eyebrow: 'Waiting for a signal', title: 'Sync activity to see where your workday went.', detail: 'The dashboard becomes useful after locally sanitized observations are available.', icon: WifiOff, tone: 'text-slate-300' };
    if (data.score === null) return { eyebrow: 'First thing to fix', title: `${Math.round(coverageGap)}% of observed time still needs context.`, detail: 'Classification coverage is the bottleneck. Unknown time lowers confidence, but never lowers your score.', icon: CircleHelp, tone: 'text-amber-300' };
    if (data.totals.distractionMinutes > data.totals.alignedMinutes * 0.35) return { eyebrow: 'Your clearest signal', title: `${formatMinutes(data.totals.distractionMinutes)} drifted away from the plan.`, detail: 'Use the day chart below to find when the drift clusters, then test one change for a week.', icon: Target, tone: 'text-orange-300' };
    return { eyebrow: 'Your clearest signal', title: `${Math.round(data.score)}% alignment across the last ${rangeDays} days.`, detail: `${formatMinutes(data.totals.alignedMinutes)} of observed work supported what you intended to do.`, icon: CheckCircle2, tone: 'text-teal-300' };
  }, [coverageGap, data, rangeDays]);

  const runExperiment = () => {
    if (!suggestion) return;
    createExperiment.mutate({
      kind: 'focus_window',
      title: 'Protect one focus window',
      detail: 'Try the suggested focus-window change for three comparable sessions, then compare it with the preceding five sessions.',
      endsAtUtc: DateTime.now().plus({ days: 7 }).toUTC().toISO()!,
    });
  };

  const toggleClassification = (classification: ActivityClassification) => {
    setSelectedClassification((current) => current === classification ? 'all' : classification);
  };

  return <motion.main initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28 }} className="relative mx-auto max-w-[88rem] space-y-5 pb-8">
    <div className="pointer-events-none absolute -left-20 -top-24 -z-10 h-80 w-80 rounded-full bg-teal-200/20 blur-3xl dark:bg-teal-800/10" />

    <header className="flex flex-wrap items-start justify-between gap-4 px-1">
      <div>
        <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-teal-700 dark:text-teal-300"><Activity size={14} /> Activity intelligence</p>
        <h1 className="mt-1 font-['Iowan_Old_Style',Baskerville,Georgia,serif] text-4xl font-semibold tracking-[-0.045em] text-slate-950 dark:text-neutral-50 sm:text-5xl">See the shape of your work.</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500 dark:text-neutral-400">A readable comparison of what you planned, what was observed, and the one signal worth acting on next.</p>
      </div>
      <div className="flex items-center gap-2">
        <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm dark:border-neutral-800 dark:bg-neutral-900" aria-label="Activity date range">
          {([7, 30] as RangeDays[]).map((days) => <button key={days} type="button" aria-pressed={rangeDays === days} onClick={() => setRangeDays(days)} className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${rangeDays === days ? 'bg-slate-900 text-white shadow-sm dark:bg-neutral-100 dark:text-neutral-900' : 'text-slate-500 hover:text-slate-900 dark:text-neutral-400 dark:hover:text-neutral-100'}`}>{days} days</button>)}
        </div>
        <button type="button" onClick={() => sync.mutate()} disabled={sync.isPending || status.data?.mode === 'off'} className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 shadow-sm transition hover:border-teal-300 hover:text-teal-700 disabled:cursor-not-allowed disabled:opacity-45 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:border-teal-700 dark:hover:text-teal-300">
          {sync.isPending ? <LoaderCircle size={14} className="animate-spin" /> : <RefreshCw size={14} />}{sync.isPending ? 'Syncing' : 'Sync'}
        </button>
      </div>
    </header>

    {overview.isLoading || timeline.isLoading ? <Skeleton /> : overview.isError || timeline.isError ? <Panel className="p-6"><AlertTriangle className="text-orange-500" size={20} /><h2 className="mt-3 font-semibold text-slate-900 dark:text-neutral-100">Activity data could not be loaded.</h2><p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">The existing data is unchanged. Check the local server, then try Sync again.</p></Panel> : !data ? <Panel className="p-6"><WifiOff className="text-amber-500" size={20} /><h2 className="mt-3 font-semibold text-slate-900 dark:text-neutral-100">No local activity evidence yet.</h2><p className="mt-1 max-w-xl text-sm text-slate-500 dark:text-neutral-400">Connect ActivityWatch in Settings, choose Shadow or Advisory mode, then sync. Nothing here completes tasks or changes your calendar.</p><Link to="/settings" className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-teal-700 dark:text-teal-300">Open ActivityWatch settings <ArrowRight size={15} /></Link></Panel> : <>
      <Panel className="relative overflow-hidden bg-slate-950 text-white dark:border-neutral-700 dark:bg-neutral-950">
        <div className="pointer-events-none absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(255,255,255,.07)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.07)_1px,transparent_1px)] [background-size:28px_28px]" />
        <div className="relative grid gap-6 p-5 sm:p-7 lg:grid-cols-[1.45fr_.85fr] lg:items-end">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-teal-300">{verdict.eyebrow}</p>
            <div className="mt-3 flex items-start gap-3"><verdict.icon className={`mt-1 shrink-0 ${verdict.tone}`} size={24} /><div><h2 className="max-w-3xl font-['Iowan_Old_Style',Baskerville,Georgia,serif] text-3xl font-semibold leading-tight tracking-[-0.035em] sm:text-4xl">{verdict.title}</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">{verdict.detail}</p></div></div>
          </div>
          <div className="grid grid-cols-3 divide-x divide-white/10 rounded-2xl border border-white/10 bg-white/[0.055] p-3 backdrop-blur">
            <div className="px-2"><p className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">Aligned</p><p className="mt-1 text-lg font-semibold tabular-nums">{formatMinutes(data.totals.alignedMinutes)}</p></div>
            <div className="px-3"><p className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">Observed</p><p className="mt-1 text-lg font-semibold tabular-nums">{formatMinutes(data.totals.observedMinutes)}</p></div>
            <div className="px-3"><p className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">Confidence</p><p className="mt-1 text-lg font-semibold tabular-nums">{Math.round(data.confidence)}%</p></div>
          </div>
        </div>
      </Panel>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(19rem,.7fr)]">
        <Panel id="trend" className="min-w-0 p-5 sm:p-6">
          <SectionHeading eyebrow="01 / The week" title="When did your plan hold?" detail="Each column is one day. Click a day to inspect it; click a color to isolate that kind of activity." />
          <div className="mt-5 flex flex-wrap gap-2" aria-label="Filter activity categories">
            {DISPLAY_CLASSIFICATIONS.map((classification) => <button key={classification} type="button" aria-pressed={selectedClassification === classification} onClick={() => toggleClassification(classification)} className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${selectedClassification === classification ? 'border-slate-900 bg-slate-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900' : 'border-slate-200 text-slate-500 hover:border-slate-400 dark:border-neutral-800 dark:text-neutral-400 dark:hover:border-neutral-600'}`}><span className="h-2 w-2 rounded-full" style={{ backgroundColor: CLASSIFICATION_META[classification].color }} />{CLASSIFICATION_META[classification].label}</button>)}
            {selectedClassification !== 'all' && <button type="button" onClick={() => setSelectedClassification('all')} className="px-2 text-[11px] font-semibold text-teal-700 hover:underline dark:text-teal-300">Show all</button>}
          </div>
          <div className="mt-3 h-[21rem]" role="img" aria-label={`Stacked activity trend for the last ${rangeDays} days`}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dailyTrend} margin={{ top: 18, right: 4, bottom: 0, left: -20 }} onClick={(state) => { if (state?.activePayload?.[0]?.payload) setSelectedDay(String((state.activePayload[0].payload as { day: string }).day)); }}>
                <CartesianGrid vertical={false} stroke="currentColor" className="text-slate-100 dark:text-neutral-800" />
                <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8' }} interval={rangeDays === 30 ? 4 : 0} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={(value) => `${Math.round(value / 60)}h`} />
                <Tooltip cursor={{ fill: 'rgba(15, 159, 138, .06)' }} content={<ChartTooltip />} />
                {DISPLAY_CLASSIFICATIONS.map((classification, index) => <Bar key={classification} dataKey={classification} stackId="activity" fill={CLASSIFICATION_META[classification].color} hide={selectedClassification !== 'all' && selectedClassification !== classification} radius={index === DISPLAY_CLASSIFICATIONS.length - 1 ? [5, 5, 0, 0] : 0} className="cursor-pointer" />)}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel className="p-5 sm:p-6">
          <SectionHeading eyebrow="02 / The mix" title="Where time went" detail="Click a slice to use it as a filter everywhere on this page." />
          <div className="relative mx-auto mt-4 h-56 max-w-72" role="img" aria-label="Activity time composition chart">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart><Pie data={activityMix} dataKey="value" nameKey="classification" innerRadius={65} outerRadius={93} paddingAngle={2} stroke="transparent" onClick={(entry) => toggleClassification(entry.classification as ActivityClassification)}>{activityMix.map((item) => <Cell key={item.classification} fill={CLASSIFICATION_META[item.classification].color} opacity={selectedClassification === 'all' || selectedClassification === item.classification ? 1 : 0.22} className="cursor-pointer outline-none" />)}</Pie><Tooltip content={<ChartTooltip />} /></PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 grid place-content-center text-center"><span className="text-[9px] font-bold uppercase tracking-[0.15em] text-slate-400">Observed</span><strong className="text-xl tabular-nums text-slate-900 dark:text-neutral-100">{formatMinutes(data.totals.observedMinutes)}</strong></div>
          </div>
          <div className="space-y-2">{activityMix.map((item) => <button key={item.classification} type="button" onClick={() => toggleClassification(item.classification)} className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-xs transition hover:bg-slate-50 dark:hover:bg-neutral-800"><span className="flex items-center gap-2 text-slate-500 dark:text-neutral-400"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: CLASSIFICATION_META[item.classification].color }} />{CLASSIFICATION_META[item.classification].label}</span><strong className="tabular-nums text-slate-800 dark:text-neutral-100">{formatMinutes(item.value)}</strong></button>)}</div>
        </Panel>
      </div>

      <Panel id="day-detail" className="overflow-hidden">
        <div className="border-b border-slate-100 p-5 sm:p-6 dark:border-neutral-800"><SectionHeading eyebrow="03 / Inspect" title={DateTime.fromFormat(selectedDay, 'yyyy-MM-dd').toFormat("cccc, MMMM d")} detail={`${formatMinutes(selectedDayTotals)} shown${selectedClassification === 'all' ? '' : ` · ${CLASSIFICATION_META[selectedClassification].label.toLowerCase()} only`}. The ribbon uses the real 24-hour clock, so position and width both mean time.`} /></div>
        <div className="p-5 sm:p-6">
          <div className="grid grid-cols-4 text-[9px] font-semibold text-slate-400"><span>12 AM</span><span>6 AM</span><span>12 PM</span><span>6 PM</span></div>
          <div className="relative mt-2 h-16 overflow-hidden rounded-xl border border-slate-200 bg-[repeating-linear-gradient(90deg,transparent,transparent_calc(25%-1px),rgba(148,163,184,.18)_25%)] dark:border-neutral-800 dark:bg-neutral-950">
            {selectedSegments.map((segment, index) => {
              const start = DateTime.fromISO(segment.startUtc).toLocal();
              const startMinutes = start.hour * 60 + start.minute;
              return <button key={`${segment.startUtc}-${index}`} type="button" title={`${start.toFormat('HH:mm')}–${DateTime.fromISO(segment.endUtc).toLocal().toFormat('HH:mm')} · ${segmentLabel(segment)}`} className="absolute bottom-2 top-2 min-w-[3px] rounded-md opacity-90 transition hover:z-10 hover:scale-y-110 hover:opacity-100 focus:z-10 focus:outline-none focus:ring-2 focus:ring-white" style={{ left: `${startMinutes / 14.4}%`, width: `${Math.max(0.25, segmentMinutes(segment) / 14.4)}%`, backgroundColor: CLASSIFICATION_META[segment.classification].color }} aria-label={`${segmentLabel(segment)}, ${formatMinutes(segmentMinutes(segment))}`} />;
            })}
          </div>
          {selectedSegments.length ? <div className="mt-5 grid gap-2 md:grid-cols-2 xl:grid-cols-3">{selectedSegments.slice(0, 12).map((segment, index) => <div key={`${segment.startUtc}-detail-${index}`} className="flex items-center gap-3 rounded-xl border border-slate-100 p-3 dark:border-neutral-800"><span className="h-9 w-1 rounded-full" style={{ backgroundColor: CLASSIFICATION_META[segment.classification].color }} /><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-slate-800 dark:text-neutral-100">{segmentLabel(segment)}</p><p className="mt-0.5 text-[10px] text-slate-400">{DateTime.fromISO(segment.startUtc).toLocal().toFormat('HH:mm')} · {formatMinutes(segmentMinutes(segment))} · {CLASSIFICATION_META[segment.classification].label}</p></div></div>)}</div> : <div className="mt-5 rounded-xl bg-slate-50 p-5 text-center text-sm text-slate-500 dark:bg-neutral-800 dark:text-neutral-400">No matching observations on this day. Choose another column above or clear the category filter.</div>}
        </div>
      </Panel>

      <div className="grid gap-5 xl:grid-cols-[1.2fr_.8fr]">
        <Panel className="min-w-0 p-5 sm:p-6">
          <SectionHeading eyebrow="04 / Rhythm" title="When focus tends to appear" detail={`Observed focused and supporting minutes by hour across ${rangeDays} days. This is a pattern finder, not a scheduling rule.`} />
          <div className="mt-5 h-64" role="img" aria-label="Hourly focus rhythm area chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={hourlyRhythm} margin={{ top: 8, right: 4, left: -24, bottom: 0 }}><defs><linearGradient id="focus-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0f9f8a" stopOpacity={0.35} /><stop offset="100%" stopColor="#0f9f8a" stopOpacity={0.02} /></linearGradient></defs><CartesianGrid vertical={false} stroke="currentColor" className="text-slate-100 dark:text-neutral-800" /><XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: '#94a3b8' }} interval={3} /><YAxis axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: '#94a3b8' }} tickFormatter={(value) => formatMinutes(value)} /><Tooltip content={<ChartTooltip />} /><Area type="monotone" dataKey="focus" stroke="#0f9f8a" strokeWidth={2} fill="url(#focus-fill)" name="relevant" /></AreaChart></ResponsiveContainer></div>
        </Panel>

        <div className="space-y-5">
          <Panel className="p-5 sm:p-6">
            <SectionHeading eyebrow="05 / Reliability" title="Can you trust the picture?" detail="Missing coverage creates uncertainty; it never counts against you." />
            <div className="mt-5 space-y-4">{[
              { label: 'Watcher coverage', value: data.confidenceInputs.watcherCoverage },
              { label: 'Classified activity', value: data.confidenceInputs.classificationCoverage },
              { label: 'Sample strength', value: data.confidenceInputs.sampleFactor },
            ].map((metric) => <div key={metric.label}><div className="flex items-center justify-between text-xs"><span className="text-slate-500 dark:text-neutral-400">{metric.label}</span><strong className="tabular-nums text-slate-800 dark:text-neutral-100">{Math.round(metric.value)}%</strong></div><div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-neutral-800"><div className="h-full rounded-full bg-teal-500 transition-all" style={{ width: `${metric.value}%` }} /></div></div>)}</div>
            {!status.data?.capabilities.browser && <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200"><p className="font-bold">Browser context is missing.</p><p>Browser time stays Unknown until a browser watcher is enabled; TimeBlocking will not guess.</p><Link to="/settings" className="mt-2 inline-flex items-center gap-1 font-bold">Review settings <ChevronRight size={13} /></Link></div>}
          </Panel>

          <Panel className="p-5 sm:p-6">
            <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-teal-700 dark:text-teal-300"><FlaskConical size={13} /> One change at a time</p>
            {data.activeExperiment ? <div className="mt-3"><h3 className="font-semibold text-slate-900 dark:text-neutral-100">{data.activeExperiment.title}</h3><p className="mt-1 text-xs leading-5 text-slate-500 dark:text-neutral-400">Active until {DateTime.fromISO(data.activeExperiment.endsAtUtc).toFormat('MMM d')}. Keep other conditions steady so the comparison remains interpretable.</p></div> : suggestion ? <div className="mt-3"><h3 className="font-semibold text-slate-900 dark:text-neutral-100">{suggestion.title}</h3><p className="mt-1 text-xs leading-5 text-slate-500 dark:text-neutral-400">{suggestion.detail}</p><button type="button" onClick={runExperiment} disabled={createExperiment.isPending} className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white transition hover:bg-teal-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-teal-300">Test this for one week <ArrowRight size={13} /></button></div> : <div className="mt-3 flex items-start gap-2 text-xs leading-5 text-slate-500 dark:text-neutral-400"><Sparkles className="mt-0.5 shrink-0 text-amber-500" size={14} /><p>A useful experiment will appear after enough comparable, classified evidence is available.</p></div>}
          </Panel>
        </div>
      </div>

      {data.insights.length > 0 && <Panel className="p-5 sm:p-6"><SectionHeading eyebrow="Evidence inbox" title="Patterns worth a closer look" detail="Generated only from comparable local evidence. These are proposals, not automatic plan changes." /><div className="mt-5 grid gap-3 lg:grid-cols-2">{data.insights.map((insight) => <article key={insight.id} className="rounded-xl border border-slate-100 p-4 dark:border-neutral-800"><div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-semibold text-slate-900 dark:text-neutral-100">{insight.title}</h3><p className="mt-1 text-xs leading-5 text-slate-500 dark:text-neutral-400">{insight.detail}</p></div><span className="shrink-0 rounded-full bg-teal-50 px-2 py-1 text-[10px] font-bold text-teal-700 dark:bg-teal-500/10 dark:text-teal-300">{Math.round(insight.confidence)}%</span></div><p className="mt-3 flex items-center gap-1.5 text-[10px] text-slate-400"><Eye size={12} />{insight.sample} · {insight.limitations}</p></article>)}</div></Panel>}
    </>}

    {sync.isError && <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-200"><AlertTriangle size={14} />Sync failed. The last successful data remains visible.</div>}
    <footer className="flex flex-wrap items-center justify-between gap-2 px-1 text-[10px] text-slate-400 dark:text-neutral-500"><span className="flex items-center gap-1.5"><ShieldCheck size={13} /> Local-only sanitized evidence · no automatic completion or penalties</span>{status.data?.lastSuccessfulSyncAt && <span className="flex items-center gap-1.5"><Clock3 size={13} /> Last synced {DateTime.fromISO(status.data.lastSuccessfulSyncAt).toRelative()}</span>}</footer>
  </motion.main>;
}
