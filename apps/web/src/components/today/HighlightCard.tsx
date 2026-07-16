import { useEffect, useState } from 'react';
import { Star } from 'lucide-react';
import type { DailyPlanDTO, ScheduleItemDTO } from '@timeblock/shared';
import { useUpdateHighlight } from '../../hooks.js';
import TaskCheckbox from '../tasks/TaskCheckbox.js';

/**
 * The one thing that matters most today (Make Time / Sunsama "highlight").
 * Pick from today's scheduled tasks or type a free-form intention.
 */
export default function HighlightCard({ daily, date, blocks }: { daily: DailyPlanDTO | undefined; date: string; blocks: ScheduleItemDTO[] }) {
  const update = useUpdateHighlight();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const highlight = daily?.highlight ?? '';
  const done = daily?.highlightDone ?? false;
  const hasHighlight = highlight.trim().length > 0;

  useEffect(() => {
    if (!editing) setDraft(highlight);
  }, [highlight, editing]);

  const taskOptions = blocks.filter((b) => b.kind === 'task' && b.title);

  const save = (highlightText: string, taskId: string | null) => {
    update.mutate({ date, patch: { highlight: highlightText.trim(), highlightTaskId: taskId, highlightDone: false } });
    setEditing(false);
  };

  return (
    <section className="flex items-start gap-3 rounded-xl border border-amber-200/80 bg-amber-50/40 px-4 py-3.5 dark:border-amber-500/20 dark:bg-amber-500/[0.05]">
      <Star
        size={16}
        className={`mt-0.5 shrink-0 ${hasHighlight && done ? 'text-amber-500' : 'text-amber-400'}`}
        fill={hasHighlight && done ? 'currentColor' : 'none'}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-amber-600/80 dark:text-amber-400/80">Today's highlight</h3>
          {hasHighlight && !editing && (
            <button
              onClick={() => setEditing(true)}
              className="cursor-pointer text-xs font-medium text-slate-400 hover:text-slate-600 dark:text-neutral-500 dark:hover:text-neutral-300"
            >
              Change
            </button>
          )}
        </div>

        {!hasHighlight && !editing ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <p className="text-sm text-slate-500 dark:text-neutral-400">What's the one thing that would make today a win?</p>
            <button
              onClick={() => {
                setDraft('');
                setEditing(true);
              }}
              className="cursor-pointer rounded-md bg-amber-500 px-2.5 py-1 text-xs font-semibold text-white transition-colors duration-150 hover:bg-amber-400"
            >
              Set highlight
            </button>
            {taskOptions.slice(0, 2).map((t) => (
              <button
                key={t.id}
                onClick={() => save(t.title, t.taskId ?? null)}
                title="Use this scheduled task as your highlight"
                className="max-w-[14rem] cursor-pointer truncate rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 transition-colors duration-150 hover:border-amber-300 hover:text-slate-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:border-amber-500/50 dark:hover:text-neutral-100"
              >
                {t.title}
              </button>
            ))}
          </div>
        ) : editing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (draft.trim()) save(draft, null);
            }}
            className="mt-2"
          >
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="e.g. Finish the Q3 proposal draft"
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-amber-400 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-600"
            />
            {taskOptions.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {taskOptions.slice(0, 4).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setDraft(t.title)}
                    className="max-w-[14rem] cursor-pointer truncate rounded-full border border-slate-200 px-2.5 py-0.5 text-xs text-slate-500 hover:border-amber-300 hover:text-slate-700 dark:border-neutral-700 dark:text-neutral-400 dark:hover:border-amber-500/50 dark:hover:text-neutral-200"
                  >
                    {t.title}
                  </button>
                ))}
              </div>
            )}
            <div className="mt-2.5 flex gap-2">
              <button
                type="submit"
                disabled={!draft.trim() || update.isPending}
                className="cursor-pointer rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors duration-150 hover:bg-amber-400 disabled:opacity-50"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="cursor-pointer rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                Cancel
              </button>
              {hasHighlight && (
                <button
                  type="button"
                  onClick={() => save('', null)}
                  className="ml-auto cursor-pointer rounded-md px-3 py-1.5 text-xs text-slate-400 hover:text-rose-500 dark:text-neutral-500 dark:hover:text-rose-400"
                >
                  Clear
                </button>
              )}
            </div>
          </form>
        ) : (
          <div className="mt-1.5 flex items-center gap-2.5">
            <TaskCheckbox
              checked={done}
              onChange={() => update.mutate({ date, patch: { highlightDone: !done } })}
              size={17}
              label={done ? 'Mark highlight as not done' : 'Mark highlight as done'}
            />
            <span
              className={`min-w-0 truncate text-[15px] font-medium ${
                done ? 'text-slate-400 line-through dark:text-neutral-500' : 'text-slate-900 dark:text-neutral-50'
              }`}
            >
              {highlight}
            </span>
          </div>
        )}
      </div>
    </section>
  );
}
