import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Download, FileUp, Loader2, MoreHorizontal, Printer, RefreshCw, Search, TriangleAlert } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import type { WorkoutJobDTO } from '@timeblock/shared';
import WorkoutSidebar, { workoutItems, type WorkoutView } from '../components/workout/WorkoutSidebar.js';
import WorkoutOverview from '../components/workout/WorkoutOverview.js';
import WorkoutStrength from '../components/workout/WorkoutStrength.js';
import type { WorkoutRange } from '../components/workout/workoutAnalytics.js';
import { resolveWorkoutRoute, selectWorkoutSection, setWorkoutParameter } from '../components/workout/workoutNavigation.js';
import {
  BodyMapView,
  CalendarView,
  GoalsView,
  JobResult,
  PowerliftingView,
  RecordsView,
  SettingsView,
  ToolsView,
  VolumeView,
} from '../components/workout/WorkoutViews.js';
import { useWorkoutImport, useWorkoutJob, useWorkoutStatus, useWorkoutSummary, useWorkoutSync } from '../hooks/workout.js';

const ACTION = 'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 outline-none transition hover:-translate-y-px hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-teal-500/60 disabled:pointer-events-none disabled:opacity-45 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800';
const VIEWS = new Set(workoutItems.map((item) => item.id));

function LoadingWorkspace() {
  return <div className="mx-auto w-full max-w-[1480px] animate-pulse space-y-5 py-2"><div className="h-52 rounded-2xl bg-slate-100 dark:bg-neutral-900" /><div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <div key={index} className="h-24 rounded-xl bg-slate-100 dark:bg-neutral-900" />)}</div><div className="grid gap-4 xl:grid-cols-[1.3fr_.7fr]"><div className="h-80 rounded-2xl bg-slate-100 dark:bg-neutral-900" /><div className="h-80 rounded-2xl bg-slate-100 dark:bg-neutral-900" /></div></div>;
}

