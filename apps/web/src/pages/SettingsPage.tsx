import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Cloud, Download, RefreshCw } from 'lucide-react';
import type { Settings } from '@timeblock/shared';
import { useAiUsageDashboard, useBackupDriveNow, useDisconnectGoogle, useDriveBackupStatus, useDriveBackups, useDriveConnection, useGoogleCalendars, useLearningStats, useResetLearning, useRestoreDriveBackup, useSettings, useSetupStatus, useUpdateSettings } from '../hooks.js';
import { useConceptStatus, useEmbeddingsStatus, useExtractConcepts, useRebuildGraph, useReindexEmbeddings } from '../hooks/notes.js';
import WorkingHoursEditor from '../components/WorkingHoursEditor.js';
import EnergyWindowsEditor from '../components/EnergyWindowsEditor.js';
import DesktopUpdatePanel from '../components/DesktopUpdatePanel.js';

function fmtHour(h: number) {
  const period = h < 12 ? 'am' : 'pm';
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}${period}`;
}

function fmtTokens(value: number) {
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

function fmtUsd(value: number | null) {
  return value == null ? '—' : new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);
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
  const { data: embeddingsStatus } = useEmbeddingsStatus();
  const reindexEmbeddings = useReindexEmbeddings();
  const rebuildGraph = useRebuildGraph();
  const conceptStatus = useConceptStatus();
  const extractConcepts = useExtractConcepts();
  const drive = useDriveConnection();
  const driveStatus = useDriveBackupStatus();
  const driveBackups = useDriveBackups(!!drive.data?.connected);
  const backupNow = useBackupDriveNow();
  const restoreBackup = useRestoreDriveBackup();
  const aiUsage = useAiUsageDashboard();

  useEffect(() => {
    if (settings && !form) setForm(settings);
  }, [settings, form]);

  if (!form) return <div className="text-slate-400 dark:text-neutral-500">Loading…</div>;

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setForm({ ...form, [key]: value });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-lg font-semibold text-slate-900 dark:text-neutral-100">Settings</h1>

      <DesktopUpdatePanel />

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
        <h3 className="mb-1 font-semibold text-slate-900 dark:text-neutral-100">Sounds</h3>
        <p className="mb-3 text-sm text-slate-400 dark:text-neutral-500">
          Short synthesized chimes — task completed, reminder fired, level-up, achievement, focus timer done.
        </p>
        <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-neutral-400">
          <input type="checkbox" checked={form.soundEffects} onChange={(e) => set('soundEffects', e.target.checked)} />
          Play sound effects
        </label>
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
        <h3 className="mb-1 font-semibold text-slate-900 dark:text-neutral-100">AI features</h3>
        <p className="mb-3 text-sm text-slate-400 dark:text-neutral-500">
          One switch for every outbound AI call this app makes — the daily brief, Second Brain semantic search, related notes, Vault chat, link/tag
          suggestions, and weekly digests. Off means nothing ever leaves your machine. Configure <code>OPENROUTER_API_KEY</code> (recommended) or{' '}
          <code>GEMINI_API_KEY</code> in <code>.env</code>.
        </p>
        <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-neutral-400">
          <input type="checkbox" checked={form.aiEnabled} onChange={(e) => set('aiEnabled', e.target.checked)} />
          Enable AI features
        </label>

        <div className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50/50 p-3 dark:border-indigo-500/20 dark:bg-indigo-950/15">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-800 dark:text-neutral-100">AI usage & limit</p>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-neutral-400">
                {aiUsage.data ? `${aiUsage.data.provider} · ${aiUsage.data.generationModel}` : 'Checking configured provider…'}
              </p>
            </div>
            <button type="button" onClick={() => void aiUsage.refetch()} className="rounded-md p-1 text-slate-500 hover:bg-white/70 dark:hover:bg-white/10" title="Refresh AI usage">
              <RefreshCw size={14} className={aiUsage.isFetching ? 'animate-spin' : ''} />
            </button>
          </div>
          {aiUsage.data ? (
            <>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="rounded-lg bg-white/70 p-2 dark:bg-neutral-900/60"><p className="text-[11px] text-slate-500">This month</p><p className="text-sm font-semibold text-slate-800 dark:text-neutral-100">{fmtUsd(aiUsage.data.local.estimatedUsd)}</p></div>
                <div className="rounded-lg bg-white/70 p-2 dark:bg-neutral-900/60"><p className="text-[11px] text-slate-500">Billable tokens</p><p className="text-sm font-semibold text-slate-800 dark:text-neutral-100">{fmtTokens(aiUsage.data.local.billableTokens)}</p></div>
                <div className="rounded-lg bg-white/70 p-2 dark:bg-neutral-900/60"><p className="text-[11px] text-slate-500">API calls</p><p className="text-sm font-semibold text-slate-800 dark:text-neutral-100">{aiUsage.data.local.calls}</p></div>
                <div className="rounded-lg bg-white/70 p-2 dark:bg-neutral-900/60"><p className="text-[11px] text-slate-500">Remaining</p><p className="text-sm font-semibold text-slate-800 dark:text-neutral-100">{fmtUsd(aiUsage.data.providerBalance.remainingCreditsUsd ?? aiUsage.data.providerBalance.keyRemainingUsd)}</p></div>
              </div>
              <p className="mt-3 text-xs leading-5 text-slate-600 dark:text-neutral-300">
                {aiUsage.data.providerBalance.remainingCreditsUsd != null
                  ? `OpenRouter account credits: ${fmtUsd(aiUsage.data.providerBalance.usedCreditsUsd)} used of ${fmtUsd(aiUsage.data.providerBalance.totalCreditsUsd)}.`
                  : aiUsage.data.providerBalance.keyRemainingUsd != null
                    ? `This API key has ${fmtUsd(aiUsage.data.providerBalance.keyRemainingUsd)} remaining from its ${fmtUsd(aiUsage.data.providerBalance.keyLimitUsd)} ${aiUsage.data.providerBalance.reset ?? ''} limit.`
                    : aiUsage.data.providerBalance.message ?? 'Provider balance is unavailable for this key.'}
              </p>
              {aiUsage.data.local.calls === 0 && <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">Local token tracking starts after the telemetry database migration has run and the next AI request completes.</p>}
            </>
          ) : aiUsage.isError ? <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">Usage information is unavailable right now.</p> : null}
        </div>

        {form.aiEnabled && (
          <div className="mt-4 space-y-3 border-t border-slate-100 pt-4 dark:border-neutral-800">
            <label className="block text-sm text-slate-500 dark:text-neutral-400">
              About me — seeds Vault Chat's system prompt so answers are framed the way you'd want
              <textarea
                value={form.aiAboutMe}
                dir="auto"
                onChange={(e) => set('aiAboutMe', e.target.value)}
                rows={4}
                className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
              />
            </label>
            <label className="block text-sm text-slate-500 dark:text-neutral-400">
              Writing samples — paste a few of your own posts so LinkedIn drafts match your voice
              <textarea
                value={form.aiWritingSamples}
                dir="auto"
                onChange={(e) => set('aiWritingSamples', e.target.value)}
                rows={6}
                className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
              />
            </label>
            <div className="rounded-xl border border-amber-200/70 bg-amber-50/60 p-3 dark:border-amber-500/15 dark:bg-amber-950/10">
              <div className="mb-3">
                <p className="text-sm font-semibold text-slate-800 dark:text-neutral-100">Personal chief of staff</p>
                <p className="mt-0.5 text-xs leading-5 text-slate-500 dark:text-neutral-400">
                  Each layer can be rolled back independently. Turning off the master switch restores the original note-only Vault Chat.
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {([
                  ['assistantEnabled', 'Unified assistant'],
                  ['assistantMemoryEnabled', 'Explainable memory'],
                  ['assistantActionsEnabled', 'Approval-gated actions'],
                  ['assistantProactiveEnabled', 'Briefs and insights'],
                  ['assistantConnectorsEnabled', 'Communication connectors'],
                ] as const).map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 rounded-lg bg-white/70 px-3 py-2 text-xs text-slate-600 dark:bg-neutral-900/60 dark:text-neutral-300">
                    <input type="checkbox" checked={form[key]} onChange={(event) => set(key, event.target.checked)} />
                    {label}
                  </label>
                ))}
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <label className="text-xs text-slate-500 dark:text-neutral-400">
                  Quiet from
                  <input type="time" value={form.assistantQuietHoursStart} onChange={(event) => set('assistantQuietHoursStart', event.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-900" />
                </label>
                <label className="text-xs text-slate-500 dark:text-neutral-400">
                  Quiet until
                  <input type="time" value={form.assistantQuietHoursEnd} onChange={(event) => set('assistantQuietHoursEnd', event.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-900" />
                </label>
                <label className="text-xs text-slate-500 dark:text-neutral-400">
                  Alerts / day
                  <input type="number" min={0} max={20} value={form.assistantDailyNotificationBudget} onChange={(event) => set('assistantDailyNotificationBudget', Number(event.target.value))} className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-900" />
                </label>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm text-slate-500 dark:text-neutral-400">
                Generation model
                <input
                  value={form.aiModel}
                  onChange={(e) => set('aiModel', e.target.value)}
                  placeholder="google/gemini-3.5-flash-lite"
                  className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                />
              </label>
              <label className="text-sm text-slate-500 dark:text-neutral-400">
                Embedding model
                <input
                  value={form.aiEmbeddingModel}
                  onChange={(e) => set('aiEmbeddingModel', e.target.value)}
                  className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                />
              </label>
              <label className="text-sm text-slate-500 dark:text-neutral-400">
                Digests folder
                <input
                  value={form.notesDigestFolder}
                  onChange={(e) => set('notesDigestFolder', e.target.value)}
                  className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                />
              </label>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-neutral-800">
              <span className="text-slate-500 dark:text-neutral-400">
                Semantic index: {embeddingsStatus ? `${embeddingsStatus.count} chunks embedded` : '…'}
                {embeddingsStatus && !embeddingsStatus.aiEnabled && ' (AI off or unconfigured)'}
              </span>
              <button
                type="button"
                onClick={() => reindexEmbeddings.mutate()}
                disabled={reindexEmbeddings.isPending}
                className="flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-white disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-900"
              >
                <RefreshCw size={12} className={reindexEmbeddings.isPending ? 'animate-spin' : ''} />
                {reindexEmbeddings.isPending ? 'Reindexing…' : 'Reindex embeddings'}
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <h3 className="mb-1 font-semibold text-slate-900 dark:text-neutral-100">Second Brain vault</h3>
        <p className="mb-3 text-sm text-slate-400 dark:text-neutral-500">
          Where your notes live as plain markdown files on disk. Leave blank to use the default (<code>data/vault</code>).
        </p>
        <label className="mb-3 block text-sm text-slate-500 dark:text-neutral-400">
          Vault folder (absolute path)
          <input
            value={form.notesVaultPath ?? ''}
            onChange={(e) => set('notesVaultPath', e.target.value.trim() ? e.target.value : null)}
            placeholder="C:\Users\you\Notes"
            className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm text-slate-500 dark:text-neutral-400">
            Trash retention (days)
            <input
              type="number"
              value={form.notesTrashRetentionDays}
              onChange={(e) => set('notesTrashRetentionDays', Number(e.target.value))}
              className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            />
          </label>
          <label className="text-sm text-slate-500 dark:text-neutral-400">
            Snapshots kept per note
            <input
              type="number"
              value={form.notesSnapshotRetention}
              onChange={(e) => set('notesSnapshotRetention', Number(e.target.value))}
              className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            />
          </label>
          <label className="text-sm text-slate-500 dark:text-neutral-400">
            Daily notes folder
            <input
              value={form.notesDailyFolder}
              onChange={(e) => set('notesDailyFolder', e.target.value)}
              className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            />
          </label>
          <label className="text-sm text-slate-500 dark:text-neutral-400">
            Templates folder
            <input
              value={form.notesTemplatesFolder}
              onChange={(e) => set('notesTemplatesFolder', e.target.value)}
              className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            />
          </label>
          <label className="text-sm text-slate-500 dark:text-neutral-400">
            Inbox folder
            <input
              value={form.notesInboxFolder}
              onChange={(e) => set('notesInboxFolder', e.target.value)}
              className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            />
          </label>
          <label className="text-sm text-slate-500 dark:text-neutral-400">
            Content drafts folder
            <input
              value={form.notesContentDraftsFolder}
              onChange={(e) => set('notesContentDraftsFolder', e.target.value)}
              className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            />
          </label>
          <label className="text-sm text-slate-500 dark:text-neutral-400">
            Attachments folder
            <input
              value={form.notesAttachmentsFolder}
              onChange={(e) => set('notesAttachmentsFolder', e.target.value)}
              className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            />
          </label>
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm text-slate-600 dark:text-neutral-400">
          <input type="checkbox" checked={form.notesImageOcrEnabled} onChange={(e) => set('notesImageOcrEnabled', e.target.checked)} />
          Extract OCR text from pasted screenshots and images
        </label>
        <div className="mt-3 flex flex-wrap gap-4 text-sm text-slate-600 dark:text-neutral-400">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.notesZenModeDefault} onChange={(e) => set('notesZenModeDefault', e.target.checked)} />
            Start the note editor in zen mode
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.notesVimModeDefault} onChange={(e) => set('notesVimModeDefault', e.target.checked)} />
            Enable Vim-style editor keys by default
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-4 text-sm text-slate-600 dark:text-neutral-400">
          <label className="grid gap-1">
            <span className="text-xs font-medium">Formatting toolbar style</span>
            <select value={form.notesToolbarStyle} onChange={(e) => set('notesToolbarStyle', e.target.value as Settings['notesToolbarStyle'])} className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800">
              <option value="standard">Standard</option>
              <option value="tiny">Tiny (icons only)</option>
            </select>
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-medium">Formatting toolbar position</span>
            <select value={form.notesToolbarPosition} onChange={(e) => set('notesToolbarPosition', e.target.value as Settings['notesToolbarPosition'])} className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800">
              <option value="top">Top of editor</option>
              <option value="following">Follow cursor</option>
            </select>
          </label>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mb-1 flex items-center gap-2">
          <Cloud size={16} className="text-teal-600" />
          <h3 className="font-semibold text-slate-900 dark:text-neutral-100">Google Drive mirror</h3>
        </div>
        <p className="mb-3 text-sm text-slate-400 dark:text-neutral-500">
          Your local markdown vault remains the source of truth. Drive receives app-created ZIP snapshots only; restoring always creates an isolated inspection folder.
        </p>
        {!drive.data?.encryptionConfigured && (
          <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-500/10 dark:text-amber-200">
            Add <code>TB_TOKEN_ENCRYPTION_KEY</code> (at least 32 characters) to <code>.env</code> before connecting. OAuth refresh tokens are AES-256-GCM encrypted at rest.
          </p>
        )}
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <span className={drive.data?.connected ? 'font-medium text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-neutral-400'}>
            {drive.data?.connected ? `Connected${drive.data.accountEmail ? ` as ${drive.data.accountEmail}` : ''}` : 'Not connected'}
          </span>
          <a
            href={`/api/drive/connect${form.driveReadOnlyEnabled ? '?broader=1' : ''}`}
            className="rounded-md border border-teal-200 px-2.5 py-1 text-xs text-teal-700 hover:bg-teal-50 dark:border-teal-900 dark:text-teal-300 dark:hover:bg-teal-500/10"
          >
            {drive.data?.connected ? 'Reconnect / update permissions' : 'Connect Drive'}
          </a>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-sm text-slate-500 dark:text-neutral-400">
            Backup interval (hours; 0 = manual)
            <input type="number" min="0" max="744" value={form.driveBackupIntervalHours} onChange={(e) => set('driveBackupIntervalHours', Number(e.target.value))} className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100" />
          </label>
          <label className="text-sm text-slate-500 dark:text-neutral-400">
            Snapshots to keep
            <input type="number" min="1" max="365" value={form.driveBackupRetention} onChange={(e) => set('driveBackupRetention', Number(e.target.value))} className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100" />
          </label>
          <label className="text-sm text-slate-500 dark:text-neutral-400 sm:col-span-2">
            Backup passphrase (optional AES encryption for future snapshots)
            <input
              type="password"
              value={form.driveBackupPassphrase}
              onChange={(e) => set('driveBackupPassphrase', e.target.value)}
              placeholder="Leave blank to upload plain ZIP snapshots"
              className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            />
            <span className="mt-1 block text-xs text-slate-400 dark:text-neutral-500">Keep this passphrase stable if you want to restore older encrypted backups from this app later.</span>
          </label>
        </div>
        <label className="mt-3 flex items-start gap-2 text-sm text-slate-600 dark:text-neutral-400">
          <input type="checkbox" checked={form.driveReadOnlyEnabled} onChange={(e) => set('driveReadOnlyEnabled', e.target.checked)} className="mt-0.5" />
          <span><strong>Enable Drive search and Google Doc import</strong><br /><span className="text-xs text-slate-400 dark:text-neutral-500">Requests the broader read-only Drive permission after you save and reconnect. This is separate from the app-created backup folder.</span></span>
        </label>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => backupNow.mutate()} disabled={!drive.data?.connected || backupNow.isPending} className="flex items-center gap-1 rounded-md bg-teal-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
            <Cloud size={14} /> {backupNow.isPending ? 'Backing up…' : 'Backup now'}
          </button>
          {driveStatus.data?.lastBackupAt && <span className="text-xs text-slate-500 dark:text-neutral-400">Last backup {new Date(driveStatus.data.lastBackupAt).toLocaleString()}</span>}
          {driveStatus.data?.lastBackupError && <span className="text-xs text-rose-600 dark:text-rose-400">Backup failed: {driveStatus.data.lastBackupError}</span>}
        </div>
        {driveBackups.data && driveBackups.data.length > 0 && (
          <div className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-100 dark:divide-neutral-800 dark:border-neutral-800">
            {driveBackups.data.map((backup) => (
              <div key={backup.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="min-w-0 truncate text-slate-600 dark:text-neutral-300">{backup.name}</span>
                <button type="button" onClick={() => restoreBackup.mutate(backup.id)} disabled={restoreBackup.isPending} className="flex shrink-0 items-center gap-1 text-xs text-teal-700 hover:underline dark:text-teal-300"><Download size={12} /> Restore for inspection</button>
              </div>
            ))}
          </div>
        )}
        {restoreBackup.data && <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">Snapshot downloaded to {restoreBackup.data.inspectionPath}. Extract it there to inspect; your active vault was not changed.</p>}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mb-1 flex items-center justify-between">
          <h3 className="font-semibold text-slate-900 dark:text-neutral-100">Graph</h3>
          <button
            type="button"
            onClick={() => rebuildGraph.mutate()}
            disabled={rebuildGraph.isPending}
            className="flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            <RefreshCw size={12} className={rebuildGraph.isPending ? 'animate-spin' : ''} />
            {rebuildGraph.isPending ? 'Rebuilding…' : 'Rebuild graph index'}
          </button>
        </div>
        <p className="mb-3 text-sm text-slate-400 dark:text-neutral-500">
          Tunes how the flagship graph connects and encodes your notes. Metrics and edges are a rebuildable cache over your files.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm text-slate-500 dark:text-neutral-400">
            Semantic edge threshold (0–1)
            <input
              type="number"
              step="0.01"
              min="0"
              max="1"
              value={form.graphSemanticThreshold}
              onChange={(e) => set('graphSemanticThreshold', Number(e.target.value))}
              className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            />
          </label>
          <label className="text-sm text-slate-500 dark:text-neutral-400">
            Semantic edges per note (0 = off)
            <input
              type="number"
              min="0"
              max="20"
              value={form.graphSemanticTopK}
              onChange={(e) => set('graphSemanticTopK', Number(e.target.value))}
              className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            />
          </label>
          <label className="text-sm text-slate-500 dark:text-neutral-400">
            Min shared tags for a tag edge
            <input
              type="number"
              min="1"
              max="10"
              value={form.graphTagCoocMin}
              onChange={(e) => set('graphTagCoocMin', Number(e.target.value))}
              className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            />
          </label>
          <label className="text-sm text-slate-500 dark:text-neutral-400">
            Freshness fade (days)
            <input
              type="number"
              min="1"
              max="3650"
              value={form.graphFreshnessFadeDays}
              onChange={(e) => set('graphFreshnessFadeDays', Number(e.target.value))}
              className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            />
          </label>
          <label className="text-sm text-slate-500 dark:text-neutral-400">
            Suggested-link threshold
            <input
              type="number"
              step="0.01"
              min="0"
              max="1"
              value={form.graphSuggestThreshold}
              onChange={(e) => set('graphSuggestThreshold', Number(e.target.value))}
              className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            />
          </label>
          <label className="text-sm text-slate-500 dark:text-neutral-400">
            Label LOD camera ratio
            <input
              type="number"
              step="0.05"
              min="0.01"
              max="20"
              value={form.graphLodLabelThreshold}
              onChange={(e) => set('graphLodLabelThreshold', Number(e.target.value))}
              className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            />
          </label>
          <label className="text-sm text-slate-500 dark:text-neutral-400">
            Optional-edge LOD ratio
            <input
              type="number"
              step="0.05"
              min="0.01"
              max="20"
              value={form.graphLodEdgeThreshold}
              onChange={(e) => set('graphLodEdgeThreshold', Number(e.target.value))}
              className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-4 text-sm text-slate-500 dark:text-neutral-400">
          {([
            ['graphDefaultSemanticEdges', 'Semantic edges on by default'],
            ['graphDefaultTagEdges', 'Tag edges on by default'],
            ['graphDefaultConceptLayer', 'Concept layer on by default'],
          ] as const).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2">
              <input type="checkbox" checked={form[key]} onChange={(e) => set(key, e.target.checked)} className="accent-teal-600" />
              {label}
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-400 dark:text-neutral-500">Rebuild after changing thresholds to apply them to existing notes.</p>

        <div className="mt-4 flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-neutral-800">
          <span className="text-slate-500 dark:text-neutral-400">
            Concepts (AI):{' '}
            {conceptStatus.data
              ? `${conceptStatus.data.conceptCount} extracted from ${conceptStatus.data.extractedNotes}/${conceptStatus.data.totalNotes} notes`
              : '…'}
            {conceptStatus.data && !conceptStatus.data.aiEnabled && ' (AI off or unconfigured)'}
            {conceptStatus.data?.running && ' · running…'}
          </span>
          <button
            type="button"
            onClick={() => extractConcepts.mutate()}
            disabled={extractConcepts.isPending || conceptStatus.data?.running || !conceptStatus.data?.aiEnabled}
            className="flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-white disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-900"
          >
            <RefreshCw size={12} className={extractConcepts.isPending || conceptStatus.data?.running ? 'animate-spin' : ''} />
            Extract concepts
          </button>
        </div>
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
