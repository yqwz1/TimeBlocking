import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { CalendarPlus, Gauge, Link2, MapPin, Bell } from 'lucide-react';
import type { TaskDifficulty } from '@timeblock/shared';
import { useCreateEvent, useCreateTask, useScheduleTaskAt } from '../../hooks.js';
import { popoverVariants } from '../../lib/motion.js';

type Mode = 'task' | 'event';

const PRIORITIES: { value: 1 | 2 | 3 | 4; label: string; color: string }[] = [
  { value: 4, label: 'Urgent', color: 'text-rose-600 bg-rose-100 dark:text-rose-300 dark:bg-rose-500/15' },
  { value: 3, label: 'High', color: 'text-amber-600 bg-amber-100 dark:text-amber-300 dark:bg-amber-500/15' },
  { value: 2, label: 'Medium', color: 'text-sky-600 bg-sky-100 dark:text-sky-300 dark:bg-sky-500/15' },
  { value: 1, label: 'Low', color: 'text-slate-500 bg-slate-100 dark:text-neutral-400 dark:bg-neutral-800' },
];

const DIFFICULTIES: { value: TaskDifficulty; label: string }[] = [
  { value: 'easy', label: 'Easy' },
  { value: 'medium', label: 'Medium' },
  { value: 'hard', label: 'Hard' },
];

const SWATCHES: (string | null)[] = ['#f43f5e', '#f59e0b', '#10b981', '#0ea5e9', '#6366f1', '#0d9488', '#ec4899', null];

const REMINDERS: { value: number | null; label: string }[] = [
  { value: null, label: 'None' },
  { value: 0, label: 'At start' },
  { value: 5, label: '5m' },
  { value: 10, label: '10m' },
  { value: 15, label: '15m' },
  { value: 30, label: '30m' },
  { value: 60, label: '1h' },
];

/**
 * Drag-to-create: the user dragged out a time range on the calendar. They pick
 * Task (a scheduled to-do pinned to the slot) or Event (a fixed meeting with full
 * details). Either way the duration matches the dragged span.
 */
