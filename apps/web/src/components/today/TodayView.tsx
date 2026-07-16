import { useMemo, useRef, useState, type RefObject } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, ChevronDown, Flame, RotateCcw } from 'lucide-react';
import type { DailyPlanDTO, ObjectiveDTO, PlanWarningDTO, ScheduleItemDTO, TaskViewDTO, TodayPlanDTO } from '@timeblock/shared';
import { useCompleteTask, useDailyPlan, useGamificationSummary, useRescheduleTask, useTodayPlan } from '../../hooks.js';
import { fmtDur, greeting } from './format.js';
import TaskCheckbox from '../tasks/TaskCheckbox.js';
import { DueChip, PriorityBadge } from '../tasks/taskDisplay.js';
import ScheduleCalendar from '../calendar/ScheduleCalendar.js';
import { STYLES } from '../calendar/EventCard.js';
import QuickAddTask from '../tasks/QuickAddTask.js';
import { quickDateOptions } from '../tasks/taskDisplay.js';
import NowCard from './NowCard.js';
import HighlightCard from './HighlightCard.js';
import ShutdownCard from './ShutdownCard.js';
import BriefCard from '../BriefCard.js';

const ALL_KINDS = new Set(Object.keys(STYLES) as (keyof typeof STYLES)[]);
const NO_PRIORITIES = new Set<1 | 2 | 3 | 4>();

const railCard = 'rounded-xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/40';

/* ---------------- shared bits ---------------- */

function SectionLabel({ children, trailing }: { children: React.ReactNode; trailing?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-neutral-500">{children}</h3>
      {trailing}
    </div>
  );
}

const iconBtn =
  'cursor-pointer rounded p-1 text-slate-400 transition-colors duration-150 hover:bg-slate-200 hover:text-slate-600 disabled:pointer-events-none disabled:opacity-40 dark:hover:bg-neutral-700 dark:hover:text-neutral-300';

/* ---------------- header stats ---------------- */

function StatChip({ children, tone }: { children: React.ReactNode; tone?: 'rose' | 'flame' }) {
  const tones = {
    rose: 'border-rose-200 bg-rose-50 text-rose-600 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400',
    flame: 'border-orange-200 bg-orange-50 text-orange-600 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-400',
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs tabular-nums ${
        tone ? tones[tone] : 'border-slate-200 bg-white text-slate-500 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400'
      }`}
    >
      {children}
    </span>
  );
}

function Value({ children }: { children: React.ReactNode }) {
  return <span className="font-semibold text-slate-800 dark:text-neutral-100">{children}</span>;
}

function HeaderStats({ plan, doneCount, totalCount }: { plan: TodayPlanDTO; doneCount: number; totalCount: number }) {
  const { data: gami } = useGamificationSummary();
  const useDue = plan.dueTodayCount > 0;
  const done = useDue ? plan.dueTodayDoneCount : doneCount;
  const total = useDue ? plan.dueTodayCount : totalCount;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-2">
      {total > 0 && (
        <StatChip>
          <span aria-hidden className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200 dark:bg-neutral-800">
            <span className="block h-full rounded-full bg-teal-500 transition-[width] duration-300" style={{ width: `${pct}%` }} />
          </span>
          <Value>{done}</Value> of {total} {useDue ? 'due tasks' : 'blocks'} done
        </StatChip>
      )}
      {plan.plannedMin > 0 && (
        <StatChip>
          <Value>{fmtDur(plan.plannedMin)}</Value> planned ahead
        </StatChip>
      )}
      <StatChip>
        <Value>{fmtDur(plan.capacityMin)}</Value> free
      </StatChip>
      {plan.overloaded && (
        <StatChip tone="rose">
          <AlertTriangle size={12} aria-hidden /> Over capacity
        </StatChip>
      )}
      {gami?.enabled && gami.streak.current > 0 && (
        <StatChip tone="flame">
          <Flame size={12} aria-hidden />
          <Value>{gami.streak.current}</Value> day streak
        </StatChip>
      )}
    </div>
  );
}

/* ---------------- warnings ---------------- */

function warningText(w: PlanWarningDTO): { title: string; detail: string; critical: boolean } {
  const name = w.taskContent ?? 'A task';
  const day = w.date ? new Date(w.date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long' }) : null;
  switch (w.kind) {
    case 'unplaceable':
      return { title: `${name} won't fit`, detail: 'no open slot before the horizon ends', critical: true };
    case 'past_deadline':
      return { title: `${name} is overdue`, detail: 'reschedule or drop it', critical: true };
    case 'placed_after_deadline':
      return { title: `${name} will miss its deadline`, detail: 'earliest open slot is after the deadline', critical: false };
    case 'capacity_shortfall':
      return {
        title: `${day ?? 'That day'} is over-committed${w.shortfallMin ? ` by ${fmtDur(w.shortfallMin)}` : ''}`,
        detail: `${name} is most likely to slip`,
        critical: false,
      };
    default:
      return { title: name, detail: '', critical: false };
  }
}

