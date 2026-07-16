import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { useGenerateBrief } from '../hooks.js';

/** Optional AI summary of today's plan — priorities, conflicts, what to tackle first. */
export default function BriefCard() {
  const brief = useGenerateBrief();
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  if (unavailable) return null;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/40">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-neutral-500">
          <Sparkles size={13} className="text-teal-500" aria-hidden />
          Daily brief
        </h3>
        <button
          onClick={() =>
            brief.mutate(undefined, {
              onError: (e) => {
                const msg = e instanceof Error ? e.message : String(e);
                if (msg.includes('501') || msg.toLowerCase().includes('not enabled')) setUnavailable(true);
                else setError(msg);
              },
              onSuccess: () => setError(null),
            })
          }
          disabled={brief.isPending}
          className="cursor-pointer rounded-md border border-teal-200 bg-teal-50 px-2.5 py-1 text-xs font-medium text-teal-700 transition-colors duration-150 hover:bg-teal-100 disabled:opacity-50 dark:border-teal-500/30 dark:bg-teal-500/10 dark:text-teal-300 dark:hover:bg-teal-500/20"
        >
          {brief.isPending ? 'Thinking…' : brief.data ? 'Regenerate' : 'Generate'}
        </button>
      </div>
      {error && <p className="mb-2 text-sm text-rose-500 dark:text-rose-400">{error}</p>}
      {brief.data ? (
        <p className="whitespace-pre-line text-sm leading-relaxed text-slate-600 dark:text-neutral-300">{brief.data.content}</p>
      ) : (
        <p className="text-sm text-slate-400 dark:text-neutral-500">
          A short AI summary of today's plan — priorities, conflicts, and what to tackle first.
        </p>
      )}
    </section>
  );
}
