import { AlertTriangle, CalendarX2, AlarmClockOff, CalendarClock, Gauge } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { PlanWarningDTO } from '@timeblock/shared';
import { fmtDur } from './format.js';

type Severity = 'critical' | 'warn';

interface WarningView {
  title: string;
  detail: string;
  icon: LucideIcon;
  severity: Severity;
}

function warningView(w: PlanWarningDTO): WarningView {
  const name = w.taskContent ?? 'A task';
  const day = w.date ? new Date(w.date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long' }) : null;
  switch (w.kind) {
    case 'unplaceable':
      return {
        title: `${name} won't fit`,
        detail: 'No open slot in your working hours before the horizon ends.',
        icon: CalendarX2,
        severity: 'critical',
      };
    case 'past_deadline':
      return {
        title: `${name} is overdue`,
        detail: 'Its deadline has already passed — reschedule or drop it.',
        icon: AlarmClockOff,
        severity: 'critical',
      };
    case 'placed_after_deadline':
      return {
        title: `${name} will miss its deadline`,
        detail: 'The earliest open slot is after the deadline.',
        icon: CalendarClock,
        severity: 'warn',
      };
    case 'capacity_shortfall':
      return {
        title: `${day ?? 'That day'} is over-committed${w.shortfallMin ? ` by ${fmtDur(w.shortfallMin)}` : ''}`,
        detail: `Not everything due can fit in time — ${name} is the most likely to slip.`,
        icon: Gauge,
        severity: 'warn',
      };
    default:
      return { title: name, detail: '', icon: AlertTriangle, severity: 'warn' };
  }
}

const sev = {
  critical: {
    rail: 'bg-rose-400',
    chip: 'bg-rose-500/15 text-rose-300 ring-1 ring-rose-400/25',
    label: 'text-rose-300',
  },
  warn: {
    rail: 'bg-amber-400',
    chip: 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-400/25',
    label: 'text-amber-300',
  },
} as const;

export default function WarningsCard({ warnings }: { warnings: PlanWarningDTO[] }) {
  if (warnings.length === 0) return null;

  const views = warnings.map(warningView).sort((a, b) => {
    // Surface the most severe first.
    if (a.severity === b.severity) return 0;
    return a.severity === 'critical' ? -1 : 1;
  });
  const criticalCount = views.filter((v) => v.severity === 'critical').length;
  const accent = criticalCount > 0 ? sev.critical : sev.warn;

  return (
    <section className="g-card overflow-hidden">
      <header className="flex items-center gap-3 px-5 pt-4 pb-3">
        <span className={`grid h-8 w-8 place-items-center rounded-xl ${accent.chip}`}>
          <AlertTriangle className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-[var(--g-text)]">Heads up</h3>
          <p className="text-xs text-[var(--g-text-faint)]">
            {criticalCount > 0
              ? `${criticalCount} need${criticalCount === 1 ? 's' : ''} attention now`
              : `${warnings.length} thing${warnings.length === 1 ? '' : 's'} to keep an eye on`}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${accent.chip}`}>
          {warnings.length}
        </span>
      </header>

      <ul className="flex flex-col gap-px bg-[var(--g-border)]">
        {views.map((v, i) => {
          const s = sev[v.severity];
          const Icon = v.icon;
          return (
            <li key={i} className="relative flex items-start gap-3 bg-[var(--g-surface)] px-5 py-3">
              <span className={`absolute left-0 top-0 h-full w-[3px] ${s.rail}`} aria-hidden />
              <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg ${s.chip}`}>
                <Icon className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium leading-snug text-[var(--g-text)]">{v.title}</p>
                <p className="mt-0.5 text-xs leading-snug text-[var(--g-text-dim)]">{v.detail}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
