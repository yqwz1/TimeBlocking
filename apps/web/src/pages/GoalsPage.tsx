import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { DateTime } from 'luxon';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Flag,
  Minus,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  Trophy,
  Undo2,
  X,
} from 'lucide-react';
import type { GoalDTO, GoalInput } from '@timeblock/shared';
import {
  useCreateGoal,
  useCreateGoalMilestone,
  useDeleteGoal,
  useDeleteGoalMilestone,
  useGoals,
  useProjects,
  useReorderGoalMilestones,
  useUpdateGoal,
  useUpdateGoalMilestone,
} from '../hooks.js';
import { formatMinutes, LINK_ICON } from '../components/rail/WeeklyObjectivesPanel.js';
import { listItem, springs } from '../lib/motion.js';

const QUARTERS = [1, 2, 3, 4] as const;

const inputCls =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 transition-shadow focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/25 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder:text-neutral-500';

const fieldLabelCls = 'mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-neutral-300';

const iconBtnCls =
  'cursor-pointer rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40 dark:hover:bg-white/5 dark:hover:text-neutral-300';

function emptyGoalInput(year: number, quarter: number): GoalInput {
  return {
    title: '',
    description: '',
    targetValue: null,
    targetUnit: null,
    achievable: '',
    relevance: '',
    year,
    quarter,
    customDeadline: null,
    linkKind: null,
    linkValue: null,
  };
}

interface GoalDisplay {
  milestonePct: number | null;
  measurablePct: number | null;
  measurableProgress: number;
  headlinePct: number | null;
}

function computeGoalDisplay(g: GoalDTO): GoalDisplay {
  const totalMilestones = g.milestones.length;
  const doneMilestones = g.milestones.filter((m) => m.done).length;
  const milestonePct = totalMilestones > 0 ? Math.round((doneMilestones / totalMilestones) * 100) : null;

  const measurableProgress = g.linkKind ? Math.max(g.currentValue, g.progressCount) : g.currentValue;
  const measurablePct = g.targetValue ? Math.min(100, Math.round((measurableProgress / g.targetValue) * 100)) : null;

  const headlinePct =
    milestonePct != null && measurablePct != null
      ? Math.round((milestonePct + measurablePct) / 2)
      : (milestonePct ?? measurablePct);

  return { milestonePct, measurablePct, measurableProgress, headlinePct };
}

function isBehindPace(g: GoalDTO, headlinePct: number | null): boolean {
  return g.status === 'active' && headlinePct != null && g.periodElapsedPct > 15 && headlinePct + 12 < g.periodElapsedPct;
}

/* ---------- small building blocks ---------- */

