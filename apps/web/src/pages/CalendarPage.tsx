import { useCallback, useRef, useState } from 'react';
import type FullCalendar from '@fullcalendar/react';
import { DateTime } from 'luxon';
import ScheduleCalendar from '../components/calendar/ScheduleCalendar.js';
import CalendarToolbar, { type CalendarView, type SlotDuration } from '../components/calendar/CalendarToolbar.js';
import { STYLES } from '../components/calendar/EventCard.js';
import CalendarRail from '../components/rail/CalendarRail.js';
import { useCalendarShortcuts } from '../hooks/useCalendarShortcuts.js';

const ALL_KINDS = Object.keys(STYLES) as (keyof typeof STYLES)[];

function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export default function CalendarPage({ onOpenTask }: { onOpenTask?: (id: string | null) => void }) {
  const calendarRef = useRef<FullCalendar>(null);
  const railRef = useRef<HTMLDivElement>(null);

  const [view, setView] = useState<CalendarView>(() => loadJSON('tb-calendar-view', 'timeGridWeek' as CalendarView));
  const [title, setTitle] = useState('');
  const [focusDate, setFocusDate] = useState<DateTime>(DateTime.now());
  const [slotDuration, setSlotDuration] = useState<SlotDuration>(() => loadJSON('tb-calendar-slot', '00:30:00' as SlotDuration));
  const [railOpen, setRailOpen] = useState(() => loadJSON('tb-calendar-rail', false));
  const [filters, setFilters] = useState<Set<keyof typeof STYLES>>(new Set(ALL_KINDS));
  const [priorities, setPriorities] = useState<Set<1 | 2 | 3 | 4>>(new Set());
  const [railDragActive, setRailDragActive] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);

  const persist = (key: string, value: unknown) => localStorage.setItem(key, JSON.stringify(value));

  const changeView = useCallback((v: CalendarView) => {
    calendarRef.current?.getApi().changeView(v);
    setView(v);
    persist('tb-calendar-view', v);
  }, []);

  const goPrev = useCallback(() => calendarRef.current?.getApi().prev(), []);
  const goNext = useCallback(() => calendarRef.current?.getApi().next(), []);
  const goToday = useCallback(() => calendarRef.current?.getApi().today(), []);
  const goJump = useCallback((d: Date) => calendarRef.current?.getApi().gotoDate(d), []);

  useCalendarShortcuts({ onPrev: goPrev, onNext: goNext, onToday: goToday, onView: changeView, suspended: popoverOpen });

  const toggleFilter = (k: keyof typeof STYLES) =>
    setFilters((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const togglePriority = (p: 1 | 2 | 3 | 4) =>
    setPriorities((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });

  const toggleRail = () =>
    setRailOpen((v) => {
      persist('tb-calendar-rail', !v);
      return !v;
    });

  const handleSlotDuration = (d: SlotDuration) => {
    setSlotDuration(d);
    persist('tb-calendar-slot', d);
  };

  return (
    <div className="flex h-full flex-col">
      <CalendarToolbar
        title={title}
        view={view}
        onView={changeView}
        onPrev={goPrev}
        onNext={goNext}
        onToday={goToday}
        onJump={goJump}
        jumpValue={focusDate}
        slotDuration={slotDuration}
        onSlotDuration={handleSlotDuration}
        filters={filters}
        onToggleFilter={toggleFilter}
        priorities={priorities}
        onTogglePriority={togglePriority}
        railOpen={railOpen}
        onToggleRail={toggleRail}
      />
      <div className="flex min-h-0 flex-1 gap-4">
        <ScheduleCalendar
          ref={calendarRef}
          filters={filters}
          priorities={priorities}
          slotDuration={slotDuration}
          railRef={railRef}
          onRailDragActive={setRailDragActive}
          onDatesSet={({ title: t, start }) => {
            setTitle(t);
            setFocusDate(DateTime.fromJSDate(start));
          }}
          onPopoverChange={setPopoverOpen}
          onOpenTask={onOpenTask}
        />
        {railOpen && <CalendarRail ref={railRef} dropActive={railDragActive} onJump={goJump} />}
      </div>
    </div>
  );
}
