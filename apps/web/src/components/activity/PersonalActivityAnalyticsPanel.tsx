import { DateTime } from 'luxon';
import { BarChart3, Brain, CalendarClock, ChevronRight, Clock3, Lightbulb, Repeat2, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { useActivityPersonalAnalytics, useAnalyzeActivityAiPreview, useCreateActivityAiPreview } from '../../hooks.js';

function minutes(value: number | null): string {
  if (value === null) return '—';
  const rounded = Math.round(value);
  return rounded >= 60 ? `${Math.floor(rounded / 60)}h ${rounded % 60}m` : `${rounded}m`;
}

function percent(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`;
}

function Heatmap({ cells }: { cells: Array<{ weekday: number; hour: number; observedMin: number; focusQuality: number | null; sampleCount: number }> }) {
  const byCell = new Map(cells.map((cell) => [`${cell.weekday}:${cell.hour}`, cell]));
  const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[600px]">
        <div className="mb-1 grid grid-cols-[28px_repeat(24,minmax(0,1fr))] gap-0.5 text-[9px] text-slate-400 dark:text-neutral-500">
          <span />
          {Array.from({ length: 24 }, (_, hour) => <span key={hour} className="text-center">{hour % 3 === 0 ? hour : ''}</span>)}
        </div>
        {weekdays.map((day, weekdayIndex) => (
          <div key={day} className="grid grid-cols-[28px_repeat(24,minmax(0,1fr))] gap-0.5">
            <span className="self-center text-[10px] text-slate-400 dark:text-neutral-500">{day}</span>
            {Array.from({ length: 24 }, (_, hour) => {
              const cell = byCell.get(`${weekdayIndex + 1}:${hour}`);
              const strength = cell?.focusQuality === null || !cell ? 0 : Math.max(0.15, cell.focusQuality / 100);
              return <span key={hour} title={cell ? `${day} ${String(hour).padStart(2, '0')}:00 · ${minutes(cell.observedMin)} observed · ${cell.focusQuality === null ? 'no focus-quality sample' : `${Math.round(cell.focusQuality)}% focus quality`} · ${cell.sampleCount} blocks` : `${day} ${String(hour).padStart(2, '0')}:00 · no sample`} className="h-3 rounded-sm" style={{ backgroundColor: cell ? `rgba(13, 148, 136, ${strength})` : 'rgba(148, 163, 184, 0.12)' }} />;
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return <div className="rounded-lg bg-slate-50 px-3 py-2.5 dark:bg-neutral-800"><p className="text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-neutral-500">{label}</p><p className="mt-0.5 text-lg font-semibold tabular-nums text-slate-800 dark:text-neutral-100">{value}</p><p className="mt-0.5 text-[11px] text-slate-400 dark:text-neutral-500">{hint}</p></div>;
}

/** Phase 3 is aggregate-only: this UI never receives raw application or browser activity. */
export default function PersonalActivityAnalyticsPanel({ weekStart }: { weekStart: string }) {
  const to = DateTime.fromISO(weekStart).plus({ days: 7 }).startOf('day').toUTC().toISO()!;
  const from = DateTime.fromISO(to).minus({ days: 30 }).toISO()!;
  const { data, isLoading } = useActivityPersonalAnalytics(from, to);
  const [heatmapKey, setHeatmapKey] = useState('overall');
  const [includeApplicationFamilies, setIncludeApplicationFamilies] = useState(false);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const createAiPreview = useCreateActivityAiPreview();
  const analyzeAiPreview = useAnalyzeActivityAiPreview();

  if (isLoading) return <section className="h-52 animate-pulse rounded-xl bg-slate-100 dark:bg-neutral-800/60" />;
  if (!data || data.sample.blockCount === 0) return null;

  const capacity = data.capacityCurve.filter((point) => point.sampleCount > 0);
  const maxObserved = Math.max(1, ...capacity.map((point) => point.observedMin));
  const previews = data.schedulerPreviews.slice(0, 4);
  const heatmapOptions = [
    { key: 'overall', label: 'All activity', cells: data.focusHeatmaps.overall },
    ...data.focusHeatmaps.byProject.map((series) => ({ key: series.key, label: `Project: ${series.label}`, cells: series.cells })),
    ...data.focusHeatmaps.byTaskClass.map((series) => ({ key: series.key, label: `Task class: ${series.label}`, cells: series.cells })),
  ];
  const selectedHeatmap = heatmapOptions.find((option) => option.key === heatmapKey) ?? heatmapOptions[0]!;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-semibold text-slate-900 dark:text-neutral-100"><Brain size={17} className="text-violet-600" /> Personal activity patterns</h2>
          <p className="mt-1 text-xs text-slate-400 dark:text-neutral-500">Last 30 days ending this week · derived from sanitized block evidence only.</p>
        </div>
        <span className="rounded-full bg-violet-50 px-2 py-1 text-xs font-medium text-violet-700 dark:bg-violet-500/10 dark:text-violet-300">{data.sample.verifiedBlockCount}/{data.sample.blockCount} verified · {data.sample.distinctDays} days</span>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <Metric label="Task estimate" value={minutes(data.calibration.taskEstimateMin)} hint={`${data.calibration.sampleCount} block samples`} />
        <Metric label="Calendar time" value={minutes(data.calibration.calendarMin)} hint="scheduled block duration" />
        <Metric label="Observed work" value={minutes(data.calibration.observedWorkMin)} hint={`${percent(data.calibration.calendarToObservedRatio)} of calendar time`} />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(220px,0.8fr)]">
        <div className="rounded-lg border border-slate-100 p-3 dark:border-neutral-800">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><BarChart3 size={15} className="text-teal-600" /><div><p className="text-sm font-medium text-slate-800 dark:text-neutral-100">Focus heatmap</p><p className="text-[11px] text-slate-400 dark:text-neutral-500">Scheduled start hour; darker means higher focus quality.</p></div></div><select value={selectedHeatmap.key} onChange={(event) => setHeatmapKey(event.target.value)} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200">{heatmapOptions.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></div>
          <Heatmap cells={selectedHeatmap.cells} />
        </div>
        <div className="rounded-lg border border-slate-100 p-3 dark:border-neutral-800">
          <div className="mb-3 flex items-center gap-2"><Clock3 size={15} className="text-teal-600" /><div><p className="text-sm font-medium text-slate-800 dark:text-neutral-100">Deep-work capacity</p><p className="text-[11px] text-slate-400 dark:text-neutral-500">Observed relevant/supporting minutes by hour.</p></div></div>
          <div className="space-y-1.5">
            {capacity.map((point) => <div key={point.hour} className="flex items-center gap-2 text-xs"><span className="w-9 tabular-nums text-slate-400 dark:text-neutral-500">{String(point.hour).padStart(2, '0')}:00</span><span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-neutral-800"><span className="block h-full rounded-full bg-teal-500" style={{ width: `${(point.observedMin / maxObserved) * 100}%` }} /></span><span className="w-9 text-right tabular-nums text-slate-500 dark:text-neutral-400">{minutes(point.observedMin)}</span></div>)}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="rounded-lg border border-slate-100 p-3 dark:border-neutral-800">
          <p className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-neutral-100"><Repeat2 size={15} className="text-amber-600" /> Session length</p>
          <div className="space-y-2 text-xs">{data.sessionLengthBands.map((band) => <div key={band.label} className="flex justify-between gap-2"><span className="text-slate-500 dark:text-neutral-400">{band.label} · {band.sampleCount} blocks</span><span className="font-medium tabular-nums text-slate-700 dark:text-neutral-200">{band.focusQuality === null ? '—' : `${Math.round(band.focusQuality)}%`}</span></div>)}</div>
        </div>
        <div className="rounded-lg border border-slate-100 p-3 dark:border-neutral-800">
          <p className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-neutral-100"><CalendarClock size={15} className="text-amber-600" /> Interruptions & meetings</p>
          <div className="space-y-2 text-xs text-slate-500 dark:text-neutral-400"><p>{minutes(data.distraction.totalMinutes)} distraction across {data.distraction.affectedBlockCount} blocks.</p><p>Return latency {minutes(data.distraction.averageReturnLatencyMin)}.</p><p>{data.meetingAdjacency.adjacentBlockCount} blocks began within 30m of a meeting.</p><p>{percent(data.delayedStartRisk.rate)} delayed-start risk · {percent(data.overrunRisk.rate)} overrun risk.</p></div>
        </div>
        <div className="rounded-lg border border-slate-100 p-3 dark:border-neutral-800">
          <p className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-neutral-100"><Sparkles size={15} className="text-amber-600" /> Context patterns</p>
          <div className="space-y-2 text-xs text-slate-500 dark:text-neutral-400">{data.categories.slice(0, 3).map((category) => <p key={category.category}>{category.category}: {minutes(category.observedMin)} observed · {category.contextSwitches} switches</p>)}{data.betweenBlockTransitions.slice(0, 1).map((transition) => <p key={`${transition.from}-${transition.to}`}>{transition.from} <ChevronRight className="inline h-3 w-3" /> {transition.to}: {transition.count} adjacent-block transitions</p>)}</div>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-slate-100 p-3 text-xs dark:border-neutral-800">
        <p className="font-medium text-slate-800 dark:text-neutral-100">Split versus long blocks</p>
        <p className="mt-1 text-slate-500 dark:text-neutral-400">Tasks represented by multiple scheduled blocks: {data.splitVsLong.splitBlockCount} blocks · {data.splitVsLong.splitFocusQuality === null ? 'no focus-quality sample' : `${Math.round(data.splitVsLong.splitFocusQuality)}% focus quality`}. Other blocks: {data.splitVsLong.longBlockCount} · {data.splitVsLong.longFocusQuality === null ? 'no focus-quality sample' : `${Math.round(data.splitVsLong.longFocusQuality)}% focus quality`}. This is a comparison, not an automatic splitting recommendation.</p>
      </div>

      {(data.weeklyInsights.length > 0 || previews.length > 0) && <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-violet-100 bg-violet-50/50 p-3 dark:border-violet-500/20 dark:bg-violet-500/5">
          <p className="mb-2 flex items-center gap-2 text-sm font-medium text-violet-900 dark:text-violet-100"><Lightbulb size={15} /> Weekly deterministic review</p>
          <div className="space-y-2">{data.weeklyInsights.map((insight) => <div key={insight.id}><p className="text-xs font-medium text-slate-800 dark:text-neutral-100">{insight.title}</p><p className="mt-0.5 text-xs text-slate-500 dark:text-neutral-400">{insight.detail}</p></div>)}</div>
        </div>
        <div className="rounded-lg border border-slate-100 p-3 dark:border-neutral-800">
          <p className="mb-2 text-sm font-medium text-slate-800 dark:text-neutral-100">Scheduler previews</p>
          <p className="mb-2 text-[11px] text-slate-400 dark:text-neutral-500">Evidence only. No preview changes your schedule; any future influence is capped at 15%.</p>
          <div className="space-y-2">{previews.length ? previews.map((preview) => <div key={`${preview.dimension}-${preview.key}`} className="flex items-start justify-between gap-3 text-xs"><div><p className="font-medium capitalize text-slate-700 dark:text-neutral-200">{preview.direction} {preview.label}</p><p className="text-slate-400 dark:text-neutral-500">{preview.sampleCount} verified blocks · {preview.confidence === null ? 'no confidence sample' : `${Math.round(preview.confidence)}% confidence`}</p></div><span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 font-medium tabular-nums text-slate-600 dark:bg-neutral-800 dark:text-neutral-300">{preview.potentialScoreImpactPct}% max</span></div>) : <p className="text-xs text-slate-500 dark:text-neutral-400">Need at least three verified samples per segment; scheduler influence also needs 20 verified blocks across 10 days.</p>}</div>
        </div>
      </div>}

      <div className="mt-4 rounded-lg border border-violet-200 bg-violet-50/40 p-3 dark:border-violet-500/25 dark:bg-violet-500/5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-sm font-medium text-violet-900 dark:text-violet-100"><Sparkles size={15} /> Optional AI review</p>
            <p className="mt-1 max-w-2xl text-xs text-slate-600 dark:text-neutral-400">Prepare a 30-day aggregate-only payload for review. It excludes event timelines, titles, URLs, domains, file paths, and individual application names. Nothing is sent until you review and approve the exact preview below.</p>
          </div>
          <button
            type="button"
            onClick={() => { setReviewConfirmed(false); analyzeAiPreview.reset(); createAiPreview.mutate({ fromUtc: from, toUtc: to, includeApplicationFamilies }); }}
            disabled={createAiPreview.isPending}
            className="rounded-md bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {createAiPreview.isPending ? 'Preparing…' : 'Prepare review'}
          </button>
        </div>
        <label className="mt-3 flex items-start gap-2 text-xs text-slate-600 dark:text-neutral-400">
          <input type="checkbox" checked={includeApplicationFamilies} onChange={(event) => setIncludeApplicationFamilies(event.target.checked)} className="mt-0.5" />
          <span>Include broad application-family totals (such as browser, editor, or terminal). Individual application names are still excluded.</span>
        </label>
        {createAiPreview.error && <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{createAiPreview.error.message}</p>}

        {createAiPreview.data && <div className="mt-3 border-t border-violet-200 pt-3 dark:border-violet-500/20">
          <p className="text-xs font-medium text-slate-800 dark:text-neutral-100">Review the exact payload</p>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-neutral-400">This one-time approval expires at {new Date(createAiPreview.data.expiresAtUtc).toLocaleTimeString()}. Payload hash: <span className="font-mono">{createAiPreview.data.payloadHash}</span></p>
          <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-slate-950 p-3 text-[11px] leading-relaxed text-slate-100">{JSON.stringify(createAiPreview.data.payload, null, 2)}</pre>
          <label className="mt-3 flex items-start gap-2 text-xs text-slate-700 dark:text-neutral-300">
            <input type="checkbox" checked={reviewConfirmed} onChange={(event) => setReviewConfirmed(event.target.checked)} className="mt-0.5" />
            <span>I reviewed this exact aggregate payload and approve this one-time AI transmission.</span>
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => analyzeAiPreview.mutate({ previewId: createAiPreview.data!.id, payloadHash: createAiPreview.data!.payloadHash })}
              disabled={!reviewConfirmed || analyzeAiPreview.isPending || !!analyzeAiPreview.data}
              className="rounded-md bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {analyzeAiPreview.isPending ? 'Analyzing…' : analyzeAiPreview.data ? 'Sent once' : 'Send reviewed payload'}
            </button>
            <button type="button" onClick={() => { setReviewConfirmed(false); createAiPreview.reset(); analyzeAiPreview.reset(); }} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-white dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800">Discard preview</button>
          </div>
          {analyzeAiPreview.error && <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{analyzeAiPreview.error.message}. Prepare and review a new payload to try again.</p>}
          {analyzeAiPreview.data && <div className="mt-3 rounded-md bg-white p-3 text-xs leading-relaxed text-slate-700 whitespace-pre-wrap dark:bg-neutral-900 dark:text-neutral-200">{analyzeAiPreview.data.content}</div>}
        </div>}
      </div>
    </section>
  );
}