const GROUP_PHRASE: Partial<Record<PlanWarningDTO['kind'], string>> = {
  unplaceable: "won't fit before the horizon ends",
  past_deadline: 'are overdue',
  placed_after_deadline: 'will miss their deadline',
};

function buildWarningViews(warnings: PlanWarningDTO[]) {
  const seenTask = new Set<string>();
  const unique = warnings.filter((w) => {
    const key = w.kind + '|' + (w.taskContent ?? w.date ?? '');
    return seenTask.has(key) ? false : (seenTask.add(key), true);
  });

  // Collapse 3+ warnings of the same kind into one line instead of repeating the same sentence.
  const byKind = new Map<PlanWarningDTO['kind'], PlanWarningDTO[]>();
  for (const w of unique) byKind.set(w.kind, [...(byKind.get(w.kind) ?? []), w]);

  const views: { title: string; detail: string; critical: boolean }[] = [];
  for (const [kind, group] of byKind) {
    const phrase = GROUP_PHRASE[kind];
    if (phrase && group.length >= 3) {
      views.push({
        title: `${group.length} tasks ${phrase}`,
        detail: group.map((w) => w.taskContent ?? 'a task').join(', '),
        critical: kind === 'unplaceable' || kind === 'past_deadline',
      });
    } else {
      const seenTitle = new Set<string>();
      for (const w of group) {
        const v = warningText(w);
        if (!seenTitle.has(v.title)) {
          seenTitle.add(v.title);
          views.push(v);
        }
      }
    }
  }
  views.sort((a, b) => Number(b.critical) - Number(a.critical));
  return views;
}