export default function CreateTaskPopover({
  start,
  end,
  anchor,
  onClose,
  onCreated,
}: {
  start: Date;
  end: Date;
  anchor: { x: number; y: number };
  onClose: () => void;
  onCreated?: (id: string) => void;
}) {
  const createTask = useCreateTask();
  const scheduleAt = useScheduleTaskAt();
  const createEvent = useCreateEvent();
  const inputRef = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<Mode>('task');
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<1 | 2 | 3 | 4>(1);
  const [difficulty, setDifficulty] = useState<TaskDifficulty | null>(null);
  const [color, setColor] = useState<string | null>(null);
  const [location, setLocation] = useState('');
  const [meetingUrl, setMeetingUrl] = useState('');
  const [description, setDescription] = useState('');
  const [reminderMin, setReminderMin] = useState<number | null>(null);

  const durationMin = Math.max(1, Math.round((end.getTime() - start.getTime()) / 60_000));
  const submitting = createTask.isPending || scheduleAt.isPending || createEvent.isPending;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async () => {
    const content = title.trim();
    if (!content || submitting) return;
    try {
      if (mode === 'task') {
        const created = await createTask.mutateAsync({ content, priority, durationMin });
        await scheduleAt.mutateAsync({
          id: created.id,
          startUtc: start.toISOString(),
          endUtc: end.toISOString(),
        });
        onCreated?.(created.id);
      } else {
        const created = await createEvent.mutateAsync({
          title: content,
          startUtc: start.toISOString(),
          endUtc: end.toISOString(),
          priority,
          difficulty,
          color,
          location: location.trim() || undefined,
          meetingUrl: meetingUrl.trim() || undefined,
          description: description.trim() || undefined,
          reminderMinutesBefore: reminderMin,
        });
        onCreated?.(`event:${created.id}`);
      }
      onClose();
    } catch {
      /* mutation errors surface through react-query; keep the popover open to retry */
    }
  };

  const fmt = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const rangeStr = `${fmt(start)} – ${fmt(end)}`;
  const durStr =
    durationMin >= 60
      ? `${Math.floor(durationMin / 60)}h${durationMin % 60 ? ` ${durationMin % 60}m` : ''}`
      : `${durationMin}m`;

  const width = 300;
  const left = Math.min(Math.max(12, anchor.x - width / 2), window.innerWidth - width - 12);
  const top = Math.max(12, Math.min(anchor.y + 8, window.innerHeight - 420));

  const inputCls =
    'w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-teal-400 focus:ring-2 focus:ring-teal-100 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus:ring-teal-500/20';

  return (
    <>
      <motion.div
        className="fixed inset-0 z-40"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      />
      <motion.div
        variants={popoverVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        style={{ left, top, transformOrigin: 'top center', width }}
        className="fixed z-50 flex max-h-[420px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-neutral-800 dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Mode toggle + time range */}
        <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2 dark:border-neutral-800">
          <div className="flex rounded-lg bg-slate-100 p-0.5 dark:bg-neutral-800">
            {(['task', 'event'] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold capitalize transition ${
                  mode === m
                    ? 'bg-white text-slate-800 shadow-sm dark:bg-neutral-700 dark:text-neutral-100'
                    : 'text-slate-500 hover:text-slate-700 dark:text-neutral-400 dark:hover:text-neutral-200'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
          <span className="text-[11px] tabular-nums text-slate-400 dark:text-neutral-500">
            {rangeStr} · {durStr}
          </span>
        </div>

        <div className="space-y-2.5 overflow-y-auto px-3 py-2.5">
          <input
            ref={inputRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && mode === 'task') {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder={mode === 'task' ? 'Task title…' : 'Event title…'}
            className={inputCls}
          />

          {/* Priority — both modes */}
          <div className="flex gap-1">
            {PRIORITIES.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => setPriority(p.value)}
                className={`flex-1 rounded px-1 py-1 text-[10px] font-bold transition ${
                  priority === p.value ? p.color : 'text-slate-400 hover:bg-slate-50 dark:text-neutral-500 dark:hover:bg-white/5'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {mode === 'event' && (
            <>
              {/* Difficulty */}
              <div className="flex items-center gap-1.5">
                <Gauge size={13} className="shrink-0 text-slate-400 dark:text-neutral-500" />
                <div className="flex flex-1 gap-1">
                  {DIFFICULTIES.map((d) => (
                    <button
                      key={d.value}
                      type="button"
                      onClick={() => setDifficulty(difficulty === d.value ? null : d.value)}
                      className={`flex-1 rounded border px-1 py-1 text-[10px] font-semibold transition ${
                        difficulty === d.value
                          ? 'border-teal-400 bg-teal-50 text-teal-700 dark:border-teal-500/50 dark:bg-teal-500/10 dark:text-teal-300'
                          : 'border-slate-200 text-slate-500 hover:bg-slate-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-white/5'
                      }`}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Color */}
              <div className="flex items-center gap-1.5">
                {SWATCHES.map((c, i) => (
                  <button
                    key={i}
                    type="button"
                    aria-label={c ? `Color ${c}` : 'No color'}
                    onClick={() => setColor(c)}
                    className={`h-5 w-5 rounded-full border transition ${
                      color === c ? 'ring-2 ring-offset-1 ring-slate-400 dark:ring-offset-neutral-900' : ''
                    } ${!c ? 'border-slate-300 bg-white dark:border-neutral-600 dark:bg-neutral-800' : 'border-transparent'}`}
                    style={c ? { background: c } : undefined}
                  />
                ))}
              </div>

              {/* Location */}
              <div className="flex items-center gap-1.5">
                <MapPin size={13} className="shrink-0 text-slate-400 dark:text-neutral-500" />
                <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Location" className={inputCls} />
              </div>

              {/* Meeting URL */}
              <div className="flex items-center gap-1.5">
                <Link2 size={13} className="shrink-0 text-slate-400 dark:text-neutral-500" />
                <input value={meetingUrl} onChange={(e) => setMeetingUrl(e.target.value)} placeholder="Meeting link (Zoom/Meet)" className={inputCls} />
              </div>

              {/* Description */}
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Notes / agenda…"
                rows={2}
                className={`${inputCls} resize-none`}
              />

              {/* Reminder */}
              <div className="flex items-center gap-1.5">
                <Bell size={13} className="shrink-0 text-slate-400 dark:text-neutral-500" />
                <div className="flex flex-1 flex-wrap gap-1">
                  {REMINDERS.map((r) => (
                    <button
                      key={String(r.value)}
                      type="button"
                      onClick={() => setReminderMin(r.value)}
                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold transition ${
                        reminderMin === r.value
                          ? 'bg-teal-500 text-white'
                          : 'bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700'
                      }`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="border-t border-slate-100 px-3 py-2.5 dark:border-neutral-800">
          <motion.button
            whileTap={{ scale: 0.98 }}
            disabled={!title.trim() || submitting}
            onClick={() => void submit()}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-teal-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-teal-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <CalendarPlus size={13} />
            {submitting ? 'Creating…' : mode === 'task' ? 'Create & schedule' : 'Create event'}
          </motion.button>
        </div>
      </motion.div>
    </>
  );
}
