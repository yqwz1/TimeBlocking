import { DateTime } from 'luxon';
import { Activity, Clock3, Coffee, Shuffle, TimerReset } from 'lucide-react';
import { useActivityAnalytics, useActivityRecommendations, useUpdateActivityRecommendation } from '../../hooks.js';
import { Link } from 'react-router-dom';

function minutes(value: number | null): string {
  if (value === null) return '—';
  const rounded = Math.round(value);
  return rounded >= 60 ? `${Math.floor(rounded / 60)}h ${rounded % 60}m` : `${rounded}m`;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-neutral-800">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-neutral-500">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums text-slate-800 dark:text-neutral-100">{value}</p>
    </div>
  );
}

/** Observed metrics deliberately remain separate from calendar completion analytics. */
export default function ActivityAnalyticsPanel({ weekStart }: { weekStart: string }) {
  const start = DateTime.fromISO(weekStart).startOf('day').toUTC().toISO()!;
  const end = DateTime.fromISO(weekStart).plus({ days: 7 }).startOf('day').toUTC().toISO()!;
  const analytics = useActivityAnalytics(start, end);
  const recommendations = useActivityRecommendations();
  const updateRecommendation = useUpdateActivityRecommendation();
  const data = analytics.data;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-semibold text-slate-900 dark:text-neutral-100"><Activity size={17} className="text-teal-600" /> Planned vs observed</h2>
          <p className="mt-1 text-xs text-slate-400 dark:text-neutral-500">Activity evidence is observational; it never completes tasks or changes your schedule.</p>
        </div>
        <Link to="/activity" className="shrink-0 rounded-md border border-teal-200 px-2 py-1 text-xs font-medium text-teal-700 hover:bg-teal-50 dark:border-teal-500/30 dark:text-teal-300 dark:hover:bg-teal-500/10">Open Activity Center</Link>
        {data && <span className="rounded-full bg-teal-50 px-2 py-1 text-xs font-medium text-teal-700 dark:bg-teal-500/10 dark:text-teal-300">{data.verifiedBlockCount}/{data.blockCount} verified</span>}
      </div>
      {!data || data.blockCount === 0 ? (
        <p className="rounded-lg bg-slate-50 px-3 py-4 text-sm text-slate-500 dark:bg-neutral-800 dark:text-neutral-400">No observed block summaries for this week yet. ActivityWatch needs sanitized ingestion before evidence can be calculated.</p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Metric label="Start latency" value={minutes(data.startLatencyMin)} />
          <Metric label="Overrun" value={minutes(data.overrunMin)} />
          <Metric label="Relevant" value={minutes(data.relevantMin + data.supportingMin)} />
          <Metric label="Distraction" value={minutes(data.distractionMin)} />
          <Metric label="Idle / unknown" value={`${minutes(data.idleMin)} / ${minutes(data.unknownMin)}`} />
          <Metric label="Focus quality" value={data.focusQuality === null ? '—' : `${Math.round(data.focusQuality)}%`} />
        </div>
      )}
      {data && data.blockCount > 0 && (
        <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-slate-500 sm:grid-cols-3 dark:text-neutral-400">
          <span className="flex items-center gap-1.5"><Shuffle size={13} /> {data.contextSwitchRate === null ? 'No switch-rate sample' : `${data.contextSwitchRate.toFixed(1)} switches / active hour`}</span>
          <span className="flex items-center gap-1.5"><TimerReset size={13} /> Return latency {minutes(data.returnLatencyMin)}</span>
          <span className="flex items-center gap-1.5"><Clock3 size={13} /> Longest focus session {minutes(data.longestFocusSessionMin)}</span>
        </div>
      )}
      {recommendations.data?.some((item) => item.status === 'active') && (
        <div className="mt-4 border-t border-slate-100 pt-3 dark:border-neutral-800">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-neutral-500">Gentle suggestions</p>
          <div className="space-y-2">
            {recommendations.data.filter((item) => item.status === 'active').map((item) => (
              <div key={item.id} className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm dark:bg-amber-500/10">
                <Coffee size={15} className="shrink-0 text-amber-600 dark:text-amber-300" />
                <div className="min-w-0 flex-1"><p className="font-medium text-slate-800 dark:text-neutral-100">{item.title}</p>{item.detail && <p className="truncate text-xs text-slate-500 dark:text-neutral-400">{item.detail}</p>}</div>
                <button type="button" onClick={() => updateRecommendation.mutate({ id: item.id, action: 'accept' })} className="rounded-md bg-white px-2 py-1 text-xs font-medium text-teal-700 shadow-sm dark:bg-neutral-800 dark:text-teal-300">Review</button>
                <button type="button" onClick={() => updateRecommendation.mutate({ id: item.id, action: 'dismiss' })} className="text-xs text-slate-500 hover:text-slate-800 dark:text-neutral-400 dark:hover:text-neutral-200">Dismiss</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
