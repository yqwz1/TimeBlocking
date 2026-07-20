import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Bell,
  Calendar,
  Clock,
  CornerUpLeft,
  Download,
  Flag,
  FolderKanban,
  Gauge,
  Hash,
  Link2,
  ListTree,
  Lock,
  Paintbrush,
  Paperclip,
  Pin,
  Plus,
  Tag,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { TaskDifficulty, TaskLink, TaskStatus } from '@timeblock/shared';
import {
  useAddDependency,
  useAttachments,
  useCreateReminder,
  useDeleteAttachment,
  useDeleteReminder,
  useDeleteTask,
  useLabels,
  useProjects,
  useRemoveDependency,
  useReminders,
  useTaskDetail,
  useTaskList,
  useUpdateTask,
  useUploadAttachment,
} from '../../hooks.js';
import { popoverVariants, springs } from '../../lib/motion.js';
import QuickAddTask from './QuickAddTask.js';
import TaskCheckbox from './TaskCheckbox.js';
import { DueChip, LabelChip, PriorityBadge, quickDateOptions, STATUS_DOT, STATUS_LABEL } from './taskDisplay.js';

const SWATCHES = ['#f43f5e', '#f59e0b', '#10b981', '#0ea5e9', '#6366f1', '#0d9488', '#ec4899', null];
const STATUSES: TaskStatus[] = ['backlog', 'todo', 'in_progress', 'done', 'cancelled'];
const PRIORITIES = [
  { value: 4, label: 'Urgent', dot: 'bg-rose-500' },
  { value: 3, label: 'High', dot: 'bg-amber-500' },
  { value: 2, label: 'Medium', dot: 'bg-sky-500' },
  { value: 1, label: 'Low', dot: 'bg-slate-400' },
];

const DIFFICULTIES: { value: TaskDifficulty; label: string; dot: string }[] = [
  { value: 'easy', label: 'Easy', dot: 'bg-emerald-500' },
  { value: 'medium', label: 'Medium', dot: 'bg-amber-500' },
  { value: 'hard', label: 'Hard', dot: 'bg-rose-500' },
];

type Picker = 'status' | 'priority' | 'project' | 'date' | 'duration' | 'difficulty' | 'color' | null;

const pillBase =
  'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors';
const pillOff =
  'border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700 dark:border-neutral-700 dark:text-neutral-400 dark:hover:border-neutral-600 dark:hover:text-neutral-200';
const pillOn = 'border-teal-300 bg-teal-50 text-teal-700 dark:border-teal-500/50 dark:bg-teal-500/10 dark:text-teal-300';

function fmtBytes(n: number | null): string {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function LabelsEditor({ labels, onChange }: { labels: string[]; onChange: (l: string[]) => void }) {
  const { data: known } = useLabels();
  const [value, setValue] = useState('');
  return (
    <div>
      <div className="mb-1.5 flex flex-wrap gap-1.5">
        {labels.map((l) => (
          <span key={l} className="flex items-center gap-1">
            <LabelChip name={l} color={known?.find((k) => k.name === l)?.color} />
            <button type="button" onClick={() => onChange(labels.filter((x) => x !== l))} aria-label={`Remove ${l}`} className="text-slate-400 hover:text-red-500">
              <X size={10} />
            </button>
          </span>
        ))}
      </div>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && value.trim()) {
            e.preventDefault();
            if (!labels.includes(value.trim())) onChange([...labels, value.trim()]);
            setValue('');
          }
        }}
        list="tb-known-labels"
        placeholder="Type a label and press Enter"
        className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
      />
      <datalist id="tb-known-labels">
        {(known ?? []).map((l) => (
          <option key={l.id} value={l.name} />
        ))}
      </datalist>
    </div>
  );
}

