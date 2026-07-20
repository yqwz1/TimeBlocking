import { DateTime } from 'luxon';
import { AnimatePresence, motion } from 'motion/react';
import { Link } from 'react-router-dom';
import { Check, FolderGit2, Hash, Repeat, Target } from 'lucide-react';
import type { ObjectiveDTO } from '@timeblock/shared';
import { useHabits, useObjectives, useProjects } from '../../hooks.js';
import { listItem, springs } from '../../lib/motion.js';

export function formatMinutes(min: number): string {
  if (min <= 0) return '0m';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export const LINK_ICON = { project: FolderGit2, label: Hash, habit: Repeat } as const;

function ObjectiveRow({ o, linkLabel }: { o: ObjectiveDTO; linkLabel: string | null }) {
  const usesCount = !o.targetMinutes && !!o.targetCount;
  const target = usesCount ? o.targetCount! : o.targetMinutes ?? 0;
  const progress = usesCount ? o.progressCount : o.progressMinutes;
  const pct = target > 0 ? Math.min(100, Math.round((progress / target) * 100)) : 0;
  const done = pct >= 100;

  // Minutes objectives can show "scheduled but not yet done" time as a lighter overlay.
  const plannedPct =
    !usesCount && target > 0 ? Math.min(100, Math.round((Math.max(o.plannedMinutes, progress) / target) * 100)) : pct;

  const remaining = Math.max(0, target - progress);
  const format = usesCount ? (n: number) => `${n}` : formatMinutes;
  const unit = usesCount ? (target === 1 ? 'item' : 'items') : '';

  const LinkIcon = o.linkKind ? LINK_ICON[o.linkKind] : null;

  return (
    <motion.li
      layout
      variants={listItem}
      initial="initial"
      animate="animate"
      exit="exit"
      className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 dark:border-neutral-800 dark:bg-neutral-800/30"
    >
      <div className="flex items-start justify-between gap-2.5">
        <div className="min-w-0">
          <p
            className={`text-[13px] font-semibold leading-snug ${
              done ? 'text-slate-500 line-through dark:text-neutral-500' : 'text-slate-800 dark:text-neutral-100'
            }`}
            title={o.title}
          >
            {o.title}
          </p>
          {o.linkKind && LinkIcon && (
            <span className="mt-1 inline-flex max-w-full items-center gap-1 truncate text-[11px] text-slate-400 dark:text-neutral-500">
              <LinkIcon size={11} className="shrink-0" />
              <span className="truncate">{linkLabel ?? o.linkValue ?? o.linkKind}</span>
            </span>
          )}
        </div>
        <span
          className={`inline-flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-bold tabular-nums ${
            done
              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
              : 'bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300'
          }`}
        >
          {done && <Check size={11} />}
          {pct}%
        </span>
      </div>

      {/* Progress: solid = done, lighter overlay = scheduled toward it */}
      <div className="relative mt-2.5 h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-neutral-700/60">
        {!usesCount && plannedPct > pct && (
          <motion.div
            className="absolute inset-y-0 left-0 rounded-full bg-teal-300/60 dark:bg-teal-500/30"
            initial={false}
            animate={{ width: `${plannedPct}%` }}
            transition={springs.soft}
          />
        )}
        <motion.div
          className={`absolute inset-y-0 left-0 rounded-full ${done ? 'bg-emerald-500' : 'bg-teal-500'}`}
          initial={false}
          animate={{ width: `${pct}%` }}
          transition={springs.soft}
        />
      </div>

      <div className="mt-2 flex items-center justify-between text-[11px] tabular-nums">
        <span className="font-medium text-slate-600 dark:text-neutral-300">
          {format(progress)}
          {unit && ` ${unit}`} <span className="text-slate-400 dark:text-neutral-500">of {format(target)}{unit && ` ${unit}`}</span>
        </span>
        {done ? (
          <span className="font-semibold text-emerald-600 dark:text-emerald-400">Complete</span>
        ) : (
          <span className="text-slate-400 dark:text-neutral-500">
            {format(remaining)}
            {usesCount ? ` ${remaining === 1 ? 'item' : 'items'}` : ''} left
          </span>
        )}
      </div>
    </motion.li>
  );
}

export default function WeeklyObjectivesPanel() {
  const weekStart = DateTime.now().startOf('week').toISODate() ?? undefined;
  const { data: objectives } = useObjectives(weekStart);
  const { data: projects } = useProjects();
  const { data: habits } = useHabits();
  const all = objectives ?? [];

  const linkLabelFor = (o: ObjectiveDTO): string | null => {
    if (!o.linkKind || !o.linkValue) return null;
    if (o.linkKind === 'project') return (projects ?? []).find((p) => p.id === o.linkValue)?.name ?? o.linkValue;
    if (o.linkKind === 'habit') return (habits ?? []).find((h) => h.id === o.linkValue)?.name ?? o.linkValue;
    return o.linkValue;
  };
  const active = all.filter((o) => o.status === 'active');
  const completed = all.filter((o) => o.status === 'done').length;

  if (active.length === 0 && completed === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center dark:border-neutral-700">
        <Target size={18} className="mx-auto text-slate-300 dark:text-neutral-600" />
        <p className="mt-1.5 text-xs text-slate-500 dark:text-neutral-400">No objectives this week</p>
        <Link
          to="/objectives"
          className="mt-1 inline-block text-xs font-medium text-teal-600 hover:underline dark:text-teal-400"
        >
          Set your focus →
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-slate-400 dark:text-neutral-500">
          {completed > 0 && `${completed} done · `}
          {active.length} active
        </span>
        <Link to="/objectives" className="text-[11px] font-semibold text-teal-600 hover:underline dark:text-teal-400">
          Manage
        </Link>
      </div>
      <ul className="space-y-2.5">
        <AnimatePresence initial={false}>
          {active.map((o) => (
            <ObjectiveRow key={o.id} o={o} linkLabel={linkLabelFor(o)} />
          ))}
        </AnimatePresence>
      </ul>
    </div>
  );
}
