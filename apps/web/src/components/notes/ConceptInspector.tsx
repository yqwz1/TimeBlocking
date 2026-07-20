import { useMemo, useState } from 'react';
import { Ban, Check, GitMerge, X } from 'lucide-react';
import type { ConceptType } from '@timeblock/shared';
import { useBlacklistConcept, useConcepts, useMergeConcepts, useRenameConcept } from '../../hooks/notes';

export interface InspectorTarget {
  conceptId: string;
  name: string;
  type: ConceptType | null;
  mentions: number;
}

/**
 * Concept inspector (G3). Edits the concept CACHE only — never the notes. Merge/rename/blacklist mirror the
 * server operations; on success the graph query invalidates and the layer redraws.
 */
export default function ConceptInspector({ target, onClose }: { target: InspectorTarget; onClose: () => void }) {
  const { data: concepts } = useConcepts();
  const rename = useRenameConcept();
  const merge = useMergeConcepts();
  const blacklist = useBlacklistConcept();

  const current = concepts?.find((c) => c.id === target.conceptId);
  const [name, setName] = useState(target.name);
  const [mergeInto, setMergeInto] = useState('');

  const mergeOptions = useMemo(() => (concepts ?? []).filter((c) => c.id !== target.conceptId).sort((a, b) => a.name.localeCompare(b.name)), [concepts, target.conceptId]);

  const renameError = rename.error ? (rename.error as Error).message : null;
  const busy = rename.isPending || merge.isPending || blacklist.isPending;

  return (
    <div className="absolute right-0 top-0 bottom-0 z-30 flex w-72 flex-col border-l border-slate-200 bg-white shadow-xl dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-neutral-800">
        <div className="flex items-center gap-2">
          <span className="inline-block h-3 w-3 rotate-45 bg-purple-500" />
          <span className="text-sm font-semibold text-slate-800 dark:text-neutral-100">Concept</span>
        </div>
        <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-white/5" title="Close">
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <div>
          <div className="text-lg font-semibold text-slate-800 dark:text-neutral-100">{current?.name ?? target.name}</div>
          <div className="mt-0.5 text-xs text-slate-400 dark:text-neutral-500">
            {(current?.type ?? target.type) ?? 'concept'} · mentioned in {current?.mentionCount ?? target.mentions} note{(current?.mentionCount ?? target.mentions) === 1 ? '' : 's'}
          </div>
          {current && current.aliases.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {current.aliases.map((a) => (
                <span key={a} className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500 dark:bg-white/5 dark:text-neutral-400">
                  {a}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-slate-100 pt-3 dark:border-neutral-800">
          <label className="text-xs font-medium text-slate-500 dark:text-neutral-400">Rename</label>
          <div className="mt-1 flex gap-1">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            />
            <button
              onClick={() => rename.mutate({ id: target.conceptId, name }, { onSuccess: onClose })}
              disabled={busy || !name.trim() || name.trim() === (current?.name ?? target.name)}
              className="flex items-center gap-1 rounded-md bg-teal-600 px-2 py-1 text-xs text-white hover:bg-teal-700 disabled:opacity-40"
            >
              <Check size={13} /> Save
            </button>
          </div>
          {renameError && <div className="mt-1 text-[11px] text-red-500">{renameError}</div>}
        </div>

        <div className="border-t border-slate-100 pt-3 dark:border-neutral-800">
          <label className="text-xs font-medium text-slate-500 dark:text-neutral-400">Merge into another concept</label>
          <div className="mt-1 flex gap-1">
            <select
              value={mergeInto}
              onChange={(e) => setMergeInto(e.target.value)}
              className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            >
              <option value="">Choose…</option>
              {mergeOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.type})
                </option>
              ))}
            </select>
            <button
              onClick={() => merge.mutate({ id: target.conceptId, intoId: mergeInto }, { onSuccess: onClose })}
              disabled={busy || !mergeInto}
              className="flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              <GitMerge size={13} /> Merge
            </button>
          </div>
          <p className="mt-1 text-[11px] text-slate-400 dark:text-neutral-500">Moves this concept's mentions into the target and keeps its name as an alias.</p>
        </div>

        <div className="border-t border-slate-100 pt-3 dark:border-neutral-800">
          <button
            onClick={() => blacklist.mutate(target.conceptId, { onSuccess: onClose })}
            disabled={busy}
            className="flex w-full items-center justify-center gap-1 rounded-md border border-red-200 px-2 py-1.5 text-xs text-red-600 hover:bg-red-50 disabled:opacity-40 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-950/30"
          >
            <Ban size={13} /> Blacklist concept
          </button>
          <p className="mt-1 text-[11px] text-slate-400 dark:text-neutral-500">Removes it and never re-extracts it. Your notes are untouched.</p>
        </div>
      </div>
    </div>
  );
}
