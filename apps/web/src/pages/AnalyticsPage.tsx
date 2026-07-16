import { useState } from 'react';
import { DateTime } from 'luxon';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { DayResultDTO } from '@timeblock/shared';
import { useAchievements, useAnalyticsWeekly, useGamificationSummary, useHabits, useStreakCalendar, useXpHistory } from '../hooks.js';

const DAY_RESULT_COLOR: Record<DayResultDTO['result'], string> = {
  met: 'bg-emerald-500',
  freeze: 'bg-sky-400',
  missed: 'bg-red-300',
  rest: 'bg-slate-100 dark:bg-neutral-800',
};

function StreakCalendar() {
  const { data: days } = useStreakCalendar(12);
  if (!days?.length) return <p className="text-sm text-slate-400 dark:text-neutral-500">No history yet.</p>;
  const byDate = new Map(days.map((d) => [d.date, d]));
  const start = DateTime.fromISO(days[0].date).startOf('week');
  const end = DateTime.fromISO(days[days.length - 1].date).endOf('week');
  const weeks: DateTime[][] = [];
  let cursor = start;
  while (cursor <= end) {
    const week: DateTime[] = [];
    for (let i = 0; i < 7; i++) week.push(cursor.plus({ days: i }));
    weeks.push(week);
    cursor = cursor.plus({ weeks: 1 });
  }
  return (
    <div className="flex gap-1 overflow-x-auto pb-1">
      {weeks.map((week, i) => (
        <div key={i} className="flex flex-col gap-1">
          {week.map((d) => {
            const iso = d.toISODate()!;
            const r = byDate.get(iso);
            return (
              <div
                key={iso}
                title={r ? `${iso} · ${r.result}` : iso}
                className={`h-3 w-3 rounded-sm ${r ? DAY_RESULT_COLOR[r.result] : 'bg-slate-50 dark:bg-neutral-800/50'}`}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

function AchievementsGallery() {
  const { data: achievements } = useAchievements();
  if (!achievements?.length) return null;
  return (
    <div className="grid grid-cols-4 gap-3 sm:grid-cols-5">
      {achievements.map((a) => (
        <div
          key={a.id}
          title={`${a.name} — ${a.description}${a.unlockedAt ? '' : ' (locked)'}`}
          className={`flex flex-col items-center gap-1 rounded-lg border p-3 text-center ${
            a.unlockedAt ? 'border-slate-200 bg-white dark:border-neutral-800 dark:bg-neutral-900' : 'border-slate-100 bg-slate-50 grayscale opacity-50 dark:border-neutral-800 dark:bg-neutral-800/50'
          }`}
        >
          <span className="text-2xl">{a.icon}</span>
          <span className="text-[10px] font-medium leading-tight text-slate-600 dark:text-neutral-400">{a.name}</span>
        </div>
      ))}
    </div>
  );
}

export default function AnalyticsPage() {
  const [weekStart, setWeekStart] = useState(() => DateTime.now().startOf('week').toISODate()!);
  const { data: weekly, isLoading } = useAnalyticsWeekly(weekStart);
  const { data: habits } = useHabits();
  const { data: xpHistory } = useXpHistory(30);
  const { data: gamification } = useGamificationSummary();

  const chartData = (weekly?.days ?? []).map((d) => ({
    day: DateTime.fromISO(d.date).toFormat('EEE'),
    Planned: d.plannedMin,
    Completed: d.completedMin,
    Missed: d.missedMin,
    External: d.externalBusyMin,
  }));

  const projectRows = Object.entries(weekly?.byProject ?? {}).sort((a, b) => b[1].planned - a[1].planned);
  const maxProjectMin = Math.max(1, ...projectRows.map(([, v]) => v.planned));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-neutral-100">Analytics</h1>
        <div className="flex items-center gap-2 text-sm">
          <button onClick={() => setWeekStart(DateTime.fromISO(weekStart).minus({ weeks: 1 }).toISODate()!)} className="rounded border border-slate-200 px-2 py-1 hover:bg-slate-50 dark:border-neutral-800 dark:hover:bg-white/5">
            ←
          </button>
          <span className="text-slate-500 dark:text-neutral-400">Week of {weekStart}</span>
          <button onClick={() => setWeekStart(DateTime.fromISO(weekStart).plus({ weeks: 1 }).toISODate()!)} className="rounded border border-slate-200 px-2 py-1 hover:bg-slate-50 dark:border-neutral-800 dark:hover:bg-white/5">
            →
          </button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-slate-400 dark:text-neutral-500">Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: 'Planned', value: weekly?.totals.plannedMin ?? 0 },
              { label: 'Completed', value: weekly?.totals.completedMin ?? 0 },
              { label: 'Missed', value: weekly?.totals.missedMin ?? 0 },
              { label: 'External busy', value: weekly?.totals.externalBusyMin ?? 0 },
            ].map((s) => (
              <div key={s.label} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
                <p className="text-xs text-slate-400 dark:text-neutral-500">{s.label}</p>
                <p className="text-2xl font-semibold text-slate-900 dark:text-neutral-100">{Math.round(s.value / 60)}h</p>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
            <h3 className="mb-3 font-semibold text-slate-900 dark:text-neutral-100">Daily minutes</h3>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="day" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="Completed" stackId="a" fill="#10b981" />
                <Bar dataKey="Missed" stackId="a" fill="#ef4444" />
                <Bar dataKey="External" stackId="a" fill="#94a3b8" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
              <h3 className="mb-3 font-semibold text-slate-900 dark:text-neutral-100">Time by project</h3>
              {projectRows.length === 0 ? (
                <p className="text-sm text-slate-400 dark:text-neutral-500">No data yet.</p>
              ) : (
                <ul className="space-y-2">
                  {projectRows.map(([name, v]) => (
                    <li key={name}>
                      <div className="mb-0.5 flex justify-between text-xs text-slate-500 dark:text-neutral-400">
                        <span>{name}</span>
                        <span>{v.planned}min</span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-neutral-800">
                        <div className="h-full rounded-full bg-teal-500" style={{ width: `${(v.planned / maxProjectMin) * 100}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
              <h3 className="mb-3 font-semibold text-slate-900 dark:text-neutral-100">Habit streaks</h3>
              {!habits?.length ? (
                <p className="text-sm text-slate-400 dark:text-neutral-500">No habits yet.</p>
              ) : (
                <ul className="space-y-2">
                  {habits.map((h) => (
                    <li key={h.id} className="flex items-center justify-between text-sm">
                      <span className="text-slate-700 dark:text-neutral-300">{h.name}</span>
                      <span className="text-slate-500 dark:text-neutral-400">🔥 {h.streakDays}d</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {gamification?.enabled && (
            <>
              <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
                <h3 className="mb-3 font-semibold text-slate-900 dark:text-neutral-100">XP over time</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={xpHistory ?? []}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d: string) => DateTime.fromISO(d).toFormat('MMM d')} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip labelFormatter={(d: string) => DateTime.fromISO(d).toFormat('MMM d')} />
                    <Area type="monotone" dataKey="xp" stroke="#6366f1" fill="#c7d2fe" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
                <h3 className="mb-3 font-semibold text-slate-900 dark:text-neutral-100">Streak calendar</h3>
                <StreakCalendar />
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
                <h3 className="mb-3 font-semibold text-slate-900 dark:text-neutral-100">Achievements</h3>
                <AchievementsGallery />
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