export default function WorkoutPage() {
  const [params, setParams] = useSearchParams();
  const [jobId, setJobId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const statusQuery = useWorkoutStatus();
  const summary = useWorkoutSummary();
  const watchedJob = useWorkoutJob(jobId);
  const sync = useWorkoutSync();
  const workoutImport = useWorkoutImport();
  const job = watchedJob.data ?? statusQuery.data?.activeJob ?? null;
  const route = resolveWorkoutRoute(params);
  const { section: view, range, compare, overviewMetric, strengthMode, strengthSort } = route;
  const summaryError = summary.error instanceof Error ? summary.error.message : '';
  const summaryMissing = summaryError.includes('No workout summary exists');

  useEffect(() => {
    if (watchedJob.data?.status === 'completed') {
      void qc.invalidateQueries({ queryKey: ['workout', 'summary'] });
      void qc.invalidateQueries({ queryKey: ['workout', 'status'] });
      void qc.invalidateQueries({ queryKey: ['workout', 'exercise-history'] });
    }
  }, [watchedJob.data?.status, qc]);

  const track = (created: WorkoutJobDTO) => setJobId(created.id);
  const updateParam = (key: string, value: string, replace = false) => {
    setParams(setWorkoutParameter(params, key, value), { replace });
  };
  const navigate = (nextView: WorkoutView, extras: Record<string, string> = {}) => {
    setParams(selectWorkoutSection(params, nextView, extras));
  };

  const content = summary.data ? (() => {
    switch (view) {
      case 'strength': return <WorkoutStrength summary={summary.data} range={range} exerciseName={route.exercise} search={route.search} status={route.status} muscle={route.muscle} sort={strengthSort} mode={strengthMode} onParam={updateParam} />;
      case 'powerlifting': return <PowerliftingView summary={summary.data} />;
      case 'volume': return <VolumeView summary={summary.data} />;
      case 'body': return <BodyMapView summary={summary.data} onNavigate={(target) => navigate(VIEWS.has(target as WorkoutView) ? target as WorkoutView : 'overview')} />;
      case 'calendar': return <CalendarView summary={summary.data} />;
      case 'records': return <RecordsView summary={summary.data} />;
      case 'goals': return <GoalsView summary={summary.data} onJob={track} />;
      case 'tools': return <ToolsView summary={summary.data} activeJob={job} onJob={track} />;
      case 'settings': return <SettingsView connected={statusQuery.data?.hevyConnected ?? false} />;
      default: return <WorkoutOverview summary={summary.data} range={range} compare={compare} metric={overviewMetric} onRangeChange={(value) => updateParam('range', value)} onCompareChange={(value) => updateParam('compare', value ? '1' : '', true)} onMetricChange={(value) => updateParam('metric', value, true)} onNavigate={navigate} />;
    }
  })() : null;

  return <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-slate-50 font-[Aptos,'Segoe_UI_Variable_Text','Segoe_UI',sans-serif] text-slate-900 dark:bg-neutral-950 dark:text-neutral-100">
    <header className="z-30 flex min-h-14 shrink-0 items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900 sm:px-4">
      <div className="min-w-0"><p className="truncate text-sm font-semibold tracking-[-0.02em] text-slate-900 dark:text-neutral-100">Workout coach</p><p className="truncate text-[10px] text-slate-400">{summary.data ? `Latest ${summary.data.window.latest_session} · ${statusQuery.data?.sessions ?? Object.keys(summary.data.sessions).length} sessions` : 'Loading your training history'}</p></div>
      <div className="flex min-w-0 items-center gap-1.5">
        <div className="hidden rounded-lg bg-slate-100 p-1 dark:bg-neutral-800 xl:flex" aria-label="Workout time range">{(['4w', '8w', '12w', 'all'] as WorkoutRange[]).map((item) => <button key={item} type="button" aria-pressed={range === item} onClick={() => updateParam('range', item, true)} className={`h-7 rounded-md px-2 text-[10px] font-semibold uppercase outline-none focus-visible:ring-2 focus-visible:ring-teal-500/60 ${range === item ? 'bg-white text-slate-900 shadow-sm dark:bg-neutral-700 dark:text-white' : 'text-slate-400'}`}>{item}</button>)}</div>
        <label className="relative hidden lg:block"><span className="sr-only">Search exercises</span><Search size={13} className="absolute left-2.5 top-2.5 text-slate-400" /><input value={params.get('search') ?? ''} onChange={(event) => { updateParam('search', event.target.value, true); if (event.target.value && view !== 'strength') navigate('strength'); }} className="h-9 w-40 rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-2 text-xs outline-none focus:border-teal-500 dark:border-neutral-700 dark:bg-neutral-950" placeholder="Search lifts" /></label>
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) workoutImport.mutate(file, { onSuccess: track }); event.currentTarget.value = ''; }} />
        <button type="button" className={ACTION} onClick={() => sync.mutate({ full: false }, { onSuccess: track })} disabled={!statusQuery.data?.hevyConnected || sync.isPending || Boolean(statusQuery.data?.activeJob)} title={statusQuery.data?.hevyConnected ? 'Sync new workouts from Hevy' : 'Add your Hevy key in Workout settings'}><RefreshCw size={13} className={job?.command === 'sync' && job.status === 'running' ? 'animate-spin' : ''} /><span className="hidden sm:inline">Sync</span></button>
        <details className="group relative"><summary className={`${ACTION} list-none cursor-pointer`}><MoreHorizontal size={15} /><span className="hidden sm:inline">Data</span></summary><div className="absolute right-0 top-11 z-50 w-48 overflow-hidden rounded-xl bg-white p-1.5 shadow-xl ring-1 ring-slate-200 dark:bg-neutral-900 dark:ring-neutral-700"><button type="button" className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-xs font-medium hover:bg-slate-100 dark:hover:bg-neutral-800" onClick={() => fileRef.current?.click()} disabled={workoutImport.isPending}><FileUp size={14} /> Import Hevy CSV</button><a className="flex min-h-10 items-center gap-2 rounded-lg px-3 text-xs font-medium hover:bg-slate-100 dark:hover:bg-neutral-800" href="/api/workout/exports/json" download><Download size={14} /> Export summary JSON</a><a className="flex min-h-10 items-center gap-2 rounded-lg px-3 text-xs font-medium hover:bg-slate-100 dark:hover:bg-neutral-800" href="/api/workout/exports/lifts.csv" download><Download size={14} /> Export lifts CSV</a><button type="button" className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-xs font-medium hover:bg-slate-100 dark:hover:bg-neutral-800" onClick={() => window.print()}><Printer size={14} /> Print workspace</button></div></details>
      </div>
    </header>

    <WorkoutSidebar view={view} onChange={(next) => navigate(next)} />

    {job && ['queued', 'running'].includes(job.status) && <div className="flex shrink-0 items-center gap-2 border-b border-teal-200 bg-teal-50 px-4 py-2 text-xs text-teal-800 dark:border-teal-500/20 dark:bg-teal-500/10 dark:text-teal-300"><Loader2 size={13} className="animate-spin" /><span className="font-medium capitalize">{job.command.replaceAll('-', ' ')}</span><span className="hidden text-teal-600/70 dark:text-teal-400/70 sm:inline">The coach is working. You can keep browsing.</span></div>}
    {job && ['failed', 'interrupted'].includes(job.status) && <div className="flex shrink-0 items-center gap-2 border-b border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300"><TriangleAlert size={13} /><span className="font-medium capitalize">{job.command.replaceAll('-', ' ')} failed.</span><span className="truncate">{job.error}</span></div>}

    <section className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-3 py-4 sm:px-5 sm:py-5" aria-label={`${workoutItems.find((item) => item.id === view)?.label ?? 'Workout'} content`}>
      {summary.isLoading ? <LoadingWorkspace /> : summaryMissing ? <div className="grid min-h-[28rem] place-items-center"><div className="max-w-md text-center"><span className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-teal-50 text-teal-600 dark:bg-teal-500/10 dark:text-teal-400"><FileUp size={20} /></span><h2 className="mt-4 text-lg font-semibold text-slate-900 dark:text-neutral-100">Bring in your workout history</h2><p className="mt-2 text-sm leading-6 text-slate-500 dark:text-neutral-400">Import a Hevy CSV or add your API key in Settings and run a full sync. Existing local workout data remains on this computer.</p><button type="button" className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-lg bg-teal-600 px-4 text-sm font-semibold text-white outline-none transition hover:bg-teal-700 focus-visible:ring-2 focus-visible:ring-teal-500/60" onClick={() => fileRef.current?.click()}><FileUp size={14} /> Choose CSV</button></div></div> : summary.error ? <div className="grid min-h-[28rem] place-items-center"><div className="max-w-lg rounded-2xl border border-amber-200 bg-white p-6 text-center shadow-sm dark:border-amber-500/20 dark:bg-neutral-900"><span className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300"><TriangleAlert size={20} /></span><h2 className="mt-4 text-lg font-semibold">Workout data could not be loaded</h2><p className="mt-2 text-sm leading-6 text-slate-500 dark:text-neutral-400">Your local history is still safe. {summaryError || 'The workout service returned an unexpected response.'}</p><button type="button" className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white outline-none transition hover:bg-slate-700 focus-visible:ring-2 focus-visible:ring-teal-500/60 dark:bg-white dark:text-neutral-900" onClick={() => void summary.refetch()}><RefreshCw size={14} /> Try again</button></div></div> : content}
      {watchedJob.data && <JobResult job={watchedJob.data} />}
    </section>
  </div>;
}