function SmartChip({ letter, title }: { letter: string; title: string }) {
  return (
    <span
      title={title}
      className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-teal-100 text-[10px] font-bold text-teal-700 dark:bg-teal-500/15 dark:text-teal-300"
    >
      {letter}
    </span>
  );
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="group flex cursor-pointer items-center gap-2.5 rounded-md py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
    >
      <span
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
          checked ? 'bg-teal-600' : 'bg-slate-300 group-hover:bg-slate-400 dark:bg-neutral-700 dark:group-hover:bg-neutral-600'
        }`}
      >
        <motion.span
          className="absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow-sm"
          initial={false}
          animate={{ x: checked ? 16 : 0 }}
          transition={springs.snappy}
        />
      </span>
      <span className="text-sm text-slate-600 dark:text-neutral-300">{label}</span>
    </button>
  );
}

function QuarterPills({ value, onChange }: { value: number; onChange: (q: number) => void }) {
  return (
    <div className="inline-flex rounded-lg bg-slate-100 p-0.5 dark:bg-neutral-800" role="radiogroup" aria-label="Quarter">
      {QUARTERS.map((q) => (
        <button
          key={q}
          type="button"
          role="radio"
          aria-checked={value === q}
          onClick={() => onChange(q)}
          className={`cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40 ${
            value === q
              ? 'bg-white text-teal-700 shadow-sm dark:bg-neutral-700 dark:text-teal-300'
              : 'text-slate-500 hover:text-slate-700 dark:text-neutral-400 dark:hover:text-neutral-200'
          }`}
        >
          Q{q}
        </button>
      ))}
    </div>
  );
}

function YearStepper({ value, onChange }: { value: number; onChange: (y: number) => void }) {
  return (
    <div className="flex items-center rounded-lg border border-slate-300 dark:border-neutral-700">
      <button
        type="button"
        aria-label="Previous year"
        onClick={() => onChange(value - 1)}
        className="cursor-pointer rounded-l-lg px-2 py-2 text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40 dark:hover:bg-white/5 dark:hover:text-neutral-300"
      >
        <ChevronLeft size={14} />
      </button>
      <span className="w-12 text-center text-sm font-medium tabular-nums text-slate-800 dark:text-neutral-100">{value}</span>
      <button
        type="button"
        aria-label="Next year"
        onClick={() => onChange(value + 1)}
        className="cursor-pointer rounded-r-lg px-2 py-2 text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40 dark:hover:bg-white/5 dark:hover:text-neutral-300"
      >
        <ChevronRight size={14} />
      </button>
    </div>
  );
}

function ProgressRing({
  pct,
  tone,
  size = 52,
}: {
  pct: number;
  tone: 'teal' | 'amber' | 'emerald' | 'slate';
  size?: number;
}) {
  const strokeW = size >= 48 ? 4.5 : 3.5;
  const r = size / 2 - strokeW - 1;
  const c = 2 * Math.PI * r;
  const stroke = {
    teal: 'stroke-teal-500',
    amber: 'stroke-amber-500',
    emerald: 'stroke-emerald-500',
    slate: 'stroke-slate-300 dark:stroke-neutral-600',
  }[tone];
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={`${pct}% complete`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={strokeW} className="stroke-slate-100 dark:stroke-neutral-800" />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={strokeW}
          strokeLinecap="round"
          className={stroke}
          strokeDasharray={c}
          initial={false}
          animate={{ strokeDashoffset: c - (Math.min(100, pct) / 100) * c }}
          transition={springs.soft}
        />
      </svg>
      <span
        className={`absolute inset-0 flex items-center justify-center font-semibold tabular-nums text-slate-700 dark:text-neutral-200 ${
          size >= 48 ? 'text-[11px]' : 'text-[9px]'
        }`}
      >
        {pct}%
      </span>
    </div>
  );
}

/* ---------- goal form modal ---------- */

function GoalFormModal({
  initial,
  defaultYear,
  defaultQuarter,
  onDone,
}: {
  initial?: GoalDTO;
  defaultYear: number;
  defaultQuarter: number;
  onDone: () => void;
}) {
  const { data: projects } = useProjects();
  const create = useCreateGoal();
  const update = useUpdateGoal();
  const createM = useCreateGoalMilestone();
  const [form, setForm] = useState<GoalInput>(() =>
    initial
      ? {
          title: initial.title,
          description: initial.description,
          targetValue: initial.targetValue,
          targetUnit: initial.targetUnit,
          achievable: initial.achievable,
          relevance: initial.relevance,
          year: initial.year,
          quarter: initial.quarter,
          customDeadline: initial.customDeadline,
          linkKind: initial.linkKind,
          linkValue: initial.linkValue,
        }
      : emptyGoalInput(defaultYear, defaultQuarter),
  );
  const [hasTarget, setHasTarget] = useState(!!initial?.targetValue);
  const [hasCustomDeadline, setHasCustomDeadline] = useState(!!initial?.customDeadline);
  const [showDetails, setShowDetails] = useState(!!(initial?.achievable || initial?.relevance));
  const [milestoneTitles, setMilestoneTitles] = useState<string[]>([]);
  const [milestoneDraft, setMilestoneDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof GoalInput>(key: K, value: GoalInput[K]) => setForm((f) => ({ ...f, [key]: value }));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDone();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDone]);

  const deadlinePreview =
    hasCustomDeadline && form.customDeadline
      ? DateTime.fromISO(form.customDeadline).toFormat('MMM d, yyyy')
      : DateTime.fromObject({ year: form.year, month: form.quarter * 3, day: 1 }).endOf('month').toFormat('MMM d, yyyy');

  const addMilestoneDraft = () => {
    const t = milestoneDraft.trim();
    if (!t) return;
    setMilestoneTitles((list) => [...list, t]);
    setMilestoneDraft('');
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const input: GoalInput = {
      ...form,
      targetValue: hasTarget ? form.targetValue : null,
      targetUnit: hasTarget ? form.targetUnit : null,
      customDeadline: hasCustomDeadline ? form.customDeadline : null,
    };
    setSaving(true);
    try {
      if (initial) {
        await update.mutateAsync({ id: initial.id, patch: input });
      } else {
        const created = await create.mutateAsync(input);
        const pending = [...milestoneTitles];
        if (milestoneDraft.trim()) pending.push(milestoneDraft.trim());
        // sequential so server sortOrder matches the order they were typed
        for (const title of pending) {
          await createM.mutateAsync({ goalId: created.id, title });
        }
      }
      onDone();
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onDone}
        className="fixed inset-0 z-40 bg-black/50"
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97 }}
        transition={springs.snappy}
        role="dialog"
        aria-modal="true"
        aria-label={initial ? 'Edit goal' : 'New goal'}
        className="fixed inset-x-3 top-[6vh] z-50 mx-auto flex max-h-[88vh] w-auto max-w-xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-neutral-800 dark:bg-neutral-900"
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5 dark:border-neutral-800">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-neutral-100">{initial ? 'Edit goal' : 'New goal'}</h2>
          <button type="button" onClick={onDone} aria-label="Close" className={iconBtnCls}>
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
            <div>
              <label htmlFor="goal-title" className={fieldLabelCls}>
                <SmartChip letter="S" title="Specific" />
                Goal <span className="text-red-500" aria-hidden>*</span>
              </label>
              <input
                id="goal-title"
                required
                autoFocus
                placeholder="e.g. Read 12 books"
                value={form.title}
                onChange={(e) => set('title', e.target.value)}
                className={`${inputCls} py-2.5 text-base font-medium`}
              />
              <input
                aria-label="What does done look like?"
                placeholder="What does “done” look like? (optional)"
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
                className={`${inputCls} mt-2 border-transparent bg-slate-50 dark:border-transparent dark:bg-neutral-800/60`}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-slate-200 p-3.5 dark:border-neutral-800">
                <div className={fieldLabelCls}>
                  <SmartChip letter="M" title="Measurable" />
                  Measure
                </div>
                <Switch checked={hasTarget} onChange={setHasTarget} label="Track a number" />
                <AnimatePresence initial={false}>
                  {hasTarget && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={springs.snappy}
                      className="overflow-hidden"
                    >
                      <div className="mt-2 flex gap-2">
                        <input
                          aria-label="Target value"
                          type="number"
                          min={1}
                          placeholder="12"
                          value={form.targetValue ?? ''}
                          onChange={(e) => set('targetValue', e.target.value ? Number(e.target.value) : null)}
                          className={`${inputCls} w-20`}
                        />
                        <input
                          aria-label="Unit"
                          placeholder="books, workouts…"
                          value={form.targetUnit ?? ''}
                          onChange={(e) => set('targetUnit', e.target.value || null)}
                          className={`${inputCls} flex-1`}
                        />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <div className="rounded-xl border border-slate-200 p-3.5 dark:border-neutral-800">
                <label htmlFor="goal-link" className={fieldLabelCls}>
                  <SmartChip letter="R" title="Relevant" />
                  Progress source
                </label>
                <select
                  id="goal-link"
                  value={form.linkKind ?? ''}
                  onChange={(e) => {
                    set('linkKind', (e.target.value || null) as GoalInput['linkKind']);
                    set('linkValue', null);
                  }}
                  className={`${inputCls} cursor-pointer`}
                >
                  <option value="">Update manually</option>
                  <option value="project">Auto-track a project</option>
                  <option value="label">Auto-track a label</option>
                </select>
                {form.linkKind === 'project' && (
                  <select
                    aria-label="Project to track"
                    value={form.linkValue ?? ''}
                    onChange={(e) => set('linkValue', e.target.value || null)}
                    className={`${inputCls} mt-2 cursor-pointer`}
                  >
                    <option value="">Choose project…</option>
                    {(projects ?? []).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                )}
                {form.linkKind === 'label' && (
                  <input
                    aria-label="Label to track"
                    placeholder="Label name"
                    value={form.linkValue ?? ''}
                    onChange={(e) => set('linkValue', e.target.value || null)}
                    className={`${inputCls} mt-2`}
                  />
                )}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 p-3.5 dark:border-neutral-800">
              <div className={fieldLabelCls}>
                <SmartChip letter="T" title="Time-bound" />
                Timeframe
              </div>
              <div className="flex flex-wrap items-center gap-2.5">
                <YearStepper value={form.year} onChange={(y) => set('year', y)} />
                <QuarterPills value={form.quarter} onChange={(q) => set('quarter', q)} />
                <span className="text-xs text-slate-400 dark:text-neutral-500">
                  ends <span className="font-medium text-slate-500 dark:text-neutral-400">{deadlinePreview}</span>
                </span>
              </div>
              <div className="mt-2">
                <Switch checked={hasCustomDeadline} onChange={setHasCustomDeadline} label="Custom deadline" />
                <AnimatePresence initial={false}>
                  {hasCustomDeadline && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={springs.snappy}
                      className="overflow-hidden"
                    >
                      <input
                        aria-label="Deadline"
                        type="date"
                        value={form.customDeadline ?? ''}
                        onChange={(e) => set('customDeadline', e.target.value || null)}
                        className={`${inputCls} mt-2 w-auto`}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {!initial && (
              <div className="rounded-xl border border-slate-200 p-3.5 dark:border-neutral-800">
                <div className={fieldLabelCls}>
                  <Flag size={13} className="text-teal-500" />
                  Milestones <span className="font-normal text-slate-400 dark:text-neutral-500">(optional)</span>
                </div>
                {milestoneTitles.length > 0 && (
                  <ul className="mb-2 space-y-1">
                    {milestoneTitles.map((t, i) => (
                      <li key={`${t}-${i}`} className="flex items-center gap-2 rounded-md bg-slate-50 px-2.5 py-1.5 text-sm text-slate-700 dark:bg-neutral-800/60 dark:text-neutral-200">
                        <span className="h-[14px] w-[14px] shrink-0 rounded border border-slate-300 dark:border-neutral-600" />
                        <span className="min-w-0 flex-1 truncate">{t}</span>
                        <button
                          type="button"
                          aria-label={`Remove milestone ${t}`}
                          onClick={() => setMilestoneTitles((list) => list.filter((_, j) => j !== i))}
                          className="cursor-pointer rounded p-0.5 text-slate-400 transition-colors hover:text-red-500"
                        >
                          <X size={13} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex items-center gap-2">
                  <Plus size={14} className="shrink-0 text-slate-300 dark:text-neutral-600" />
                  <input
                    aria-label="New milestone"
                    value={milestoneDraft}
                    onChange={(e) => setMilestoneDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addMilestoneDraft();
                      }
                    }}
                    placeholder="Break it into steps — press Enter to add"
                    className="min-w-0 flex-1 border-none bg-transparent py-1 text-sm text-slate-600 placeholder:text-slate-400 focus:outline-none dark:text-neutral-300 dark:placeholder:text-neutral-600"
                  />
                </div>
              </div>
            )}

            <div>
              <button
                type="button"
                onClick={() => setShowDetails((v) => !v)}
                aria-expanded={showDetails}
                className="flex cursor-pointer items-center gap-1.5 rounded-md text-xs font-medium text-slate-500 transition-colors hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40 dark:text-neutral-400 dark:hover:text-neutral-200"
              >
                <ChevronDown size={13} className={`transition-transform ${showDetails ? '' : '-rotate-90'}`} />
                SMART details
                <span className="font-normal text-slate-400 dark:text-neutral-500">— why it’s achievable &amp; why it matters</span>
              </button>
              <AnimatePresence initial={false}>
                {showDetails && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={springs.snappy}
                    className="overflow-hidden"
                  >
                    <div className="mt-3 space-y-3">
                      <div>
                        <label htmlFor="goal-achievable" className={fieldLabelCls}>
                          <SmartChip letter="A" title="Achievable" />
                          Why is this realistic?
                        </label>
                        <input
                          id="goal-achievable"
                          placeholder="e.g. I already read 30 min every night"
                          value={form.achievable}
                          onChange={(e) => set('achievable', e.target.value)}
                          className={inputCls}
                        />
                      </div>
                      <div>
                        <label htmlFor="goal-relevance" className={fieldLabelCls}>
                          <SmartChip letter="R" title="Relevant" />
                          Why does it matter?
                        </label>
                        <textarea
                          id="goal-relevance"
                          placeholder="Connect it to something bigger — career, health, family…"
                          value={form.relevance}
                          onChange={(e) => set('relevance', e.target.value)}
                          rows={2}
                          className={inputCls}
                        />
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-3 dark:border-neutral-800 dark:bg-neutral-900/60">
            <button
              type="button"
              onClick={onDone}
              className="cursor-pointer rounded-lg px-4 py-2 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40 dark:text-neutral-400 dark:hover:bg-white/5"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !form.title.trim()}
              className="cursor-pointer rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/60 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:focus-visible:ring-offset-neutral-900"
            >
              {saving ? 'Saving…' : initial ? 'Save changes' : 'Add goal'}
            </button>
          </div>
        </form>
      </motion.div>
    </>
  );
}

/* ---------- milestones ---------- */

function MilestoneChecklist({ goal }: { goal: GoalDTO }) {
  const [newTitle, setNewTitle] = useState('');
  const createM = useCreateGoalMilestone();
  const updateM = useUpdateGoalMilestone();
  const deleteM = useDeleteGoalMilestone();
  const reorderM = useReorderGoalMilestones();

  const move = (index: number, dir: -1 | 1) => {
    const ids = goal.milestones.map((m) => m.id);
    const target = index + dir;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    reorderM.mutate({ goalId: goal.id, ids });
  };

  return (
    <div className="space-y-0.5">
      {goal.milestones.map((m, i) => (
        <div
          key={m.id}
          className="group flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-slate-50 dark:hover:bg-white/5"
        >
          <button
            type="button"
            role="checkbox"
            aria-checked={m.done}
            aria-label={`${m.done ? 'Reopen' : 'Complete'} milestone: ${m.title}`}
            onClick={() => updateM.mutate({ goalId: goal.id, id: m.id, patch: { done: !m.done } })}
            className={`flex h-[18px] w-[18px] shrink-0 cursor-pointer items-center justify-center rounded-md border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40 ${
              m.done
                ? 'border-emerald-500 bg-emerald-500 text-white'
                : 'border-slate-300 hover:border-teal-400 dark:border-neutral-600 dark:hover:border-teal-500'
            }`}
          >
            {m.done && <Check size={12} strokeWidth={3} />}
          </button>
          <span
            className={`min-w-0 flex-1 truncate text-sm transition-colors ${
              m.done ? 'text-slate-400 line-through dark:text-neutral-500' : 'text-slate-700 dark:text-neutral-200'
            }`}
          >
            {m.title}
          </span>
          <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
            <button type="button" aria-label="Move milestone up" disabled={i === 0} onClick={() => move(i, -1)} className={`${iconBtnCls} p-1 disabled:cursor-default disabled:opacity-30`}>
              <ArrowUp size={12} />
            </button>
            <button
              type="button"
              aria-label="Move milestone down"
              disabled={i === goal.milestones.length - 1}
              onClick={() => move(i, 1)}
              className={`${iconBtnCls} p-1 disabled:cursor-default disabled:opacity-30`}
            >
              <ArrowDown size={12} />
            </button>
            <button
              type="button"
              aria-label="Delete milestone"
              onClick={() => deleteM.mutate({ goalId: goal.id, id: m.id })}
              className="cursor-pointer rounded-md p-1 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/40 dark:hover:bg-red-500/10"
            >
              <Trash2 size={12} />
            </button>
          </div>
        </div>
      ))}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!newTitle.trim()) return;
          createM.mutate({ goalId: goal.id, title: newTitle.trim() }, { onSuccess: () => setNewTitle('') });
        }}
        className="flex items-center gap-2.5 px-2 py-1"
      >
        <Plus size={14} className="shrink-0 text-slate-300 dark:text-neutral-600" />
        <input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="Add a milestone and press Enter"
          aria-label="New milestone"
          className="min-w-0 flex-1 border-none bg-transparent py-1 text-sm text-slate-600 placeholder:text-slate-400 focus:outline-none dark:text-neutral-300 dark:placeholder:text-neutral-600"
        />
      </form>
    </div>
  );
}

/* ---------- goal card ---------- */

function GoalCard({ goal, onEdit }: { goal: GoalDTO; onEdit: (g: GoalDTO) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [showMilestones, setShowMilestones] = useState(goal.milestones.length > 0);
  const update = useUpdateGoal();
  const del = useDeleteGoal();

  // Rapid +/- clicks would otherwise each send `server value + 1` and collapse
  // into a single increment; track the locally-intended value until the server
  // catches up so every click counts and feedback is instant.
  const [pendingValue, setPendingValue] = useState<number | null>(null);
  const pendingRef = useRef<number | null>(null);
  useEffect(() => {
    if (pendingValue != null && goal.currentValue === pendingValue) {
      pendingRef.current = null;
      setPendingValue(null);
    }
  }, [goal.currentValue, pendingValue]);
  const stepValue = (delta: number) => {
    const next = Math.max(0, (pendingRef.current ?? goal.currentValue) + delta);
    pendingRef.current = next;
    setPendingValue(next);
    update.mutate(
      { id: goal.id, patch: { currentValue: next } },
      {
        onError: () => {
          pendingRef.current = null;
          setPendingValue(null);
        },
      },
    );
  };

  const { milestonePct, measurablePct, measurableProgress, headlinePct } = computeGoalDisplay(
    pendingValue != null ? { ...goal, currentValue: pendingValue } : goal,
  );
  const behind = isBehindPace(goal, headlinePct);
  const achieved = goal.status === 'achieved';
  const dropped = goal.status === 'dropped';
  const doneMilestones = goal.milestones.filter((m) => m.done).length;
  const LinkIcon = goal.linkKind ? LINK_ICON[goal.linkKind] : null;
  const tone = achieved ? 'emerald' : dropped ? 'slate' : behind ? 'amber' : 'teal';

  return (
    <motion.li
      layout
      variants={listItem}
      initial="initial"
      animate="animate"
      exit="exit"
      className={`rounded-2xl border p-4 shadow-sm transition-colors sm:p-5 ${
        achieved
          ? 'border-emerald-200 bg-emerald-50/40 dark:border-emerald-500/25 dark:bg-emerald-500/5'
          : dropped
            ? 'border-slate-200 bg-slate-50/60 opacity-70 dark:border-neutral-800 dark:bg-neutral-900/60'
            : 'border-slate-200 bg-white hover:border-slate-300 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-neutral-700'
      }`}
    >
      <div className="flex items-start gap-3.5">
        {headlinePct != null ? (
          <ProgressRing pct={achieved ? 100 : headlinePct} tone={tone} />
        ) : (
          <div className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full border-2 border-dashed border-slate-200 dark:border-neutral-700">
            <Trophy size={18} className="text-slate-300 dark:text-neutral-600" />
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium tabular-nums text-slate-500 dark:bg-neutral-800 dark:text-neutral-400">
              Q{goal.quarter} {goal.year}
            </span>
            {behind && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                <AlertTriangle size={11} /> Behind pace
              </span>
            )}
            {achieved && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                <Trophy size={11} /> Achieved
              </span>
            )}
            {dropped && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500 dark:bg-neutral-800 dark:text-neutral-400">
                Dropped
              </span>
            )}
          </div>
          <h3
            className={`mt-1 font-semibold leading-snug ${
              achieved || dropped ? 'text-slate-500 line-through dark:text-neutral-500' : 'text-slate-900 dark:text-neutral-100'
            }`}
          >
            {goal.title}
          </h3>
          {goal.description && (
            <p className="mt-0.5 text-sm text-slate-500 dark:text-neutral-400">{goal.description}</p>
          )}
          {goal.linkKind && LinkIcon && (
            <span className="mt-1 inline-flex items-center gap-1 text-xs text-slate-400 dark:text-neutral-500">
              <LinkIcon size={12} /> Auto-tracked · {goal.linkValue ?? goal.linkKind} · {formatMinutes(goal.progressMinutes)} done ·{' '}
              {goal.progressCount} tasks
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {confirming ? (
            <>
              <button
                onClick={() => del.mutate(goal.id)}
                className="cursor-pointer rounded-lg bg-red-600 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
              >
                Delete
              </button>
              <button
                onClick={() => setConfirming(false)}
                className="cursor-pointer rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-100 dark:text-neutral-400 dark:hover:bg-white/5"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              {!achieved && !dropped && (
                <button
                  onClick={() => update.mutate({ id: goal.id, patch: { status: 'achieved' } })}
                  className="hidden cursor-pointer items-center gap-1 rounded-lg border border-emerald-200 px-2.5 py-1.5 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50 sm:flex dark:border-emerald-500/30 dark:text-emerald-300 dark:hover:bg-emerald-500/10"
                >
                  <Check size={12} /> Achieved
                </button>
              )}
              {(achieved || dropped) && (
                <button
                  onClick={() => update.mutate({ id: goal.id, patch: { status: 'active' } })}
                  className="flex cursor-pointer items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-white/5"
                >
                  <Undo2 size={12} /> Reopen
                </button>
              )}
              <button onClick={() => onEdit(goal)} title="Edit goal" aria-label="Edit goal" className={iconBtnCls}>
                <Pencil size={14} />
              </button>
              {!achieved && !dropped && (
                <button
                  onClick={() => update.mutate({ id: goal.id, patch: { status: 'dropped' } })}
                  title="Drop goal"
                  aria-label="Drop goal"
                  className={iconBtnCls}
                >
                  <X size={15} />
                </button>
              )}
              <button
                onClick={() => setConfirming(true)}
                title="Delete goal"
                aria-label="Delete goal"
                className="cursor-pointer rounded-md p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/40 dark:hover:bg-red-500/10 dark:hover:text-red-400"
              >
                <Trash2 size={14} />
              </button>
            </>
          )}
        </div>
      </div>

      {!achieved && !dropped && (
        <button
          onClick={() => update.mutate({ id: goal.id, patch: { status: 'achieved' } })}
          className="mt-3 flex cursor-pointer items-center gap-1 rounded-lg border border-emerald-200 px-2.5 py-1.5 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-50 sm:hidden dark:border-emerald-500/30 dark:text-emerald-300 dark:hover:bg-emerald-500/10"
        >
          <Check size={12} /> Mark achieved
        </button>
      )}

      {(goal.targetValue != null || goal.milestones.length > 0 || (!achieved && !dropped)) && (
        <div className="mt-3.5 space-y-2 border-t border-slate-100 pt-3 dark:border-neutral-800">
          {goal.targetValue != null && (
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between text-xs">
                  <span className="font-medium text-slate-600 dark:text-neutral-300">
                    <span className="tabular-nums">{measurableProgress}</span>
                    <span className="text-slate-400 dark:text-neutral-500"> / {goal.targetValue} {goal.targetUnit ?? ''}</span>
                  </span>
                  <span className="tabular-nums text-slate-400 dark:text-neutral-500">{measurablePct}%</span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-neutral-800">
                  <motion.div
                    className={`h-full rounded-full ${achieved ? 'bg-emerald-500' : behind ? 'bg-amber-500' : 'bg-teal-500'}`}
                    initial={false}
                    animate={{ width: `${measurablePct ?? 0}%` }}
                    transition={springs.soft}
                  />
                </div>
              </div>
              {!achieved && !dropped && (
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    aria-label="Decrease progress"
                    onClick={() => stepValue(-1)}
                    className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg border border-slate-200 text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40 dark:border-neutral-700 dark:hover:bg-white/5 dark:hover:text-neutral-300"
                  >
                    <Minus size={13} />
                  </button>
                  <button
                    type="button"
                    aria-label="Increase progress"
                    onClick={() => stepValue(1)}
                    className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg border border-teal-200 bg-teal-50 text-teal-600 transition-colors hover:bg-teal-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40 dark:border-teal-500/30 dark:bg-teal-500/10 dark:text-teal-300 dark:hover:bg-teal-500/20"
                  >
                    <Plus size={13} />
                  </button>
                </div>
              )}
            </div>
          )}

          {(goal.milestones.length > 0 || (!achieved && !dropped)) && (
            <div>
              <button
                type="button"
                onClick={() => setShowMilestones((v) => !v)}
                aria-expanded={showMilestones}
                className="flex cursor-pointer items-center gap-1.5 rounded-md py-0.5 text-xs font-medium text-slate-500 transition-colors hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40 dark:text-neutral-400 dark:hover:text-neutral-200"
              >
                <ChevronDown size={13} className={`transition-transform ${showMilestones ? '' : '-rotate-90'}`} />
                Milestones
                {goal.milestones.length > 0 && (
                  <span className="tabular-nums text-slate-400 dark:text-neutral-500">
                    {doneMilestones}/{goal.milestones.length}{milestonePct != null ? ` · ${milestonePct}%` : ''}
                  </span>
                )}
              </button>
              <AnimatePresence initial={false}>
                {showMilestones && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={springs.snappy}
                    className="overflow-hidden"
                  >
                    <div className="pt-1">
                      <MilestoneChecklist goal={goal} />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between text-[11px] text-slate-400 dark:text-neutral-500">
        <span>Deadline {DateTime.fromISO(goal.deadline).toFormat('MMM d, yyyy')}</span>
        {goal.status === 'active' && (
          <span className={`tabular-nums ${goal.daysRemaining <= 7 ? 'font-medium text-amber-600 dark:text-amber-400' : ''}`}>
            {goal.daysRemaining} days left
          </span>
        )}
      </div>
    </motion.li>
  );
}

/* ---------- insights sidebar ---------- */

const asideCardCls =
  'rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900';

const asideTitleCls = 'flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-neutral-500';

function InsightsSidebar({
  goals,
  year,
  quarter,
  elapsedPct,
}: {
  goals: GoalDTO[];
  year: number;
  quarter: number | 'all';
  elapsedPct: number | null;
}) {
  const now = DateTime.now();
  const active = goals.filter((g) => g.status === 'active');
  const achieved = goals.filter((g) => g.status === 'achieved');
  const behindCount = active.filter((g) => isBehindPace(g, computeGoalDisplay(g).headlinePct)).length;

  const isCurrentPeriod = quarter !== 'all' && year === now.year && quarter === now.quarter;
  const quarterEnd =
    quarter !== 'all' ? DateTime.fromObject({ year, month: quarter * 3, day: 1 }).endOf('month') : null;
  const daysLeftInQuarter =
    isCurrentPeriod && quarterEnd ? Math.max(0, Math.ceil(quarterEnd.diff(now, 'days').days)) : null;

  const upcoming = [...active].sort((a, b) => a.daysRemaining - b.daysRemaining).slice(0, 4);

  const recentWins = goals
    .flatMap((g) =>
      g.milestones
        .filter((m) => m.done && m.completedAtUtc)
        .map((m) => ({ id: m.id, title: m.title, goalTitle: g.title, at: m.completedAtUtc as string })),
    )
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 5);

  return (
    <div className="space-y-4">
      <div className={asideCardCls}>
        <div className={asideTitleCls}>
          <CalendarClock size={12} />
          {quarter === 'all' ? `${year} overview` : `Q${quarter} ${year}`}
        </div>
        {daysLeftInQuarter != null ? (
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-2xl font-semibold tabular-nums text-slate-900 dark:text-neutral-100">{daysLeftInQuarter}</span>
            <span className="text-sm text-slate-400 dark:text-neutral-500">days left in the quarter</span>
          </div>
        ) : (
          <div className="mt-2 text-sm text-slate-400 dark:text-neutral-500">
            {quarter === 'all' ? 'All quarters' : quarterEnd && quarterEnd < now ? 'Quarter over' : 'Not started yet'}
          </div>
        )}
        {elapsedPct != null && (
          <>
            <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-neutral-800">
              <div className="h-full rounded-full bg-slate-400 transition-all dark:bg-neutral-500" style={{ width: `${elapsedPct}%` }} />
            </div>
            <div className="mt-1 text-[11px] tabular-nums text-slate-400 dark:text-neutral-500">{elapsedPct}% elapsed</div>
          </>
        )}
        <div className="mt-3 flex flex-wrap gap-1.5">
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium tabular-nums text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
            {achieved.length} achieved
          </span>
          <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[11px] font-medium tabular-nums text-teal-700 dark:bg-teal-500/10 dark:text-teal-300">
            {active.length - behindCount} on track
          </span>
          {behindCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium tabular-nums text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
              <AlertTriangle size={10} /> {behindCount} behind
            </span>
          )}
        </div>
      </div>

      {upcoming.length > 0 && (
        <div className={asideCardCls}>
          <div className={asideTitleCls}>
            <Flag size={12} />
            Deadlines
          </div>
          <ul className="mt-2.5 space-y-2.5">
            {upcoming.map((g) => {
              const { headlinePct } = computeGoalDisplay(g);
              const behind = isBehindPace(g, headlinePct);
              return (
                <li key={g.id} className="flex items-center gap-2.5">
                  {headlinePct != null ? (
                    <ProgressRing pct={headlinePct} tone={behind ? 'amber' : 'teal'} size={34} />
                  ) : (
                    <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full border-2 border-dashed border-slate-200 dark:border-neutral-700">
                      <Trophy size={12} className="text-slate-300 dark:text-neutral-600" />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-700 dark:text-neutral-200">{g.title}</div>
                    <div
                      className={`text-[11px] tabular-nums ${
                        g.daysRemaining <= 7
                          ? 'font-medium text-amber-600 dark:text-amber-400'
                          : 'text-slate-400 dark:text-neutral-500'
                      }`}
                    >
                      {g.daysRemaining} days · {DateTime.fromISO(g.deadline).toFormat('MMM d')}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {(recentWins.length > 0 || achieved.length > 0) && (
        <div className={asideCardCls}>
          <div className={asideTitleCls}>
            <Sparkles size={12} />
            Recent wins
          </div>
          <ul className="mt-2.5 space-y-2">
            {achieved.slice(0, 3).map((g) => (
              <li key={g.id} className="flex items-start gap-2">
                <Trophy size={13} className="mt-0.5 shrink-0 text-emerald-500" />
                <span className="min-w-0 flex-1 truncate text-sm text-slate-700 dark:text-neutral-200">{g.title}</span>
              </li>
            ))}
            {recentWins.map((w) => (
              <li key={w.id} className="flex items-start gap-2">
                <Check size={13} className="mt-0.5 shrink-0 text-emerald-500" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-slate-700 dark:text-neutral-200">{w.title}</div>
                  <div className="truncate text-[11px] text-slate-400 dark:text-neutral-500">
                    {w.goalTitle} · {DateTime.fromISO(w.at).toRelative({ base: now })}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-2xl border border-dashed border-slate-200 p-4 dark:border-neutral-800">
        <div className={asideTitleCls}>SMART goals</div>
        <p className="mt-1.5 text-xs leading-relaxed text-slate-400 dark:text-neutral-500">
          <span className="font-medium text-slate-500 dark:text-neutral-400">S</span>pecific ·{' '}
          <span className="font-medium text-slate-500 dark:text-neutral-400">M</span>easurable ·{' '}
          <span className="font-medium text-slate-500 dark:text-neutral-400">A</span>chievable ·{' '}
          <span className="font-medium text-slate-500 dark:text-neutral-400">R</span>elevant ·{' '}
          <span className="font-medium text-slate-500 dark:text-neutral-400">T</span>ime-bound. Three to five goals per
          quarter is plenty — link them to projects so progress tracks itself.
        </p>
      </div>
    </div>
  );
}

/* ---------- page ---------- */

export default function GoalsPage() {
  const now = DateTime.now();
  const [year, setYear] = useState(now.year);
  const [quarter, setQuarter] = useState<number | 'all'>(now.quarter);
  const { data: goalsData, isLoading } = useGoals(year, quarter);
  const [showForm, setShowForm] = useState(false);
  const [editingGoal, setEditingGoal] = useState<GoalDTO | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const all = goalsData ?? [];
  const active = all.filter((g) => g.status === 'active');
  const inactive = all.filter((g) => g.status !== 'active');

  const groupedByQuarter = useMemo(() => {
    if (quarter !== 'all') return null;
    const map = new Map<number, GoalDTO[]>();
    for (const g of active) {
      const list = map.get(g.quarter) ?? [];
      list.push(g);
      map.set(g.quarter, list);
    }
    return map;
  }, [active, quarter]);

  const currentQuarterElapsedPct =
    quarter !== 'all'
      ? Math.round(
          (Math.min(1, Math.max(0, now.diff(DateTime.fromObject({ year, month: (quarter - 1) * 3 + 1, day: 1 }), 'quarters').quarters))) * 100,
        )
      : null;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-100 dark:bg-teal-500/15">
              <Trophy size={16} className="text-teal-600 dark:text-teal-300" />
            </span>
            <h1 className="text-lg font-semibold text-slate-900 dark:text-neutral-100">Goals</h1>
          </div>
          <p className="mt-1 text-sm text-slate-400 dark:text-neutral-500">Set SMART goals and track them quarter by quarter.</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-teal-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-teal-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/60 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-neutral-950"
        >
          <Plus size={15} /> New goal
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center rounded-lg bg-slate-100 p-0.5 dark:bg-neutral-800">
          <button
            type="button"
            aria-label="Previous year"
            onClick={() => setYear((y) => y - 1)}
            className="cursor-pointer rounded-md p-1.5 text-slate-400 transition-colors hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40 dark:hover:text-neutral-200"
          >
            <ChevronLeft size={14} />
          </button>
          <span className="w-12 text-center text-sm font-medium tabular-nums text-slate-700 dark:text-neutral-200">{year}</span>
          <button
            type="button"
            aria-label="Next year"
            onClick={() => setYear((y) => y + 1)}
            className="cursor-pointer rounded-md p-1.5 text-slate-400 transition-colors hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40 dark:hover:text-neutral-200"
          >
            <ChevronRight size={14} />
          </button>
        </div>
        <div className="inline-flex rounded-lg bg-slate-100 p-0.5 dark:bg-neutral-800" role="radiogroup" aria-label="Period">
          {QUARTERS.map((q) => (
            <button
              key={q}
              type="button"
              role="radio"
              aria-checked={quarter === q}
              onClick={() => setQuarter(q)}
              className={`cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40 ${
                quarter === q
                  ? 'bg-white text-teal-700 shadow-sm dark:bg-neutral-700 dark:text-teal-300'
                  : 'text-slate-500 hover:text-slate-700 dark:text-neutral-400 dark:hover:text-neutral-200'
              } ${q === now.quarter && year === now.year && quarter !== q ? 'underline decoration-teal-400 decoration-2 underline-offset-4' : ''}`}
            >
              Q{q}
            </button>
          ))}
          <button
            type="button"
            role="radio"
            aria-checked={quarter === 'all'}
            onClick={() => setQuarter('all')}
            className={`cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40 ${
              quarter === 'all'
                ? 'bg-white text-teal-700 shadow-sm dark:bg-neutral-700 dark:text-teal-300'
                : 'text-slate-500 hover:text-slate-700 dark:text-neutral-400 dark:hover:text-neutral-200'
            }`}
          >
            Year
          </button>
        </div>
      </div>

      <div className="mt-5 items-start gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0">
          {isLoading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-28 animate-pulse rounded-2xl bg-slate-100 dark:bg-neutral-800/60" />
              ))}
            </div>
          ) : all.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 px-6 py-12 text-center dark:border-neutral-700">
              <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-teal-50 dark:bg-teal-500/10">
                <Trophy size={22} className="text-teal-400 dark:text-teal-500" />
              </span>
              <p className="mt-3 text-sm font-medium text-slate-600 dark:text-neutral-300">No goals for this period yet</p>
              <p className="mx-auto mt-1 max-w-sm text-xs text-slate-400 dark:text-neutral-500">
                Break big ambitions into SMART goals — specific, measurable, and time-bound — with milestones you can check off.
              </p>
              <button
                onClick={() => setShowForm(true)}
                className="mt-4 inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-teal-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-teal-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/60 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-neutral-950"
              >
                <Plus size={14} /> Add your first goal
              </button>
            </div>
          ) : (
            <div className="space-y-5">
              {groupedByQuarter
                ? QUARTERS.filter((q) => (groupedByQuarter.get(q) ?? []).length > 0).map((q) => (
                    <div key={q} className="space-y-3">
                      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-neutral-500">
                        Q{q} {year}
                      </h2>
                      <ul className="space-y-3">
                        <AnimatePresence initial={false}>
                          {(groupedByQuarter.get(q) ?? []).map((g) => (
                            <GoalCard key={g.id} goal={g} onEdit={setEditingGoal} />
                          ))}
                        </AnimatePresence>
                      </ul>
                    </div>
                  ))
                : active.length > 0 && (
                    <ul className="space-y-3">
                      <AnimatePresence initial={false}>
                        {active.map((g) => (
                          <GoalCard key={g.id} goal={g} onEdit={setEditingGoal} />
                        ))}
                      </AnimatePresence>
                    </ul>
                  )}

              {inactive.length > 0 && (
                <div>
                  <button
                    onClick={() => setShowInactive((v) => !v)}
                    aria-expanded={showInactive}
                    className="flex w-full cursor-pointer items-center gap-1.5 rounded-md py-1.5 text-xs font-medium text-slate-400 transition-colors hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40 dark:text-neutral-500 dark:hover:text-neutral-300"
                  >
                    <ChevronDown size={13} className={`transition-transform ${showInactive ? 'rotate-180' : ''}`} />
                    {inactive.length} achieved / dropped
                  </button>
                  <AnimatePresence initial={false}>
                    {showInactive && (
                      <motion.ul
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="space-y-3 overflow-hidden pt-2"
                      >
                        {inactive.map((g) => (
                          <GoalCard key={g.id} goal={g} onEdit={setEditingGoal} />
                        ))}
                      </motion.ul>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </div>
          )}
        </div>

        {!isLoading && all.length > 0 && (
          <aside className="mt-5 lg:sticky lg:top-4 lg:mt-0">
            <InsightsSidebar goals={all} year={year} quarter={quarter} elapsedPct={currentQuarterElapsedPct} />
          </aside>
        )}
      </div>

      <AnimatePresence>
        {showForm && (
          <GoalFormModal
            defaultYear={year}
            defaultQuarter={quarter === 'all' ? now.quarter : quarter}
            onDone={() => setShowForm(false)}
          />
        )}
        {editingGoal && (
          <GoalFormModal
            key={editingGoal.id}
            initial={editingGoal}
            defaultYear={editingGoal.year}
            defaultQuarter={editingGoal.quarter}
            onDone={() => setEditingGoal(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
