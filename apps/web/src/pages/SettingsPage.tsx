import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Settings } from '@timeblock/shared';
import { useDisconnectGoogle, useGoogleCalendars, useLearningStats, useResetLearning, useSettings, useSetupStatus, useUpdateSettings } from '../hooks.js';
import WorkingHoursEditor from '../components/WorkingHoursEditor.js';
import EnergyWindowsEditor from '../components/EnergyWindowsEditor.js';

function fmtHour(h: number) {
  const period = h < 12 ? 'am' : 'pm';
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}${period}`;
}

function LearningPanel({ enabled, onToggle }: { enabled: boolean; onToggle: (v: boolean) => void }) {
  const { data: stats } = useLearningStats();
  const reset = useResetLearning();
  const hasData = stats && (stats.hourWeight > 0 || stats.globalWeight > 0);
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <h3 className="mb-1 font-semibold text-slate-900 dark:text-neutral-100">Learning from your history</h3>
      <p className="mb-3 text-sm text-slate-400 dark:text-neutral-500">Calibrates task durations and favors the hours you actually follow through.</p>
      <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-neutral-400">
        <input type="checkbox" checked={enabled} onChange={(e) => onToggle(e.target.checked)} />
        Learn from what I complete and miss
      </label>
      {enabled && hasData && (
        <div className="mt-3 grid grid-cols-1 gap-2 rounded-lg bg-slate-50 p-3 text-sm dark:bg-neutral-800 sm:grid-cols-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400 dark:text-neutral-500">Duration bias</p>
            <p className="font-medium text-slate-700 dark:text-neutral-300">
              {stats!.globalWeight >= 10 ? `${Math.round(stats!.globalMultiplier * 100)}% of estimate` : 'learning…'}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400 dark:text-neutral-500">Best hours</p>
            <p className="font-medium text-slate-700 dark:text-neutral-300">{stats!.bestHours.map((h) => fmtHour(h.hour)).join(', ') || '—'}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400 dark:text-neutral-500">Tough hours</p>
            <p className="font-medium text-slate-700 dark:text-neutral-300">{stats!.worstHours.map((h) => fmtHour(h.hour)).join(', ') || '—'}</p>
          </div>
        </div>
      )}
      {enabled && (
        <button
          onClick={() => reset.mutate()}
          disabled={reset.isPending}
          className="mt-3 rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-50 disabled:opacity-50 dark:border-neutral-800 dark:text-neutral-400 dark:hover:bg-white/5"
        >
          {reset.isPending ? 'Resetting…' : 'Reset learned stats'}
        </button>
      )}
    </section>
  );
}

export default function SettingsPage() {
  const { data: settings } = useSettings();
  const update = useUpdateSettings();
  const { data: setup } = useSetupStatus();
  const { data: calendars } = useGoogleCalendars(!!setup?.google);
  const disconnect = useDisconnectGoogle();
  const [form, setForm] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);
  const [disconnected, setDisconnected] = useState(false);

  useEffect(() => {
    if (settings && !form) setForm(settings);
  }, [settings, form]);

  if (!form) return <div className="text-slate-400 dark:text-neutral-500">Loading…</div>;

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setForm({ ...form, [key]: value });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-lg font-semibold text-slate-900 dark:text-neutral-100">Settings</h1>

      <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <h3 className="mb-3 font-semibold text-slate-900 dark:text-neutral-100">Timezone & working hours</h3>
        <label className="mb-3 block text-sm text-slate-500 dark:text-neutral-400">
          Timezone (IANA)
          <input value={form.timezone} onChange={(e) => set('timezone', e.target.value)} className="mt-1 block w-64 rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100" />
        </label>
        <WorkingHoursEditor value={form.workingHours} onChange={(workingHours) => set('workingHours', workingHours)} />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <h3 className="mb-1 font-semibold text-slate-900 dark:text-neutral-100">How full should your day be?</h3>
        <p className="mb-3 text-sm text-slate-400 dark:text-neutral-500">
          Caps how much of your working hours the planner fills with tasks. Habits and calendar events don't count against this — only task time.
        </p>
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              { value: 'light', label: 'Light', hint: '~50%' },
              { value: 'balanced', label: 'Balanced', hint: '~70%' },
              { value: 'packed', label: 'Packed', hint: '~90%' },
            ] as const
          ).map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => set('dayFullness', opt.value)}
              className={`rounded-lg border px-3 py-2 text-center text-sm font-medium transition-colors ${
                form.dayFullness === opt.value
                  ? 'border-teal-500 bg-teal-50 text-teal-700 dark:border-teal-500 dark:bg-teal-500/10 dark:text-teal-300'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-white/5'
              }`}
            >
              {opt.label}
              <span className="block text-xs font-normal opacity-70">{opt.hint}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <h3 className="mb-3 font-semibold text-slate-900 dark:text-neutral-100">Scheduling</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <label className="text-sm text-slate-500 dark:text-neutral-400">
            Default duration (min)
            <input type="number" value={form.defaultDurationMin} onChange={(e) => set('defaultDurationMin', Number(e.target.value))} className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100" />
          </label>
          <label className="text-sm text-slate-500 dark:text-neutral-400">
            Horizon (days)
            <input type="number" value={form.horizonDays} onChange={(e) => set('horizonDays', Number(e.target.value))} className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100" />
          </label>
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm text-slate-600 dark:text-neutral-400">
          <input type="checkbox" checked={form.autoRescheduleMissed} onChange={(e) => set('autoRescheduleMissed', e.target.checked)} />
          Pre-pick missed tasks for today when I open the Plan Day ritual
        </label>
        <label className="mt-2 flex items-center gap-2 text-sm text-slate-600 dark:text-neutral-400">
          <input type="checkbox" checked={form.updateDueOnMove} onChange={(e) => set('updateDueOnMove', e.target.checked)} />
          Update a task's due date when I drag its block in Google Calendar
        </label>

        <details className="mt-4 border-t border-slate-100 pt-3 dark:border-neutral-800">
          <summary className="cursor-pointer text-sm font-medium text-slate-600 dark:text-neutral-300">Advanced</summary>
          <div className="mt-3 space-y-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <label className="text-sm text-slate-500 dark:text-neutral-400">
                Buffer (min)
                <input type="number" value={form.bufferMin} onChange={(e) => set('bufferMin', Number(e.target.value))} className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100" />
              </label>
              <label className="text-sm text-slate-500 dark:text-neutral-400">
                Granularity (min)
                <input type="number" value={form.granularityMin} onChange={(e) => set('granularityMin', Number(e.target.value))} className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100" />
              </label>
            </div>
            <label className="block text-sm text-slate-500 dark:text-neutral-400">
              Applying schedule changes
              <select value={form.autoApply} onChange={(e) => set('autoApply', e.target.value as Settings['autoApply'])} className="mt-1 block w-72 rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100">
                <option value="off">Draft only — I review and approve every change</option>
                <option value="full">Apply automatically (old behavior)</option>
              </select>
            </label>
            <label className="block text-sm text-slate-500 dark:text-neutral-400">
              Which tasks to schedule
              <select value={form.schedulePolicy} onChange={(e) => set('schedulePolicy', e.target.value as Settings['schedulePolicy'])} className="mt-1 block w-64 rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100">
                <option value="due_only">Only tasks with a due date</option>
                <option value="all">All open tasks</option>
              </select>
            </label>
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-neutral-300">
                <input type="checkbox" checked={form.splitEnabled} onChange={(e) => set('splitEnabled', e.target.checked)} />
                Split long tasks into multiple sittings
              </label>
              {form.splitEnabled && (
                <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <label className="text-sm text-slate-500 dark:text-neutral-400">
                    Max sitting (min)
                    <input type="number" value={form.maxChunkMin} onChange={(e) => set('maxChunkMin', Number(e.target.value))} className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100" />
                  </label>
                  <label className="text-sm text-slate-500 dark:text-neutral-400">
                    Min sitting (min)
                    <input type="number" value={form.minChunkMin} onChange={(e) => set('minChunkMin', Number(e.target.value))} className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100" />
                  </label>
                  <label className="text-sm text-slate-500 dark:text-neutral-400">
                    Spread chunks
                    <select value={form.chunkGapPolicy} onChange={(e) => set('chunkGapPolicy', e.target.value as Settings['chunkGapPolicy'])} className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100">
                      <option value="same_day">Same day, back-to-back</option>
                      <option value="spread">One sitting per day</option>
                    </select>
                  </label>
                </div>
              )}
            </div>
          </div>
        </details>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <h3 className="mb-1 font-semibold text-slate-900 dark:text-neutral-100">Focus & energy</h3>
        <p className="mb-3 text-sm text-slate-400 dark:text-neutral-500">Steer deep work into your best hours and shallow work into the rest.</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="text-sm text-slate-500 dark:text-neutral-400">
            Mode
            <select value={form.energyMode} onChange={(e) => set('energyMode', e.target.value as Settings['energyMode'])} className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100">
              <option value="off">Off (ignore energy)</option>
              <option value="chronotype">Chronotype preset</option>
              <option value="custom">Custom windows</option>
            </select>
          </label>
          {form.energyMode === 'chronotype' && (
            <label className="text-sm text-slate-500 dark:text-neutral-400">
              Chronotype
              <select value={form.chronotype} onChange={(e) => set('chronotype', e.target.value as Settings['chronotype'])} className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100">
                <option value="morning">Morning lark (peak AM)</option>
                <option value="balanced">Balanced (AM + late PM)</option>
                <option value="evening">Night owl (peak PM)</option>
              </select>
            </label>
          )}
          <label className="text-sm text-slate-500 dark:text-neutral-400">
            Deep-work threshold (min)
            <input type="number" value={form.deepWorkMinMin} onChange={(e) => set('deepWorkMinMin', Number(e.target.value))} className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100" />
          </label>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="text-sm text-slate-500 dark:text-neutral-400">
            Deep-work label
            <input value={form.deepLabel} onChange={(e) => set('deepLabel', e.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100" />
          </label>
          <label className="text-sm text-slate-500 dark:text-neutral-400">
            Shallow-work label
            <input value={form.shallowLabel} onChange={(e) => set('shallowLabel', e.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100" />
          </label>
        </div>
        {form.energyMode === 'custom' && (
          <div className="mt-4">
            <EnergyWindowsEditor value={form.energyWindows} onChange={(energyWindows) => set('energyWindows', energyWindows)} />
          </div>
        )}
      </section>

      <LearningPanel enabled={form.learningEnabled} onToggle={(v) => set('learningEnabled', v)} />

      <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <h3 className="mb-1 font-semibold text-slate-900 dark:text-neutral-100">Gamification</h3>
        <p className="mb-3 text-sm text-slate-400 dark:text-neutral-500">XP, levels, and a streak with banked freezes to help you stick to your schedule.</p>
        <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-neutral-400">
          <input type="checkbox" checked={form.gamificationEnabled} onChange={(e) => set('gamificationEnabled', e.target.checked)} />
          Enable XP, levels, streaks, and achievements
        </label>
        {form.gamificationEnabled && (
          <>
            <label className="mt-3 block text-sm text-slate-500 dark:text-neutral-400">
              Streak rule
              <select value={form.streakRule} onChange={(e) => set('streakRule', e.target.value as Settings['streakRule'])} className="mt-1 block w-64 rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100">
                <option value="one_block">Complete at least one block</option>
                <option value="half_planned">Complete at least half of what's planned</option>
              </select>
            </label>
            <label className="mt-3 flex items-center gap-2 text-sm text-slate-600 dark:text-neutral-400">
              <input type="checkbox" checked={form.celebrationToasts} onChange={(e) => set('celebrationToasts', e.target.checked)} />
              Show celebration toasts (+XP, achievements, level-ups)
            </label>
          </>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <h3 className="mb-3 font-semibold text-slate-900 dark:text-neutral-100">Completion behavior</h3>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm text-slate-500 dark:text-neutral-400">
            When a task is completed
            <select value={form.onTaskCompleted} onChange={(e) => set('onTaskCompleted', e.target.value as Settings['onTaskCompleted'])} className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100">
              <option value="rename">Mark the calendar event ✅</option>
              <option value="delete">Delete the calendar event</option>
            </select>
          </label>
          <label className="text-sm text-slate-500 dark:text-neutral-400">
            When a block is deleted in Google Calendar
            <select value={form.onBlockDeleted} onChange={(e) => set('onBlockDeleted', e.target.value as Settings['onBlockDeleted'])} className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100">
              <option value="reschedule">Reschedule the task automatically</option>
              <option value="unschedule">Leave it unscheduled</option>
            </select>
          </label>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <h3 className="mb-3 font-semibold text-slate-900 dark:text-neutral-100">AI daily brief</h3>
        <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-neutral-400">
          <input type="checkbox" checked={form.aiEnabled} onChange={(e) => set('aiEnabled', e.target.checked)} />
          Enable the AI daily brief (requires GEMINI_API_KEY in .env)
        </label>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <h3 className="mb-3 font-semibold text-slate-900 dark:text-neutral-100">Connections</h3>
        <p className="mb-1 text-sm text-slate-500 dark:text-neutral-400">
          Google Calendar: {setup?.google ? <span className="font-medium text-emerald-600 dark:text-emerald-400">Connected</span> : <span className="font-medium text-slate-400 dark:text-neutral-500">Not connected</span>}
        </p>
        <p className="mb-2 text-sm text-slate-500 dark:text-neutral-400">
          Busy calendars: {calendars?.filter((c) => form.busyCalendarIds.includes(c.id)).map((c) => c.summary).join(', ') || 'none'}
        </p>
        <div className="flex items-center gap-2">
          <Link to="/setup" className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 dark:border-neutral-800 dark:text-neutral-400 dark:hover:bg-white/5">
            Edit setup
          </Link>
          <button
            onClick={() =>
              disconnect.mutate(undefined, {
                onSuccess: () => {
                  setDisconnected(true);
                  setTimeout(() => setDisconnected(false), 4000);
                },
              })
            }
            disabled={disconnect.isPending || !setup?.google}
            className="rounded-md border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-500/10"
          >
            {disconnect.isPending ? 'Disconnecting…' : 'Disconnect Google'}
          </button>
          {disconnected && <span className="text-sm text-emerald-600 dark:text-emerald-400">Disconnected.</span>}
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button
          onClick={() =>
            update.mutate(form, {
              onSuccess: () => {
                setSaved(true);
                setTimeout(() => setSaved(false), 3000);
              },
            })
          }
          disabled={update.isPending}
          className="rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Save settings
        </button>
        {saved && <span className="text-sm text-emerald-600 dark:text-emerald-400">Saved.</span>}
      </div>
    </div>
  );
}
