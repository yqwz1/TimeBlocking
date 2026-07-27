import { useEffect, useMemo, useState } from 'react';
import { useNoteSnapshot, useNoteSnapshots, useRestoreNoteSnapshot } from '../../hooks/notes.js';

interface DiffRow {
  type: 'same' | 'added' | 'removed';
  left: string | null;
  right: string | null;
}

function buildDiffRows(current: string, snapshot: string): DiffRow[] {
  const left = current.replace(/\r\n/g, '\n').split('\n');
  const right = snapshot.replace(/\r\n/g, '\n').split('\n');
  const dp = Array.from({ length: left.length + 1 }, () => Array<number>(right.length + 1).fill(0));
  for (let i = left.length - 1; i >= 0; i--) {
    for (let j = right.length - 1; j >= 0; j--) {
      dp[i][j] = left[i] === right[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      rows.push({ type: 'same', left: left[i], right: right[j] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ type: 'removed', left: left[i], right: null });
      i++;
    } else {
      rows.push({ type: 'added', left: null, right: right[j] });
      j++;
    }
  }
  while (i < left.length) rows.push({ type: 'removed', left: left[i++], right: null });
  while (j < right.length) rows.push({ type: 'added', left: null, right: right[j++] });
  return rows;
}

function diffRowClass(type: DiffRow['type']): string {
  if (type === 'added') return 'bg-emerald-50 dark:bg-emerald-500/10';
  if (type === 'removed') return 'bg-rose-50 dark:bg-rose-500/10';
  return '';
}

export default function VersionHistoryModal({
  noteId,
  currentContent,
  onClose,
}: {
  noteId: string;
  currentContent: string;
  onClose: () => void;
}) {
  const snapshots = useNoteSnapshots(noteId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useNoteSnapshot(noteId, selectedId, !!selectedId);
  const restore = useRestoreNoteSnapshot();

  useEffect(() => {
    if (!selectedId && snapshots.data?.length) setSelectedId(snapshots.data[0].id);
  }, [selectedId, snapshots.data]);

  const rows = useMemo(() => buildDiffRows(currentContent, selected.data?.content ?? ''), [currentContent, selected.data?.content]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/35 px-4 py-10" onClick={onClose}>
      <div className="flex h-[calc(100dvh-5rem)] w-full max-w-7xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-neutral-800 dark:bg-neutral-900" onClick={(event) => event.stopPropagation()}>
        <aside className="flex w-80 shrink-0 flex-col border-r border-slate-200 dark:border-neutral-800">
          <div className="border-b border-slate-200 px-5 py-4 dark:border-neutral-800">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Phase 8</p>
                <h3 className="text-lg font-semibold text-slate-900 dark:text-neutral-100">Version History</h3>
              </div>
              <button onClick={onClose} className="rounded-xl border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-950">
                Close
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-3">
            {!snapshots.data?.length && !snapshots.isLoading && <p className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-400 dark:border-neutral-700 dark:text-neutral-500">No snapshots exist for this note yet.</p>}
            <div className="space-y-2">
              {snapshots.data?.map((snapshot) => (
                <button
                  key={snapshot.id}
                  type="button"
                  onClick={() => setSelectedId(snapshot.id)}
                  className={`w-full rounded-2xl border px-3 py-3 text-left transition ${
                    selectedId === snapshot.id
                      ? 'border-teal-300 bg-teal-50 text-teal-700 dark:border-teal-700 dark:bg-teal-500/10 dark:text-teal-300'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-950'
                  }`}
                >
                  <span className="block text-sm font-medium">{new Date(snapshot.createdAt).toLocaleString()}</span>
                  <span className="mt-1 block text-xs opacity-70">{Math.max(1, Math.round(snapshot.sizeBytes / 1024))} KB snapshot</span>
                </button>
              ))}
            </div>
          </div>
        </aside>
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-neutral-800">
            <div>
              <p className="text-sm font-medium text-slate-900 dark:text-neutral-100">{selected.data ? new Date(selected.data.createdAt).toLocaleString() : 'Select a snapshot'}</p>
              <p className="text-xs text-slate-400 dark:text-neutral-500">Current version on the left, snapshot on the right.</p>
            </div>
            {selectedId && (
              <button
                onClick={() =>
                  restore.mutate(
                    { id: noteId, snapshotId: selectedId },
                    {
                      onSuccess: () => onClose(),
                    },
                  )
                }
                disabled={restore.isPending}
                className="rounded-xl bg-teal-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {restore.isPending ? 'Restoring…' : 'Restore this snapshot'}
              </button>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-auto bg-slate-50 p-4 dark:bg-neutral-950">
            {!selectedId && <p className="text-sm text-slate-400 dark:text-neutral-500">Choose a snapshot to inspect its diff.</p>}
            {selectedId && selected.isLoading && <p className="text-sm text-slate-400 dark:text-neutral-500">Loading snapshot…</p>}
            {selected.data && (
              <div className="grid min-w-[52rem] grid-cols-2 gap-4">
                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
                  <div className="border-b border-slate-200 px-4 py-3 text-xs font-semibold uppercase tracking-[0.22em] text-slate-400 dark:border-neutral-800 dark:text-neutral-500">Current</div>
                  <pre className="overflow-auto px-4 py-3 text-[12px] leading-6 text-slate-700 dark:text-neutral-200">
                    {rows.map((row, index) => (
                      <div key={`left-${index}`} className={diffRowClass(row.type)}>
                        {row.left ?? ''}
                      </div>
                    ))}
                  </pre>
                </div>
                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
                  <div className="border-b border-slate-200 px-4 py-3 text-xs font-semibold uppercase tracking-[0.22em] text-slate-400 dark:border-neutral-800 dark:text-neutral-500">Snapshot</div>
                  <pre className="overflow-auto px-4 py-3 text-[12px] leading-6 text-slate-700 dark:text-neutral-200">
                    {rows.map((row, index) => (
                      <div key={`right-${index}`} className={diffRowClass(row.type)}>
                        {row.right ?? ''}
                      </div>
                    ))}
                  </pre>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