function WarningsCard({ warnings }: { warnings: PlanWarningDTO[] }) {
  const views = useMemo(() => buildWarningViews(warnings), [warnings]);
  const [open, setOpen] = useState(true);
  if (views.length === 0) return null;
  const criticalCount = views.filter((v) => v.critical).length;

  return (
    <section className="rounded-xl border border-amber-200 bg-amber-50/50 dark:border-amber-500/25 dark:bg-amber-500/[0.06]">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center gap-2 px-4 py-2.5 text-left"
      >
        <AlertTriangle size={14} className={criticalCount > 0 ? 'text-rose-500' : 'text-amber-500'} aria-hidden />
        <span className="flex-1 text-sm font-medium text-slate-800 dark:text-neutral-100">
          Needs attention
          <span className="ml-1.5 text-xs font-normal text-slate-400 dark:text-neutral-500">
            {views.length} issue{views.length === 1 ? '' : 's'}
          </span>
        </span>
        <ChevronDown size={15} className={`text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && (
        <ul className="space-y-1.5 border-t border-amber-200/70 px-4 py-3 dark:border-amber-500/20">
          {views.map((v, i) => (
            <li key={i} className="flex items-baseline gap-2 text-sm">
              <span
                aria-hidden
                className={`relative top-[-2px] h-1.5 w-1.5 shrink-0 rounded-full ${v.critical ? 'bg-rose-500' : 'bg-amber-500'}`}
              />
              <span className="min-w-0 text-slate-700 dark:text-neutral-200">
                {v.title}
                {v.detail && <span className="text-slate-400 dark:text-neutral-500"> — {v.detail}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ---------------- missed ---------------- */

function Missed({ tasks }: { tasks: TaskViewDTO[] }) {
  const reschedule = useRescheduleTask();
  const complete = useCompleteTask();
  if (tasks.length === 0) return null;
  return (
    <section>
      <SectionLabel
        trailing={<span className="text-xs tabular-nums text-slate-400 dark:text-neutral-500">{tasks.length}</span>}
      >
        Missed
      </SectionLabel>
      <ul className="space-y-2">
        {tasks.map((t) => (
          <li
            key={t.id}
            className="group relative flex items-center gap-3 overflow-hidden rounded-xl border border-rose-200 bg-white px-3 py-2 shadow-sm transition-shadow hover:shadow-md dark:border-rose-500/30 dark:bg-neutral-900/40"
          >
            <span aria-hidden className="absolute inset-y-0 left-0 w-[3px]" style={{ backgroundColor: t.color ?? 'transparent' }} />
            <TaskCheckbox checked={false} onChange={() => complete.mutate(t.id)} size={17} label="Mark as done" />
            <Link
              to={`/tasks?task=${t.id}`}
              className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-slate-800 hover:underline dark:text-neutral-100"
            >
              {t.content}
            </Link>
            <div className="flex shrink-0 items-center gap-1.5">
              {t.priority > 1 && <PriorityBadge priority={t.priority} />}
              <DueChip dueDate={t.dueDate} status={t.status} />
            </div>
            <button
              onClick={() => reschedule.mutate(t.id)}
              disabled={reschedule.isPending}
              className={`${iconBtn} opacity-0 group-hover:opacity-100`}
              title="Find a new slot"
              aria-label="Find a new slot"
            >
              <RotateCcw size={13} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---------------- rail: day progress ---------------- */

function ProgressStat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-2 py-1.5 text-center dark:bg-neutral-800/60">
      <div className={`text-base font-bold tabular-nums ${tone ?? 'text-slate-700 dark:text-neutral-200'}`}>{value}</div>
      <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:text-neutral-500">{label}</div>
    </div>
  );
}

function DayProgressCard({ daily }: { daily: DailyPlanDTO | undefined }) {
  const summary = daily?.summary;
  if (!summary || summary.plannedCount === 0) return null;
  const pct = Math.round((summary.doneCount / summary.plannedCount) * 100);
  return (
    <section className={railCard}>
      <SectionLabel trailing={<span className="text-xs tabular-nums text-slate-400 dark:text-neutral-500">{pct}%</span>}>
        Day progress
      </SectionLabel>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-neutral-800">
        <div className="h-full rounded-full bg-teal-500 transition-[width] duration-300" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <ProgressStat label="Done" value={summary.doneCount} tone="text-emerald-600 dark:text-emerald-400" />
        <ProgressStat
          label="Missed"
          value={summary.missedCount}
          tone={summary.missedCount > 0 ? 'text-rose-600 dark:text-rose-400' : undefined}
        />
        <ProgressStat label="Left" value={summary.remainingCount} />
      </div>
      <p className="mt-2 text-center text-xs text-slate-400 dark:text-neutral-500">
        {fmtDur(summary.completedMin)} focused of {fmtDur(summary.plannedMin)} planned
      </p>
    </section>
  );
}

/* ---------------- rail: objectives ---------------- */

function ObjectivesCard({ objectives, onOpen }: { objectives: ObjectiveDTO[]; onOpen?: () => void }) {
  const active = objectives.filter((o) => o.status !== 'done').slice(0, 4);
  if (active.length === 0) return null;
  return (
    <section className={railCard}>
      <SectionLabel
        trailing={
          onOpen && (
            <button onClick={onOpen} className="cursor-pointer text-xs font-medium text-teal-600 hover:underline dark:text-teal-400">
              All
            </button>
          )
        }
      >
        This week
      </SectionLabel>
      <ul className="space-y-3">
        {active.map((o) => {
          const usesCount = !o.targetMinutes && !!o.targetCount;
          const target = usesCount ? o.targetCount! : (o.targetMinutes ?? 0);
          const progress = usesCount ? o.progressCount : o.progressMinutes;
          const pct = target > 0 ? Math.min(100, Math.round((progress / target) * 100)) : 0;
          return (
            <li key={o.id}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="min-w-0 truncate text-slate-700 dark:text-neutral-200">{o.title}</span>
                {target > 0 && <span className="shrink-0 text-xs tabular-nums text-slate-400 dark:text-neutral-500">{pct}%</span>}
              </div>
              {target > 0 && (
                <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-neutral-800">
                  <div className="h-full rounded-full bg-teal-500 transition-[width] duration-300" style={{ width: `${pct}%` }} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ---------------- tomorrow ---------------- */

function Tomorrow({
  blocks,
  onPlan,
  onOpenTask,
  railRef,
}: {
  blocks: ScheduleItemDTO[];
  onPlan: () => void;
  onOpenTask?: (id: string | null) => void;
  railRef: RefObject<HTMLDivElement>;
}) {
  const tomorrowDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d;
  }, []);
  const schedulable = blocks.filter((b) => b.kind === 'task' || b.kind === 'habit');
  const hasBlocks = schedulable.length > 0;
  return (
    <section>
      <SectionLabel
        trailing={
          <span className="flex items-baseline gap-3">
            {hasBlocks && (
              <span className="text-xs tabular-nums text-slate-400 dark:text-neutral-500">
                {schedulable.length} block{schedulable.length === 1 ? '' : 's'}
              </span>
            )}
            <button
              onClick={onPlan}
              className="inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-teal-600 hover:text-teal-500 dark:text-teal-400"
            >
              Plan tomorrow <ArrowRight size={12} />
            </button>
          </span>
        }
      >
        Tomorrow
      </SectionLabel>
      <ScheduleCalendar
        filters={ALL_KINDS}
        priorities={NO_PRIORITIES}
        slotDuration="00:30:00"
        initialView="timeGridDay"
        initialDate={tomorrowDate}
        height="480px"
        onDatesSet={() => {}}
        railRef={railRef}
        onRailDragActive={() => {}}
        onOpenTask={onOpenTask}
      />
      {!hasBlocks && (
        <div className="mt-3 flex items-center justify-between rounded-xl border border-dashed border-slate-200 px-4 py-3 dark:border-neutral-800">
          <p className="text-sm text-slate-500 dark:text-neutral-400">Nothing planned yet.</p>
          <button
            onClick={onPlan}
            className="cursor-pointer rounded-md bg-teal-600 px-3.5 py-1.5 text-sm font-medium text-white transition-colors duration-150 hover:bg-teal-500"
          >
            Plan tomorrow
          </button>
        </div>
      )}
    </section>
  );
}

/* ---------------- page ---------------- */

export default function TodayView({
  onPlan,
  onOpenObjectives,
  onOpenTask,
}: {
  onPlan: () => void;
  onOpenObjectives?: () => void;
  onOpenTask?: (id: string | null) => void;
}) {
  const { data: plan, isLoading } = useTodayPlan();
  const { data: daily } = useDailyPlan();
  const railRef = useRef<HTMLDivElement>(null);
  const tomorrowRailRef = useRef<HTMLDivElement>(null);

  const blocks = useMemo(() => [...(plan?.blocks ?? [])].sort((a, b) => Date.parse(a.start) - Date.parse(b.start)), [plan?.blocks]);
  const missed = useMemo(() => {
    const map = new Map<string, TaskViewDTO>();
    for (const t of [...(plan?.missedToday ?? []), ...(plan?.missedYesterday ?? [])]) map.set(t.id, t);
    return [...map.values()];
  }, [plan?.missedToday, plan?.missedYesterday]);

  const schedulable = blocks.filter((b) => b.kind === 'task' || b.kind === 'habit');
  const doneCount = schedulable.filter((b) => b.status === 'done').length;

  const nowDate = new Date();
  const dateLabel = nowDate.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  if (isLoading || !plan) {
    return (
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="h-8 w-64 animate-pulse rounded-md bg-slate-100 dark:bg-neutral-800/60" />
        <div className="h-6 w-96 animate-pulse rounded-md bg-slate-100 dark:bg-neutral-800/60" />
        <div className="h-20 animate-pulse rounded-xl bg-slate-100 dark:bg-neutral-800/60" />
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="space-y-4">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="h-16 animate-pulse rounded-xl bg-slate-100 dark:bg-neutral-800/60" />
            ))}
          </div>
          <div className="h-64 animate-pulse rounded-xl bg-slate-100 dark:bg-neutral-800/60" />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl">
      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wider text-teal-600 dark:text-teal-400">{greeting(nowDate)}</p>
          <h1 className="mt-0.5 text-xl font-semibold tracking-tight text-slate-900 dark:text-neutral-50">{dateLabel}</h1>
          <HeaderStats plan={plan} doneCount={doneCount} totalCount={schedulable.length} />
        </div>
        <button
          onClick={onPlan}
          className="cursor-pointer rounded-md bg-teal-600 px-3.5 py-1.5 text-sm font-medium text-white transition-colors duration-150 hover:bg-teal-500"
        >
          {plan.plannedToday ? 'Re-plan day' : 'Plan day'}
        </button>
      </header>

      {/* Now / up next */}
      <div className="mt-5">
        <NowCard blocks={blocks} />
      </div>

      {/* Warnings */}
      {plan.warnings.length > 0 && (
        <div className="mt-4">
          <WarningsCard warnings={plan.warnings} />
        </div>
      )}

      {/* Main */}
      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
        <main className="min-w-0 space-y-8">
          <HighlightCard daily={daily} date={daily?.date ?? plan.date} blocks={blocks} />

          <Missed tasks={missed} />

          <section>
            <SectionLabel
              trailing={
                schedulable.length > 0 && (
                  <span className="text-xs tabular-nums text-slate-400 dark:text-neutral-500">
                    {schedulable.length} block{schedulable.length === 1 ? '' : 's'}
                  </span>
                )
              }
            >
              Schedule
            </SectionLabel>
            <QuickAddTask
              placeholder="Add a task for today…"
              defaults={{ dueDate: quickDateOptions()[0].date }}
              className="mb-3"
            />
            <ScheduleCalendar
              filters={ALL_KINDS}
              priorities={NO_PRIORITIES}
              slotDuration="00:30:00"
              initialView="timeGridDay"
              height="640px"
              onDatesSet={() => {}}
              railRef={railRef}
              onRailDragActive={() => {}}
              onOpenTask={onOpenTask}
            />
            {blocks.length === 0 && (
              <div className="mt-3 flex items-center justify-between rounded-xl border border-dashed border-slate-200 px-4 py-3 dark:border-neutral-800">
                <p className="text-sm text-slate-500 dark:text-neutral-400">Nothing scheduled today.</p>
                <button
                  onClick={onPlan}
                  className="cursor-pointer rounded-md bg-teal-600 px-3.5 py-1.5 text-sm font-medium text-white transition-colors duration-150 hover:bg-teal-500"
                >
                  Plan day
                </button>
              </div>
            )}
          </section>

          <Tomorrow blocks={plan.tomorrow} onPlan={onPlan} onOpenTask={onOpenTask} railRef={tomorrowRailRef} />
        </main>

        <aside className="min-w-0 space-y-4">
          <DayProgressCard daily={daily} />
          <ObjectivesCard objectives={plan.objectives} onOpen={onOpenObjectives} />
          <BriefCard />
          <ShutdownCard daily={daily} date={daily?.date ?? plan.date} />
        </aside>
      </div>
    </div>
  );
}
