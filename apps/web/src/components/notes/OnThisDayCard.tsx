import type { OnThisDayDTO } from '@timeblock/shared';

export default function OnThisDayCard({
  data,
  onOpenNote,
}: {
  data: OnThisDayDTO | undefined;
  onOpenNote: (id: string) => void;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white/80 p-3 dark:border-neutral-800 dark:bg-neutral-900/70">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900 dark:text-neutral-100">On This Day</p>
          <p className="text-xs text-slate-500 dark:text-neutral-400">Resurfacing notes from one week, one month, and one year back.</p>
        </div>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500 dark:bg-neutral-800 dark:text-neutral-400">{data?.date ?? '...'}</span>
      </div>
      <div className="mt-3 space-y-3">
        {data?.buckets.map((bucket) => (
          <section key={bucket.label}>
            <div className="mb-1 flex items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">{bucket.label}</p>
              <span className="text-[11px] text-slate-400 dark:text-neutral-500">{bucket.anchorDate}</span>
            </div>
            {bucket.notes.length === 0 ? (
              <p className="text-xs text-slate-400 dark:text-neutral-500">Nothing indexed for that day.</p>
            ) : (
              <div className="space-y-1.5">
                {bucket.notes.slice(0, 3).map((note) => (
                  <button
                    key={`${bucket.label}-${note.id}`}
                    onClick={() => onOpenNote(note.id)}
                    className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200/80 bg-slate-50/70 px-3 py-2 text-left hover:border-teal-200 hover:bg-white dark:border-neutral-800 dark:bg-neutral-950/70 dark:hover:border-teal-900 dark:hover:bg-neutral-950"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-800 dark:text-neutral-100">{note.title}</p>
                      <p className="truncate text-[11px] text-slate-400 dark:text-neutral-500">{note.folder || 'Vault root'}</p>
                    </div>
                    {note.openTasks > 0 && <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-teal-700 dark:bg-teal-500/10 dark:text-teal-300">{note.openTasks} open</span>}
                  </button>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
