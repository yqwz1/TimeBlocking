import { useEffect, useMemo, useRef, useState } from 'react';
import { FileText } from 'lucide-react';
import type { NoteSummaryDTO } from '@timeblock/shared';

/** Simple case-insensitive subsequence fuzzy match, scored by match compactness. */
function fuzzyScore(query: string, target: string): number | null {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  let first = -1;
  let last = -1;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      if (first < 0) first = ti;
      last = ti;
      qi++;
    }
  }
  if (qi < q.length) return null;
  return last - first;
}

export default function QuickSwitcher({
  notes,
  onSelect,
  onCreate,
  onClose,
}: {
  notes: NoteSummaryDTO[];
  onSelect: (id: string) => void;
  onCreate: (title: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const results = useMemo(() => {
    const scored = notes
      .map((n) => ({ n, score: fuzzyScore(query, n.title) }))
      .filter((r): r is { n: NoteSummaryDTO; score: number } => r.score !== null)
      .sort((a, b) => a.score - b.score)
      .slice(0, 50);
    return scored.map((r) => r.n);
  }, [notes, query]);

  const exactMatch = results.some((r) => r.title.toLowerCase() === query.trim().toLowerCase());

  function commit(i: number) {
    if (i < results.length) onSelect(results[i].id);
    else if (query.trim()) onCreate(query.trim());
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-24" onClick={onClose}>
      <div className="w-full max-w-lg overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-neutral-700 dark:bg-neutral-900" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setIndex((i) => Math.min(i + 1, results.length + (query.trim() && !exactMatch ? 1 : 0) - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setIndex((i) => Math.max(i - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              commit(index);
            } else if (e.key === 'Escape') {
              onClose();
            }
          }}
          placeholder="Jump to a note…"
          dir="auto"
          className="w-full border-b border-slate-200 px-4 py-3 text-sm outline-none dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
        />
        <div className="max-h-80 overflow-auto py-1">
          {results.map((n, i) => (
            <button
              key={n.id}
              onClick={() => commit(i)}
              className={`flex w-full items-center gap-2 px-4 py-2 text-left text-sm ${i === index ? 'bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300' : 'text-slate-700 dark:text-neutral-200'}`}
            >
              <FileText size={14} className="shrink-0 opacity-50" />
              <span className="truncate">{n.title}</span>
              <span className="ml-auto shrink-0 truncate text-xs opacity-40">{n.id}</span>
            </button>
          ))}
          {query.trim() && !exactMatch && (
            <button
              onClick={() => commit(results.length)}
              className={`flex w-full items-center gap-2 px-4 py-2 text-left text-sm ${index === results.length ? 'bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300' : 'text-slate-500 dark:text-neutral-400'}`}
            >
              Create note "{query.trim()}"
            </button>
          )}
          {results.length === 0 && !query.trim() && <p className="px-4 py-3 text-sm text-slate-400 dark:text-neutral-500">Type to search notes by title…</p>}
        </div>
      </div>
    </div>
  );
}
