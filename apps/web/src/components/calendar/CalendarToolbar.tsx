import { useState } from 'react';
import { DateTime } from 'luxon';
import { CalendarDays, ChevronLeft, ChevronRight, PanelRightClose, PanelRightOpen } from 'lucide-react';
import MiniMonth from './MiniMonth.js';
import { STYLES } from './EventCard.js';

export type CalendarView = 'timeGridDay' | 'timeGridWeek' | 'dayGridMonth' | 'multiMonthYear';
export type SlotDuration = '00:15:00' | '00:30:00' | '01:00:00';

const VIEWS: { key: CalendarView; label: string; hotkey: string }[] = [
  { key: 'timeGridDay', label: 'Day', hotkey: 'D' },
  { key: 'timeGridWeek', label: 'Week', hotkey: 'W' },
  { key: 'dayGridMonth', label: 'Month', hotkey: 'M' },
  { key: 'multiMonthYear', label: 'Year', hotkey: 'Y' },
];

const KIND_LEGEND: { key: keyof typeof STYLES; label: string }[] = [
  { key: 'task', label: 'Task' },
  { key: 'habit', label: 'Habit' },
  { key: 'done', label: 'Done' },
  { key: 'missed', label: 'Missed' },
  { key: 'external', label: 'Busy' },
];

const PRIORITY_CHIPS: { key: 1 | 2 | 3 | 4; label: string; color: string }[] = [
  { key: 4, label: 'Urgent', color: 'var(--tb-p1)' },
  { key: 3, label: 'High', color: 'var(--tb-p2)' },
  { key: 2, label: 'Medium', color: 'var(--tb-p3)' },
  { key: 1, label: 'Low', color: 'var(--tb-p4)' },
];

export default function CalendarToolbar({
  title,
  view,
  onView,
  onPrev,
  onNext,
  onToday,
  onJump,
  jumpValue,
  slotDuration,
  onSlotDuration,
  filters,
  onToggleFilter,
  priorities,
  onTogglePriority,
  railOpen,
  onToggleRail,
}: {
  title: string;
  view: CalendarView;
  onView: (v: CalendarView) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onJump: (d: Date) => void;
  jumpValue: DateTime;
  slotDuration: SlotDuration;
  onSlotDuration: (d: SlotDuration) => void;
  filters: Set<keyof typeof STYLES>;
  onToggleFilter: (k: keyof typeof STYLES) => void;
  priorities: Set<1 | 2 | 3 | 4>;
  onTogglePriority: (p: 1 | 2 | 3 | 4) => void;
  railOpen: boolean;
  onToggleRail: () => void;
}) {
  const [jumpOpen, setJumpOpen] = useState(false);
  const isTimeGrid = view === 'timeGridDay' || view === 'timeGridWeek';

  return (
    <div className="mb-3 flex flex-col gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <button
            onClick={onToday}
            className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 dark:border-neutral-800 dark:text-neutral-400 dark:hover:bg-white/5"
            title="Jump to today (T)"
          >
            Today
          </button>
          <button
            onClick={onPrev}
            aria-label="Previous"
            className="rounded-md border border-slate-200 p-1.5 text-slate-500 transition hover:bg-slate-50 dark:border-neutral-800 dark:text-neutral-400 dark:hover:bg-white/5"
            title="Previous (â†)"
          >
            <ChevronLeft size={15} />
          </button>
          <button
            onClick={onNext}
            aria-label="Next"
            className="rounded-md border border-slate-200 p-1.5 text-slate-500 transition hover:bg-slate-50 dark:border-neutral-800 dark:text-neutral-400 dark:hover:bg-white/5"
            title="Next (â†’)"
          >
            <ChevronRight size={15} />
          </button>
          <div className="relative">
            <button
              onClick={() => setJumpOpen((v) => !v)}
              className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-bold text-slate-800 transition hover:bg-slate-50 dark:text-neutral-100 dark:hover:bg-white/5"
              title="Jump to date"
            >
              <CalendarDays size={14} className="text-slate-400 dark:text-neutral-500" />
              {title}
            </button>
            {jumpOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setJumpOpen(false)} />
                <div className="absolute left-0 top-full z-50 mt-1.5 rounded-xl border border-slate-200 bg-white p-3 shadow-2xl dark:border-neutral-800 dark:bg-neutral-900">
                  <MiniMonth
                    value={jumpValue}
                    onSelect={(d) => {
                      onJump(d.toJSDate());
                      setJumpOpen(false);
                    }}
                  />
                </div>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex rounded-lg bg-slate-100 p-0.5 dark:bg-neutral-800">
            {VIEWS.map((v) => (
              <button
                key={v.key}
                onClick={() => onView(v.key)}
                title={`${v.label} (${v.hotkey})`}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                  view === v.key ? 'bg-white text-teal-600 shadow-sm dark:bg-neutral-700 dark:text-teal-300' : 'text-slate-500 hover:text-slate-700 dark:text-neutral-400 dark:hover:text-neutral-200'
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>
          {isTimeGrid && (
            <select
              value={slotDuration}
              onChange={(e) => onSlotDuration(e.target.value as SlotDuration)}
              className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400 dark:hover:bg-white/5"
              title="Slot zoom"
            >
              <option value="00:15:00">15 min</option>
              <option value="00:30:00">30 min</option>
              <option value="01:00:00">60 min</option>
            </select>
          )}
          <button
            onClick={onToggleRail}
            aria-label={railOpen ? 'Collapse sidebar' : 'Expand sidebar'}
            title={railOpen ? 'Hide sidebar' : 'Show sidebar'}
            className="rounded-md border border-slate-200 p-1.5 text-slate-500 transition hover:bg-slate-50 dark:border-neutral-800 dark:text-neutral-400 dark:hover:bg-white/5"
          >
            {railOpen ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-slate-100 pt-2 dark:border-neutral-800">
        <div className="flex flex-wrap items-center gap-1.5">
          {KIND_LEGEND.map((l) => {
            const active = filters.has(l.key);
            return (
              <button
                key={l.key}
                onClick={() => onToggleFilter(l.key)}
                className="flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium transition"
                style={{
                  background: active ? STYLES[l.key].bg : 'transparent',
                  color: active ? STYLES[l.key].text : '#94a3b8',
                  opacity: active ? 1 : 0.55,
                }}
                title={active ? `Hide ${l.label}` : `Show ${l.label}`}
              >
                <span className="inline-block h-2 w-2 rounded-sm" style={{ background: STYLES[l.key].accent }} />
                {l.label}
              </button>
            );
          })}
        </div>
        <div className="h-3 w-px bg-slate-200 dark:bg-neutral-700" />
        <div className="flex items-center gap-1.5">
          {PRIORITY_CHIPS.map((p) => {
            const active = priorities.has(p.key);
            return (
              <button
                key={p.key}
                onClick={() => onTogglePriority(p.key)}
                className="rounded-full border px-2 py-0.5 text-[11px] font-bold transition"
                style={{
                  borderColor: active ? p.color : '#e2e8f0',
                  color: active ? p.color : '#94a3b8',
                  background: active ? `color-mix(in srgb, ${p.color} 12%, white)` : 'transparent',
                }}
                title={active ? `Hide ${p.label} tasks` : `Isolate ${p.label} tasks`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