function LinksEditor({ links, onChange }: { links: TaskLink[]; onChange: (l: TaskLink[]) => void }) {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  return (
    <div className="space-y-1.5">
      {links.map((l, i) => (
        <div key={i} className="flex items-center gap-1.5 rounded-md border border-slate-200 px-2 py-1 text-sm dark:border-neutral-700">
          <Link2 size={12} className="shrink-0 text-slate-400" />
          <a href={l.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-teal-600 hover:underline dark:text-teal-400">
            {l.title || l.url}
          </a>
          <button type="button" onClick={() => onChange(links.filter((_, j) => j !== i))} aria-label="Remove link" className="text-slate-400 hover:text-red-500">
            <X size={12} />
          </button>
        </div>
      ))}
      <div className="flex gap-1.5">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" className="w-24 rounded-md border border-slate-300 px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100" />
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" className="flex-1 rounded-md border border-slate-300 px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100" />
        <button
          type="button"
          onClick={() => {
            if (!url.trim()) return;
            onChange([...links, { url: url.trim(), title: title.trim() || undefined }]);
            setUrl('');
            setTitle('');
          }}
          className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
        >
          Add
        </button>
      </div>
    </div>
  );
}

function RemindersSection({ taskId }: { taskId: string }) {
  const { data: reminders } = useReminders(taskId);
  const create = useCreateReminder();
  const del = useDeleteReminder();
  const [custom, setCustom] = useState('');

  return (
    <div className="space-y-2">
      <ul className="space-y-1">
        {(reminders ?? []).map((r) => (
          <li key={r.id} className="flex items-center justify-between rounded-md border border-slate-200 px-2 py-1 text-xs dark:border-neutral-700">
            <span className="flex items-center gap-1.5 text-slate-600 dark:text-neutral-300">
              <Bell size={11} /> {new Date(r.remindAtUtc).toLocaleString()} {r.firedAt && <span className="text-slate-400">(fired)</span>}
            </span>
            <button type="button" onClick={() => del.mutate(r.id)} className="text-slate-400 hover:text-red-500">
              <X size={12} />
            </button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-1.5">
        <input
          type="datetime-local"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          className="rounded-md border border-slate-300 px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
        />
        <button
          type="button"
          disabled={!custom}
          onClick={() => {
            create.mutate({ taskId, input: { remindAtUtc: new Date(custom).toISOString() } });
            setCustom('');
          }}
          className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-200 disabled:opacity-50 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
        >
          <Plus size={11} className="inline" /> Remind me
        </button>
      </div>
    </div>
  );
}

function AttachmentsSection({ taskId }: { taskId: string }) {
  const { data: files } = useAttachments(taskId);
  const upload = useUploadAttachment();
  const del = useDeleteAttachment();
  const fileInput = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-2">
      <ul className="space-y-1">
        {(files ?? []).map((f) => (
          <li key={f.id} className="flex items-center justify-between rounded-md border border-slate-200 px-2 py-1 text-xs dark:border-neutral-700">
            <a href={`/api/attachments/${f.id}/file`} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-1.5 text-slate-600 hover:text-teal-600 dark:text-neutral-300 dark:hover:text-teal-400">
              <Download size={11} className="shrink-0" />
              <span className="truncate">{f.fileName}</span>
              <span className="shrink-0 text-slate-400">{fmtBytes(f.sizeBytes)}</span>
            </a>
            <button type="button" onClick={() => del.mutate(f.id)} className="shrink-0 text-slate-400 hover:text-red-500">
              <X size={12} />
            </button>
          </li>
        ))}
      </ul>
      <input
        ref={fileInput}
        type="file"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) upload.mutate({ taskId, file });
          e.target.value = '';
        }}
      />
      <button
        type="button"
        onClick={() => fileInput.current?.click()}
        disabled={upload.isPending}
        className="flex items-center gap-1.5 rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-200 disabled:opacity-50 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
      >
        <Upload size={11} /> {upload.isPending ? 'Uploading…' : 'Attach a file'}
      </button>
    </div>
  );
}

