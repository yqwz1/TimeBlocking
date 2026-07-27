import { useMemo, useState } from 'react';
import type { VaultTaskDTO } from '@timeblock/shared';
import { useToggleVaultTask, useVaultTasks } from '../../hooks/notes.js';

function TaskRow({
  task,
  onOpenNote,
}: {
  task: VaultTaskDTO;
  onOpenNote: (id: string) => void;
}) {
  const toggle = useToggleVaultTask();
  return (
    <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-neutral-800 dark:bg-neutral-950/60">
      <input
        type="checkbox"
        checked={task.completed}
        onChange={(event) => toggle.mutate({ id: task.id, completed: event.target.checked })}
        className="mt-1 h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
      />
      <div className="min-w-0 flex-1">
        <p className={`text-sm ${task.completed ? 'text-slate-400 line-through dark:text-neutral-500' : 'text-slate-800 dark:text-neutral-100'}`}>{task.text}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-400 dark:text-neutral-500">
          <button onClick={() => onOpenNote(task.noteId)} className="rounded-full border border-slate-200 px-2 py-0.5 text-slate-500 hover:bg-slate-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-900">
            {task.noteTitle}
          </button>
          {task.status && <span className="rounded-full bg-slate-100 px-2 py-0.5 dark:bg-neutral-800">{task.status}</span>}
          {task.due && <span>Due {task.due}</span>}
          {!!task.estimateMinutes && <span>{task.estimateMinutes} min</span>}
          {task.tags.slice(0, 3).map((tag) => <span key={`${task.id}-${tag}`}>#{tag}</span>)}
        </div>
      </div>
    </div>
  );
}

export default function TasksHubModal({
  onClose,
  onOpenNote,
}: {
  onClose: () => void;
  onOpenNote: (id: string) => void;
}) {
  const [status, setStatus] = useState<'open' | 'done' | 'all'>('open');
  const [view, setView] = useState<'grouped' | 'kanban'>('grouped');
  const [tag, setTag] = useState('');
  const [folder, setFolder] = useState('');
  const [due, setDue] = useState('');
  const query = useVaultTasks({ status, tag: tag.trim() || undefined, folder: folder.trim() || undefined, due: due || undefined });

  const tagSuggestions = useMemo(() => {
    const set = new Set<string>();
    for (const task of query.data?.tasks ?? []) for (const item of task.tags) set.add(item);
    return [...set].sort();
  }, [query.data]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/35 px-4 py-10" onClick={onClose}>
      <div className="flex h-[min(88vh,900px)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-2xl dark:border-neutral-800 dark:bg-neutral-900" onClick={(event) => event.stopPropagation()}>
        <div className="border-b border-slate-200 px-5 py-4 dark:border-neutral-800">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Phase 7</p>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-neutral-100">Vault Tasks Hub</h3>
            </div>
            <button onClick={onClose} className="rounded-xl border border-slate-200 px-3 py-1.5 text-sm text-slate-500 hover:bg-white dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-950">
              Close
            </button>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-[auto_auto_minmax(0,1fr)_minmax(0,1fr)_180px]">
            <select value={status} onChange={(event) => setStatus(event.target.value as typeof status)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950">
              <option value="open">Open tasks</option>
              <option value="done">Done tasks</option>
              <option value="all">All tasks</option>
            </select>
            <select value={view} onChange={(event) => setView(event.target.value as typeof view)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950">
              <option value="grouped">Group by note</option>
              <option value="kanban">Kanban</option>
            </select>
            <input value={tag} onChange={(event) => setTag(event.target.value)} list="vault-task-tags" placeholder="Filter by tag" className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950" />
            <input value={folder} onChange={(event) => setFolder(event.target.value)} placeholder="Filter by folder" className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950" />
            <input value={due} onChange={(event) => setDue(event.target.value)} type="date" className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950" />
          </div>
          <datalist id="vault-task-tags">
            {tagSuggestions.map((item) => <option key={item} value={item} />)}
          </datalist>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-5">
          {query.isLoading && <p className="text-sm text-slate-400 dark:text-neutral-500">Loading task index…</p>}
          {!query.isLoading && query.data && query.data.tasks.length === 0 && <p className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-400 dark:border-neutral-700 dark:text-neutral-500">No markdown tasks matched the current filters.</p>}
          {!query.isLoading && query.data && view === 'grouped' && (
            <div className="space-y-5">
              {query.data.groups.map((group) => (
                <section key={group.noteId}>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <button onClick={() => onOpenNote(group.noteId)} className="text-left text-sm font-semibold text-slate-800 hover:text-teal-700 dark:text-neutral-100 dark:hover:text-teal-300">
                      {group.noteTitle}
                    </button>
                    <span className="text-xs text-slate-400 dark:text-neutral-500">{group.tasks.length} task{group.tasks.length === 1 ? '' : 's'}</span>
                  </div>
                  <div className="space-y-2">
                    {group.tasks.map((task) => <TaskRow key={task.id} task={task} onOpenNote={onOpenNote} />)}
                  </div>
                </section>
              ))}
            </div>
          )}
          {!query.isLoading && query.data && view === 'kanban' && (
            <div className="flex items-start gap-4 overflow-x-auto pb-2">
              {query.data.board.map((column) => (
                <section key={column.status} className="min-w-[280px] flex-1 rounded-2xl border border-slate-200 bg-white/80 p-3 dark:border-neutral-800 dark:bg-neutral-950/70">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h4 className="text-sm font-semibold text-slate-800 capitalize dark:text-neutral-100">{column.label}</h4>
                    <span className="text-xs text-slate-400 dark:text-neutral-500">{column.tasks.length}</span>
                  </div>
                  <div className="space-y-2">
                    {column.tasks.map((task) => <TaskRow key={task.id} task={task} onOpenNote={onOpenNote} />)}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
