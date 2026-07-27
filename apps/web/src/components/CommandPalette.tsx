import { useEffect, useMemo, useRef, useState } from 'react';
import type { CommandPaletteCommand } from '../lib/commandPalette.js';

function scoreCommand(query: string, command: CommandPaletteCommand): number | null {
  if (!query.trim()) return 0;
  const haystack = [command.title, command.subtitle ?? '', ...(command.keywords ?? [])].join(' ').toLowerCase();
  const needle = query.trim().toLowerCase();
  const direct = haystack.indexOf(needle);
  if (direct >= 0) return direct;
  let qi = 0;
  let first = -1;
  let last = -1;
  for (let i = 0; i < haystack.length && qi < needle.length; i++) {
    if (haystack[i] === needle[qi]) {
      if (first < 0) first = i;
      last = i;
      qi++;
    }
  }
  if (qi < needle.length) return null;
  return last - first;
}

export default function CommandPalette({
  commands,
  onClose,
}: {
  commands: CommandPaletteCommand[];
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const results = useMemo(
    () =>
      commands
        .map((command) => ({ command, score: scoreCommand(query, command) }))
        .filter((item): item is { command: CommandPaletteCommand; score: number } => item.score !== null)
        .sort((a, b) => a.score - b.score || a.command.title.localeCompare(b.command.title))
        .map((item) => item.command),
    [commands, query],
  );

  useEffect(() => {
    if (index >= results.length) setIndex(Math.max(0, results.length - 1));
  }, [index, results.length]);

  const selected = results[index];

  function commit(command: CommandPaletteCommand | undefined) {
    if (!command) return;
    command.run();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/35 px-4 pt-20" onClick={onClose}>
      <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-neutral-800 dark:bg-neutral-900" onClick={(event) => event.stopPropagation()}>
        <div className="border-b border-slate-200 dark:border-neutral-800">
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setIndex((value) => Math.min(value + 1, Math.max(0, results.length - 1)));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setIndex((value) => Math.max(value - 1, 0));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                commit(selected);
              } else if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
              }
            }}
            placeholder="Run a command…"
            className="w-full bg-transparent px-5 py-4 text-sm outline-none dark:text-neutral-100"
          />
        </div>
        <div className="max-h-[28rem] overflow-auto py-2">
          {results.length === 0 && <p className="px-5 py-6 text-sm text-slate-400 dark:text-neutral-500">No commands match that search.</p>}
          {results.map((command, currentIndex) => (
            <button
              key={command.id}
              type="button"
              onClick={() => commit(command)}
              className={`flex w-full items-center justify-between gap-4 px-5 py-3 text-left ${
                currentIndex === index
                  ? 'bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300'
                  : 'text-slate-700 dark:text-neutral-200'
              }`}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{command.title}</span>
                {command.subtitle && <span className="block truncate text-xs opacity-70">{command.subtitle}</span>}
              </span>
              {command.shortcut && <kbd className="shrink-0 rounded-md border border-current/15 px-2 py-0.5 text-[11px] font-medium opacity-70">{command.shortcut}</kbd>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