function DependsOnSection({
  taskId,
  dependsOn,
  onOpen,
}: {
  taskId: string;
  dependsOn: { id: string; content: string; status: TaskStatus }[];
  onOpen: (id: string) => void;
}) {
  const add = useAddDependency();
  const remove = useRemoveDependency();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const { data: results } = useTaskList({ q: query || undefined });

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const excludeIds = new Set([taskId, ...dependsOn.map((d) => d.id)]);
  const candidates = (results ?? []).filter((t) => !excludeIds.has(t.id)).slice(0, 8);

  return (
    <div>
      {dependsOn.length > 0 && (
        <ul className="mb-1.5 space-y-1">
          {dependsOn.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-2 rounded-md border border-slate-200 px-2 py-1 text-xs dark:border-neutral-700">
              <button
                type="button"
                onClick={() => onOpen(d.id)}
                className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-left text-slate-600 hover:text-teal-600 dark:text-neutral-300 dark:hover:text-teal-400"
              >
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[d.status]}`} />
                <span className={`truncate ${d.status === 'done' || d.status === 'cancelled' ? 'text-slate-400 line-through dark:text-neutral-500' : ''}`}>{d.content}</span>
              </button>
              <button
                type="button"
                onClick={() => remove.mutate({ taskId, blockerId: d.id })}
                aria-label={`Remove dependency on ${d.content}`}
                className="shrink-0 text-slate-400 hover:text-red-500"
              >
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div ref={rootRef} className="relative">
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setError(null);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search a task this one waits on…"
          className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
        />
        <AnimatePresence>
          {open && query && (
            <motion.div
              variants={popoverVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              style={{ transformOrigin: 'top left' }}
              className="absolute z-30 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-xl dark:border-neutral-800 dark:bg-neutral-900"
            >
              {candidates.length === 0 ? (
                <p className="px-2.5 py-1.5 text-xs text-slate-400 dark:text-neutral-500">No matching tasks</p>
              ) : (
                candidates.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      add.mutate(
                        { taskId, blockerId: c.id },
                        { onError: (err) => setError(err.message), onSuccess: () => setOpen(false) },
                      );
                      setQuery('');
                    }}
                    className="block w-full truncate px-2.5 py-1.5 text-left text-xs text-slate-600 hover:bg-slate-50 dark:text-neutral-300 dark:hover:bg-white/5"
                  >
                    {c.content}
                  </button>
                ))
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {error && <p className="mt-1 text-[11px] text-rose-500">{error}</p>}
    </div>
  );
}

export default function TaskEditorPanel({ taskId, onClose, onOpen }: { taskId: string; onClose: () => void; onOpen: (id: string) => void }) {
  const { data: task } = useTaskDetail(taskId);
  const { data: projects } = useProjects();
  const update = useUpdateTask();
  const del = useDeleteTask();
  const [content, setContent] = useState('');
  const [description, setDescription] = useState('');
  const [picker, setPicker] = useState<Picker>(null);

  useEffect(() => {
    if (task) {
      setContent(task.content);
      setDescription(task.description);
    }
  }, [task?.id, task?.content, task?.description]);

  const toggle = (p: Picker) => setPicker((cur) => (cur === p ? null : p));

  if (!task) {
    return (
      <>
        <div onClick={onClose} className="fixed inset-0 z-30" />
        <div className="pointer-events-none fixed inset-y-4 right-4 z-40 flex w-full max-w-md items-start justify-end">
          <div className="pointer-events-auto w-full rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-neutral-700 dark:bg-neutral-900">
            <p className="text-sm text-slate-400 dark:text-neutral-500">Loading…</p>
          </div>
        </div>
      </>
    );
  }

  const patch = (p: Parameters<typeof update.mutate>[0]['patch']) => update.mutate({ id: task.id, patch: p });
  const currentProjectName = projects?.find((p) => p.id === task.projectId)?.name ?? 'Inbox';

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 z-30" />
      <div className="pointer-events-none fixed inset-y-4 right-4 z-40 flex w-full max-w-md justify-end">
        <motion.div
          initial={{ x: 24, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 24, opacity: 0 }}
          transition={springs.snappy}
          onClick={(e) => e.stopPropagation()}
          className="pointer-events-auto flex max-h-full w-full flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-neutral-700 dark:bg-neutral-900"
        >
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-neutral-800">
            {task.parentId ? (
              <button type="button" onClick={() => onOpen(task.parentId!)} className="flex items-center gap-1 text-xs text-slate-400 hover:text-teal-600 dark:hover:text-teal-400">
                <CornerUpLeft size={12} /> Parent task
              </button>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => patch({ pinned: !task.pinned })}
                className={`rounded p-1.5 ${task.pinned ? 'text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-500/10' : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5'}`}
                aria-label={task.pinned ? 'Unpin task' : 'Pin task'}
                title={task.pinned ? 'Unpin task' : 'Pin task'}
              >
                <Pin size={14} fill={task.pinned ? 'currentColor' : 'none'} />
              </button>
              <button
                type="button"
                onClick={() => confirm(`Delete "${task.content}"? This can't be undone.`) && del.mutate(task.id, { onSuccess: onClose })}
                className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10"
                aria-label="Delete task"
              >
                <Trash2 size={14} />
              </button>
              <button type="button" onClick={onClose} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5" aria-label="Close">
                <X size={16} />
              </button>
            </div>
          </div>

          <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
            <div className="space-y-1">
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                onBlur={() => content.trim() && content !== task.content && patch({ content: content.trim() })}
                rows={2}
                className="w-full resize-none border-none bg-transparent text-lg font-semibold text-slate-900 outline-none dark:text-neutral-100"
              />
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onBlur={() => description !== task.description && patch({ description })}
                rows={2}
                placeholder="Description"
                className="w-full resize-none border-none bg-transparent text-sm text-slate-500 outline-none placeholder:text-slate-400 dark:text-neutral-400 dark:placeholder:text-neutral-600"
              />
            </div>

            <div className="flex flex-wrap gap-1.5">
              <button type="button" onClick={() => toggle('status')} className={`${pillBase} ${picker === 'status' ? pillOn : pillOff}`}>
                <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[task.status]}`} /> {STATUS_LABEL[task.status]}
              </button>
              <button type="button" onClick={() => toggle('priority')} className={`${pillBase} ${picker === 'priority' || task.priority ? pillOn : pillOff}`}>
                <Flag size={12} /> {PRIORITIES.find((p) => p.value === task.priority)?.label.split(' ')[0] ?? 'Priority'}
              </button>
              <button type="button" onClick={() => toggle('project')} className={`${pillBase} ${picker === 'project' || task.projectId ? pillOn : pillOff}`}>
                <FolderKanban size={12} /> {currentProjectName}
              </button>
              <button type="button" onClick={() => toggle('date')} className={`${pillBase} ${picker === 'date' || task.dueDate ? pillOn : pillOff}`}>
                <Calendar size={12} /> {task.dueDate || 'Date'}
              </button>
              <button type="button" onClick={() => toggle('duration')} className={`${pillBase} ${picker === 'duration' || task.durationMin ? pillOn : pillOff}`}>
                <Clock size={12} /> {task.durationMin ? `${task.durationMin}m` : 'Duration'}
              </button>
              <button type="button" onClick={() => toggle('difficulty')} className={`${pillBase} ${picker === 'difficulty' || task.difficulty ? pillOn : pillOff}`}>
                <Gauge size={12} /> {DIFFICULTIES.find((d) => d.value === task.difficulty)?.label ?? 'Difficulty'}
              </button>
              <button type="button" onClick={() => toggle('color')} className={`${pillBase} ${picker === 'color' || task.color ? pillOn : pillOff}`}>
                <Paintbrush size={12} /> {task.color ? <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: task.color }} /> : 'Color'}
              </button>
            </div>

            {picker && (
              <div className="-mt-2 rounded-lg border border-slate-100 px-3 py-2.5 dark:border-neutral-800">
                {picker === 'status' && (
                  <div className="flex flex-col gap-1">
                    {STATUSES.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => {
                          patch({ status: s });
                          setPicker(null);
                        }}
                        className={`flex items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-slate-50 dark:hover:bg-neutral-800 ${
                          task.status === s ? 'font-semibold text-slate-900 dark:text-neutral-100' : 'text-slate-600 dark:text-neutral-300'
                        }`}
                      >
                        <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[s]}`} />
                        {STATUS_LABEL[s]}
                      </button>
                    ))}
                  </div>
                )}

                {picker === 'priority' && (
                  <div className="flex flex-col gap-1">
                    {PRIORITIES.map((p) => (
                      <button
                        key={p.value}
                        type="button"
                        onClick={() => {
                          patch({ priority: p.value });
                          setPicker(null);
                        }}
                        className={`flex items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-slate-50 dark:hover:bg-neutral-800 ${
                          task.priority === p.value ? 'font-semibold text-slate-900 dark:text-neutral-100' : 'text-slate-600 dark:text-neutral-300'
                        }`}
                      >
                        <span className={`h-2 w-2 shrink-0 rounded-full ${p.dot}`} />
                        {p.label}
                      </button>
                    ))}
                  </div>
                )}

                {picker === 'project' && (
                  <div className="flex max-h-48 flex-col gap-1 overflow-y-auto">
                    <button
                      type="button"
                      onClick={() => {
                        patch({ projectId: null });
                        setPicker(null);
                      }}
                      className={`rounded-md px-2 py-1 text-left text-sm hover:bg-slate-50 dark:hover:bg-neutral-800 ${
                        !task.projectId ? 'font-semibold text-slate-900 dark:text-neutral-100' : 'text-slate-600 dark:text-neutral-300'
                      }`}
                    >
                      Inbox
                    </button>
                    {(projects ?? []).map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          patch({ projectId: p.id });
                          setPicker(null);
                        }}
                        className={`rounded-md px-2 py-1 text-left text-sm hover:bg-slate-50 dark:hover:bg-neutral-800 ${
                          task.projectId === p.id ? 'font-semibold text-slate-900 dark:text-neutral-100' : 'text-slate-600 dark:text-neutral-300'
                        }`}
                      >
                        {p.name}
                      </button>
                    ))}
                  </div>
                )}

                {picker === 'date' && (
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap gap-1.5">
                      {quickDateOptions().map((o) => (
                        <button
                          key={o.label}
                          type="button"
                          onClick={() => patch({ dueDate: o.date })}
                          className={`rounded-full border px-2 py-0.5 text-xs font-medium transition-colors ${
                            task.dueDate === o.date
                              ? 'border-teal-300 bg-teal-50 text-teal-700 dark:border-teal-500/50 dark:bg-teal-500/10 dark:text-teal-300'
                              : 'border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700 dark:border-neutral-700 dark:text-neutral-400 dark:hover:border-neutral-600 dark:hover:text-neutral-200'
                          }`}
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="date"
                      autoFocus
                      value={task.dueDate ?? ''}
                      onChange={(e) => patch({ dueDate: e.target.value || null })}
                      className="rounded-md border border-slate-200 px-2 py-1 text-sm outline-none focus:border-teal-300 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 [color-scheme:light] dark:[color-scheme:dark]"
                    />
                    <input
                      type="time"
                      value={task.dueDatetimeUtc ? new Date(task.dueDatetimeUtc).toISOString().slice(11, 16) : ''}
                      onChange={(e) => {
                        if (!e.target.value || !task.dueDate) return patch({ dueDatetimeUtc: null });
                        patch({ dueDatetimeUtc: new Date(`${task.dueDate}T${e.target.value}:00`).toISOString() });
                      }}
                      disabled={!task.dueDate}
                      className="rounded-md border border-slate-200 px-2 py-1 text-sm outline-none focus:border-teal-300 disabled:opacity-40 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 [color-scheme:light] dark:[color-scheme:dark]"
                    />
                    {task.dueDate && (
                      <button
                        type="button"
                        onClick={() => patch({ dueDate: null, dueDatetimeUtc: null })}
                        className="text-xs text-slate-400 hover:text-red-500"
                      >
                        Clear
                      </button>
                    )}
                    </div>
                  </div>
                )}

                {picker === 'duration' && (
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      autoFocus
                      min={5}
                      step={5}
                      value={task.durationMin ?? ''}
                      onChange={(e) => patch({ durationMin: e.target.value ? Number(e.target.value) : null })}
                      placeholder="Minutes"
                      className="w-28 rounded-md border border-slate-200 px-2 py-1 text-sm outline-none focus:border-teal-300 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                    />
                    <span className="text-xs text-slate-400 dark:text-neutral-500">minutes</span>
                    {task.durationMin != null && (
                      <button type="button" onClick={() => patch({ durationMin: null })} className="text-xs text-slate-400 hover:text-red-500">
                        Clear
                      </button>
                    )}
                  </div>
                )}

                {picker === 'difficulty' && (
                  <div className="flex flex-col gap-1">
                    <p className="px-2 pb-1 text-[11px] text-slate-400 dark:text-neutral-500">
                      Hard tasks are scheduled into your peak-focus hours; easy tasks into low-energy windows.
                    </p>
                    {DIFFICULTIES.map((d) => (
                      <button
                        key={d.value}
                        type="button"
                        onClick={() => {
                          patch({ difficulty: task.difficulty === d.value ? null : d.value });
                          setPicker(null);
                        }}
                        className={`flex items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-slate-50 dark:hover:bg-neutral-800 ${
                          task.difficulty === d.value ? 'font-semibold text-slate-900 dark:text-neutral-100' : 'text-slate-600 dark:text-neutral-300'
                        }`}
                      >
                        <span className={`h-2 w-2 shrink-0 rounded-full ${d.dot}`} />
                        {d.label}
                      </button>
                    ))}
                  </div>
                )}

                {picker === 'color' && (
                  <div className="flex gap-1.5">
                    {SWATCHES.map((c) => (
                      <button
                        key={c ?? 'none'}
                        type="button"
                        onClick={() => {
                          patch({ color: c });
                          setPicker(null);
                        }}
                        aria-label={c ?? 'No color'}
                        className={`h-6 w-6 rounded-full border border-slate-300 ring-offset-1 dark:border-neutral-600 dark:ring-offset-neutral-900 ${task.color === c ? 'ring-2 ring-slate-900 dark:ring-white' : ''}`}
                        style={{ backgroundColor: c ?? 'transparent' }}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            <div>
              <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-neutral-400">
                <Tag size={12} /> Labels
              </span>
              <LabelsEditor labels={task.labels} onChange={(labels) => patch({ labels })} />
            </div>

            <div>
              <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-neutral-400">
                <Link2 size={12} /> Links
              </span>
              <LinksEditor links={task.links} onChange={(links) => patch({ links })} />
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-neutral-400">
                  <ListTree size={12} /> Subtasks
                </span>
                {task.subtaskCount > 0 && (
                  <span className="text-[11px] font-medium tabular-nums text-slate-400 dark:text-neutral-500">
                    {task.subtaskDoneCount}/{task.subtaskCount} done
                  </span>
                )}
              </div>

              {task.subtaskCount > 0 && (
                <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-neutral-800">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all duration-300 dark:bg-emerald-400"
                    style={{ width: `${Math.round((task.subtaskDoneCount / task.subtaskCount) * 100)}%` }}
                  />
                </div>
              )}

              {task.children.length > 0 && (
                <div className="relative mb-2 pl-1">
                  <div className="absolute left-1 top-0 bottom-4 w-px bg-slate-200 dark:bg-neutral-700" />
                  <ul className="space-y-1">
                    {task.children.map((c) => {
                      const done = c.status === 'done';
                      return (
                        <li key={c.id} className="relative pl-5">
                          <span className="absolute left-1 top-1/2 h-px w-4 -translate-y-1/2 bg-slate-200 dark:bg-neutral-700" />
                          <div className="group flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-slate-50 dark:hover:bg-neutral-800/50">
                            <TaskCheckbox
                              size={16}
                              checked={done}
                              onChange={() => update.mutate({ id: c.id, patch: { status: done ? 'todo' : 'done' } })}
                            />
                            <button
                              type="button"
                              onClick={() => onOpen(c.id)}
                              className={`flex-1 truncate text-left ${done ? 'text-slate-400 line-through dark:text-neutral-500' : 'text-slate-700 dark:text-neutral-200'}`}
                            >
                              {c.content}
                            </button>
                            <div className="flex shrink-0 items-center gap-1.5">
                              {!done && c.dueDate && <DueChip dueDate={c.dueDate} status={c.status} />}
                              {!done && c.priority > 1 && <PriorityBadge priority={c.priority} />}
                              <button
                                type="button"
                                onClick={() => del.mutate(c.id)}
                                aria-label="Delete subtask"
                                className="rounded p-1 text-slate-300 opacity-0 transition-opacity hover:bg-rose-50 hover:text-rose-500 group-hover:opacity-100 dark:text-neutral-600 dark:hover:bg-rose-500/10 dark:hover:text-rose-400"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              <QuickAddTask placeholder="Add subtask…" defaults={{ parentId: task.id, projectId: task.projectId ?? undefined }} className="rounded-lg border border-dashed border-slate-300 px-2.5 py-2 text-slate-500 transition-colors hover:border-slate-400 dark:border-neutral-700 dark:hover:border-neutral-600" />

              {task.subtaskCount > 0 && (
                <p className="mt-1.5 text-[11px] text-slate-400 dark:text-neutral-500">Adding a subtask moves scheduling from this task to its subtasks.</p>
              )}
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-neutral-400">
                  <Lock size={12} /> Depends on
                </span>
                {task.isBlocked && (
                  <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">Blocked</span>
                )}
              </div>
              {task.isBlocked && (
                <p className="mb-1.5 text-[11px] text-slate-400 dark:text-neutral-500">
                  Won't be scheduled until every task below is done.
                </p>
              )}
              <DependsOnSection taskId={task.id} dependsOn={task.dependsOn} onOpen={onOpen} />
              {task.blocks.length > 0 && (
                <div className="mt-2">
                  <p className="mb-1 text-[11px] text-slate-400 dark:text-neutral-500">
                    Blocks {task.blocks.length} task{task.blocks.length > 1 ? 's' : ''}:
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {task.blocks.map((b) => (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => onOpen(b.id)}
                        className="rounded-full border border-slate-200 px-2 py-0.5 text-[11px] text-slate-500 hover:border-teal-300 hover:text-teal-600 dark:border-neutral-700 dark:text-neutral-400 dark:hover:border-teal-500/50 dark:hover:text-teal-400"
                      >
                        {b.content}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div>
              <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-neutral-400">
                <Bell size={12} /> Reminders
              </span>
              <RemindersSection taskId={task.id} />
            </div>

            <div>
              <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-neutral-400">
                <Paperclip size={12} /> Attachments
              </span>
              <AttachmentsSection taskId={task.id} />
            </div>
          </div>
        </motion.div>
      </div>
    </>
  );
}
