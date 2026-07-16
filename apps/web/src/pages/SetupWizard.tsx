import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useGoogleCalendars, useSaveCalendars, useSettings, useSetupStatus, useUpdateSettings } from '../hooks.js';
import WorkingHoursEditor from '../components/WorkingHoursEditor.js';

function StepShell({ n, title, done, children }: { n: number; title: string; done: boolean; children: React.ReactNode }) {
  return (
    <div className={`rounded-xl border p-5 ${done ? 'border-emerald-200 bg-emerald-50/40 dark:border-emerald-900/50 dark:bg-emerald-500/10' : 'border-slate-200 bg-white dark:border-neutral-800 dark:bg-neutral-900'}`}>
      <div className="mb-3 flex items-center gap-2">
        <span
          className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${done ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-600 dark:bg-neutral-700 dark:text-neutral-300'}`}
        >
          {done ? '✓' : n}
        </span>
        <h2 className="font-semibold text-slate-900 dark:text-neutral-100">{title}</h2>
      </div>
      {children}
    </div>
  );
}

export default function SetupWizard() {
  const [params] = useSearchParams();
  const { data: setup, refetch } = useSetupStatus();
  const { data: settings } = useSettings();
  const updateSettings = useUpdateSettings();

  const { data: calendars } = useGoogleCalendars(!!setup?.google);
  const saveCalendars = useSaveCalendars();
  const [selectedCalendars, setSelectedCalendars] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (params.get('connected')) void refetch();
  }, [params, refetch]);

  useEffect(() => {
    if (settings?.busyCalendarIds) setSelectedCalendars(new Set(settings.busyCalendarIds));
  }, [settings?.busyCalendarIds]);

  if (!setup || !settings) return <div className="p-8 text-slate-500 dark:text-neutral-400">Loading…</div>;

  const allDone = setup.google && setup.calendarChosen;

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="mb-1 text-2xl font-bold text-slate-900 dark:text-neutral-100">Set up TimeBlock</h1>
      <p className="mb-6 text-slate-500 dark:text-neutral-400">Connect Google Calendar, then tell it when you're free.</p>

      <div className="space-y-4">
        <StepShell n={1} title="Connect Google Calendar" done={setup.google}>
          {!setup.googleCredsPresent ? (
            <p className="text-sm text-red-600 dark:text-red-400">
              GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set in your .env file yet. Add them (see .env.example) and restart the server.
            </p>
          ) : setup.google ? (
            <p className="text-sm text-emerald-700 dark:text-emerald-400">Connected.</p>
          ) : (
            <a
              href="/api/auth/google/start"
              className="inline-block rounded-md bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-500"
            >
              Connect Google Calendar
            </a>
          )}
        </StepShell>

        <StepShell n={2} title="Pick calendars to treat as busy" done={setup.calendarChosen}>
          {!setup.google ? (
            <p className="text-sm text-slate-400 dark:text-neutral-500">Connect Google first.</p>
          ) : (
            <>
              <p className="mb-2 text-sm text-slate-500 dark:text-neutral-400">
                TimeBlock creates its own "⏱ Time Blocks" calendar for your blocks. Pick which other calendars count as
                existing commitments it should schedule around.
              </p>
              <div className="mb-3 space-y-1">
                {(calendars ?? []).map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-sm dark:text-neutral-300">
                    <input
                      type="checkbox"
                      checked={selectedCalendars.has(c.id)}
                      onChange={(e) => {
                        const next = new Set(selectedCalendars);
                        if (e.target.checked) next.add(c.id);
                        else next.delete(c.id);
                        setSelectedCalendars(next);
                      }}
                    />
                    {c.summary} {c.primary && <span className="text-slate-400 dark:text-neutral-500">(primary)</span>}
                  </label>
                ))}
              </div>
              <button
                onClick={() => saveCalendars.mutate([...selectedCalendars])}
                disabled={saveCalendars.isPending}
                className="rounded-md bg-teal-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                Save calendars
              </button>
            </>
          )}
        </StepShell>

        <StepShell n={3} title="Timezone & working hours" done={true}>
          <div className="mb-3 flex items-center gap-2 text-sm">
            <span className="text-slate-500 dark:text-neutral-400">Timezone:</span>
            <input
              value={settings.timezone}
              onChange={(e) => updateSettings.mutate({ timezone: e.target.value })}
              className="rounded-md border border-slate-300 px-2 py-1 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            />
          </div>
          <WorkingHoursEditor value={settings.workingHours} onChange={(workingHours) => updateSettings.mutate({ workingHours })} />
        </StepShell>
      </div>

      {allDone && (
        <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-center dark:border-emerald-900/50 dark:bg-emerald-500/10">
          <p className="mb-2 font-medium text-emerald-800 dark:text-emerald-300">You're all set.</p>
          <Link to="/today" className="inline-block rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white">
            Go to Today
          </Link>
        </div>
      )}
    </div>
  );
}
