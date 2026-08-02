import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Calendar, Clock, Flag, Gauge, Hash, Plus, Tag, X } from 'lucide-react';
import type { TaskDifficulty, TaskInput, TaskStatus } from '@timeblock/shared';
import { useCreateTask, useLabelColorMap, useProjects } from '../../hooks.js';
import { popoverVariants } from '../../lib/motion.js';
import { LabelChip, quickDateOptions, STATUS_DOT, STATUS_LABEL } from './taskDisplay.js';

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

const STATUSES: TaskStatus[] = ['backlog', 'todo', 'in_progress', 'done', 'cancelled'];

type Picker = 'date' | 'labels' | 'priority' | 'status' | 'duration' | 'difficulty' | null;

const pillBase =
  'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors';
const pillOff =
  'border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700 dark:border-neutral-700 dark:text-neutral-400 dark:hover:border-neutral-600 dark:hover:text-neutral-200';
const pillOn = 'border-teal-300 bg-teal-50 text-teal-700 dark:border-teal-500/50 dark:bg-teal-500/10 dark:text-teal-300';

export default function QuickAddTask({
  placeholder = 'Task name',
  defaults,
  className = '',
  onCreated,
}: {
  placeholder?: string;
  defaults?: Partial<TaskInput> & { status?: TaskStatus };
  className?: string;
  onCreated?: (id: string) => void;
}) {
  const create = useCreateTask();
  const labelColors = useLabelColorMap();
  const { data: projects } = useProjects();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [picker, setPicker] = useState<Picker>(null);
  const [value, setValue] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<TaskStatus>(defaults?.status ?? 'todo');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState<number | undefined>(undefined);
  const [durationMin, setDurationMin] = useState<number | undefined>(undefined);
  const [difficulty, setDifficulty] = useState<TaskDifficulty | undefined>(undefined);
  const [labels, setLabels] = useState<string[]>([]);
  const [labelInput, setLabelInput] = useState('');
  const [projectId, setProjectId] = useState<string>(defaults?.projectId ?? '');

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const reset = () => {
    setValue('');
    setDescription('');
    setStatus(defaults?.status ?? 'todo');
    setDueDate('');
    setPriority(undefined);
    setDurationMin(undefined);
    setDifficulty(undefined);
    setLabels([]);
    setLabelInput('');
    setProjectId(defaults?.projectId ?? '');
    setPicker(null);
    setOpen(false);
  };

  const submit = () => {
    const content = value.trim();
    if (!content) return;
    create.mutate(
      {
        content,
        description: description.trim() || undefined,
        status,
        dueDate: dueDate || undefined,
        priority,
        durationMin,
        difficulty,
        labels: labels.length ? labels : undefined,
        projectId: projectId || null,
        ...defaults,
      },
      { onSuccess: (t) => onCreated?.(t.id) },
    );
    reset();
  };

  const addLabel = () => {
    const l = labelInput.trim();
    if (!l) return;
    if (!labels.includes(l)) setLabels([...labels, l]);
    setLabelInput('');
  };

  const toggle = (p: Picker) => setPicker((cur) => (cur === p ? null : p));
  const showProjectPicker = !defaults?.parentId;

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      {!open && (
        <button type="button" onClick={() => setOpen(true)} className="flex w-full items-center gap-2 text-left">
          <Plus size={14} className="shrink-0 text-teal-500 dark:text-teal-400" />
          <span className="text-sm font-medium text-slate-400 dark:text-neutral-500">{placeholder}</span>
        </button>
      )}
      <AnimatePresence>
        {open && (
          <motion.div
            variants={popoverVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            style={{ originX: 0, originY: 0 }}
            className="absolute left-0 top-0 z-20 w-96 rounded-xl border border-slate-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-900"
          >
          <div className="space-y-1 px-3 pt-3">
            <input
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
                if (e.key === 'Escape') reset();
              }}
              placeholder="Task name"
              className="w-full border-none bg-transparent text-base font-semibold text-slate-900 outline-none placeholder:font-semibold placeholder:text-slate-400 dark:text-neutral-100 dark:placeholder:text-neutral-500"
            />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description"
              rows={3}
              className="w-full resize-y border-none bg-transparent text-sm text-slate-500 outline-none placeholder:text-slate-400 dark:text-neutral-400 dark:placeholder:text-neutral-600"
            />
          </div>

          <div className="flex flex-wrap gap-1.5 px-3 pb-3 pt-2">
            <button type="button" onClick={() => toggle('date')} className={`${pillBase} ${picker === 'date' || dueDate ? pillOn : pillOff}`}>
              <Calendar size={12} /> {dueDate || 'Date'}
            </button>
            <button type="button" onClick={() => toggle('labels')} className={`${pillBase} ${picker === 'labels' || labels.length > 0 ? pillOn : pillOff}`}>
              <Tag size={12} /> {labels.length > 0 ? `${labels.length} label${labels.length > 1 ? 's' : ''}` : 'Labels'}
            </button>
            <button type="button" onClick={() => toggle('priority')} className={`${pillBase} ${picker === 'priority' || priority ? pillOn : pillOff}`}>
              <Flag size={12} /> {priority ? PRIORITIES.find((p) => p.value === priority)?.label.split(' ')[0] : 'Priority'}
            </button>
            <button type="button" onClick={() => toggle('status')} className={`${pillBase} ${picker === 'status' ? pillOn : pillOff}`}>
              <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[status]}`} /> {STATUS_LABEL[status]}
            </button>
            <button type="button" onClick={() => toggle('duration')} className={`${pillBase} ${picker === 'duration' || durationMin ? pillOn : pillOff}`}>
              <Clock size={12} /> {durationMin ? `${durationMin}m` : 'Duration'}
            </button>
            <button type="button" onClick={() => toggle('difficulty')} className={`${pillBase} ${picker === 'difficulty' || difficulty ? pillOn : pillOff}`}>
              <Gauge size={12} /> {DIFFICULTIES.find((d) => d.value === difficulty)?.label ?? 'Difficulty'}
            </button>
          </div>

          {picker && (
            <div className="border-t border-slate-100 px-3 py-2.5 dark:border-neutral-800">
              {picker === 'date' && (
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap gap-1.5">
                    {quickDateOptions().map((o) => (
                      <button
                        key={o.label}
                        type="button"
                        onClick={() => setDueDate(o.date)}
                        className={`rounded-full border px-2 py-0.5 text-xs font-medium transition-colors ${
                          dueDate === o.date
                            ? 'border-teal-300 bg-teal-50 text-teal-700 dark:border-teal-500/50 dark:bg-teal-500/10 dark:text-teal-300'
                            : 'border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700 dark:border-neutral-700 dark:text-neutral-400 dark:hover:border-neutral-600 dark:hover:text-neutral-200'
                        }`}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="date"
                      autoFocus
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                      className="rounded-md border border-slate-200 px-2 py-1 text-sm outline-none focus:border-teal-300 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 [color-scheme:light] dark:[color-scheme:dark]"
                    />
                    {dueDate && (
                      <button type="button" onClick={() => setDueDate('')} className="text-xs text-slate-400 hover:text-red-500">
                        Clear
                      </button>
                    )}
                  </div>
                </div>
              )}

              {picker === 'labels' && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {labels.map((l) => (
                    <span key={l} className="flex items-center gap-1">
                      <LabelChip name={l} color={labelColors.get(l)} />
                      <button type="button" onClick={() => setLabels(labels.filter((x) => x !== l))} aria-label={`Remove ${l}`} className="text-slate-400 hover:text-red-500">
                        <X size={9} />
                      </button>
                    </span>
                  ))}
                  <input
                    autoFocus
                    value={labelInput}
                    onChange={(e) => setLabelInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addLabel();
                      }
                    }}
                    onBlur={addLabel}
                    placeholder="Type a label and press Enter"
                    className="min-w-[8rem] flex-1 rounded-md border border-slate-200 px-2 py-1 text-sm outline-none focus:border-teal-300 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                  />
                </div>
              )}

              {picker === 'priority' && (
                <div className="flex flex-col gap-1">
                  {PRIORITIES.map((p) => (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => {
                        setPriority(priority === p.value ? undefined : p.value);
                        setPicker(null);
                      }}
                      className={`flex items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-slate-50 dark:hover:bg-neutral-800 ${
                        priority === p.value ? 'font-semibold text-slate-900 dark:text-neutral-100' : 'text-slate-600 dark:text-neutral-300'
                      }`}
                    >
                      <span className={`h-2 w-2 shrink-0 rounded-full ${p.dot}`} />
                      {p.label}
                    </button>
                  ))}
                </div>
              )}

              {picker === 'status' && (
                <div className="flex flex-col gap-1">
                  {STATUSES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => {
                        setStatus(s);
                        setPicker(null);
                      }}
                      className={`flex items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-slate-50 dark:hover:bg-neutral-800 ${
                        status === s ? 'font-semibold text-slate-900 dark:text-neutral-100' : 'text-slate-600 dark:text-neutral-300'
                      }`}
                    >
                      <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[s]}`} />
                      {STATUS_LABEL[s]}
                    </button>
                  ))}
                </div>
              )}

              {picker === 'duration' && (
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    autoFocus
                    min={5}
                    step={5}
                    value={durationMin ?? ''}
                    onChange={(e) => setDurationMin(e.target.value ? Number(e.target.value) : undefined)}
                    placeholder="Minutes"
                    className="w-28 rounded-md border border-slate-200 px-2 py-1 text-sm outline-none focus:border-teal-300 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                  />
                  <span className="text-xs text-slate-400 dark:text-neutral-500">minutes</span>
                  {durationMin != null && (
                    <button type="button" onClick={() => setDurationMin(undefined)} className="text-xs text-slate-400 hover:text-red-500">
                      Clear
                    </button>
                  )}
                </div>
              )}

              {picker === 'difficulty' && (
                <div className="flex flex-col gap-1">
                  {DIFFICULTIES.map((d) => (
                    <button
                      key={d.value}
                      type="button"
                      onClick={() => {
                        setDifficulty(difficulty === d.value ? undefined : d.value);
                        setPicker(null);
                      }}
                      className={`flex items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-slate-50 dark:hover:bg-neutral-800 ${
                        difficulty === d.value ? 'font-semibold text-slate-900 dark:text-neutral-100' : 'text-slate-600 dark:text-neutral-300'
                      }`}
                    >
                      <span className={`h-2 w-2 shrink-0 rounded-full ${d.dot}`} />
                      {d.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-3 py-2.5 dark:border-neutral-800">
            {showProjectPicker ? (
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="max-w-[45%] truncate rounded-md border-none bg-transparent text-xs font-medium text-slate-500 outline-none dark:text-neutral-400"
              >
                <option value="">Inbox</option>
                {(projects ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <button type="button" onClick={reset} className="rounded-md px-2.5 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 dark:text-neutral-400 dark:hover:bg-neutral-800">
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={!value.trim() || create.isPending}
                className="rounded-md bg-teal-600 px-3 py-1 text-xs font-semibold text-white hover:bg-teal-500 disabled:opacity-40"
              >
                Add task
              </button>
            </div>
          </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
