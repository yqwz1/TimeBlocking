import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { useNoteSearch } from '../../hooks/notes.js';
import { highlightSnippet } from '../../lib/markdown.js';

export default function NoteSearchModal({ onSelect, onClose }: { onSelect: (id: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 150);
    return () => clearTimeout(t);
  }, [query]);

  const { data: results, isFetching } = useNoteSearch(debounced);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-24" onClick={onClose}>
      <div className="w-full max-w-xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-neutral-700 dark:bg-neutral-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-neutral-800">
          <Search size={15} className="shrink-0 text-slate-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              else if (e.key === 'Enter' && results?.[0]) {
                onSelect(results[0].id);
                onClose();
              }
            }}
            placeholder="Search titles and content across the vault…"
            dir="auto"
            className="w-full text-sm outline-none dark:bg-neutral-900 dark:text-neutral-100"
          />
        </div>
        <div className="max-h-96 overflow-auto py-1">
          {!query.trim() && <p className="px-4 py-3 text-sm text-slate-400 dark:text-neutral-500">Type to search — full text, not just titles.</p>}
          {query.trim() && isFetching && <p className="px-4 py-3 text-sm text-slate-400 dark:text-neutral-500">Searching…</p>}
          {query.trim() && !isFetching && results?.length === 0 && <p className="px-4 py-3 text-sm text-slate-400 dark:text-neutral-500">No matches.</p>}
          {results?.map((r) => (
            <button
              key={r.id}
              onClick={() => {
                onSelect(r.id);
                onClose();
              }}
              className="block w-full px-4 py-2 text-left hover:bg-slate-50 dark:hover:bg-white/5"
            >
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-medium text-slate-700 dark:text-neutral-200">{r.title}</span>
                {r.matchType === 'semantic' && (
                  <span className="rounded-full bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-600 dark:bg-violet-500/15 dark:text-violet-300">meaning match</span>
                )}
              </div>
              <div className="mt-0.5 truncate text-xs text-slate-400 dark:text-neutral-500" dangerouslySetInnerHTML={{ __html: highlightSnippet(r.snippet) }} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
