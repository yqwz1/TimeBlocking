import { forwardRef, useImperativeHandle, useMemo, useRef, useState, type RefObject } from 'react';
import { AnimatePresence } from 'motion/react';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import dayGridPlugin from '@fullcalendar/daygrid';
import multiMonthPlugin from '@fullcalendar/multimonth';
import interactionPlugin from '@fullcalendar/interaction';
import luxonPlugin from '@fullcalendar/luxon3';
import type { EventDropArg, DateSelectArg } from '@fullcalendar/core';
import type { DropArg } from '@fullcalendar/interaction';
import type { ScheduleItemDTO } from '@timeblock/shared';
import {
  useMoveBlock,
  useSchedule,
  useScheduleTaskAt,
  useTodayPlan,
  useUnscheduleTask,
  useUpdateEvent,
} from '../../hooks.js';
import EventCard, { STYLES, styleKey } from './EventCard.js';
import DetailPopover from './DetailPopover.js';
import QuickSchedulePopover from './QuickSchedulePopover.js';
import CreateTaskPopover from './CreateTaskPopover.js';
import type { CalendarView, SlotDuration } from './CalendarToolbar.js';

export type { CalendarView, SlotDuration };

// Scroll to ~2h before the current hour on load so "now" (and the hours around it,
// including evening tasks) are visible without having to manually scroll down every time.
function defaultScrollTime(): string {
  const hour = Math.max(6, Math.min(21, new Date().getHours() - 2));
  return `${String(hour).padStart(2, '0')}:00:00`;
}

export default forwardRef<FullCalendar, {
  filters: Set<keyof typeof STYLES>;
  priorities: Set<1 | 2 | 3 | 4>;
  slotDuration: SlotDuration;
  onDatesSet: (info: { title: string; view: CalendarView; start: Date; end: Date }) => void;
  railRef: RefObject<HTMLDivElement>;
  onRailDragActive: (active: boolean) => void;
  onPopoverChange?: (open: boolean) => void;
  onOpenTask?: (id: string | null) => void;
  initialView?: CalendarView;
  initialDate?: Date;
  height?: string;
}>(function ScheduleCalendar({ filters, priorities, slotDuration, onDatesSet, railRef, onRailDragActive, onPopoverChange, onOpenTask, initialView = 'timeGridWeek', initialDate, height = 'calc(100vh - 16.5rem)' }, ref) {
  const calRef = useRef<FullCalendar>(null);
  useImperativeHandle(ref, () => calRef.current as FullCalendar);
  const [range, setRange] = useState<{ from: string; to: string; view: CalendarView }>(() => {
    const now = initialDate ?? new Date();
    if (initialView === 'timeGridDay') {
      const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      return { from: from.toISOString(), to: to.toISOString(), view: 'timeGridDay' };
    }
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
    const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 14);
    return { from: from.toISOString(), to: to.toISOString(), view: 'timeGridWeek' };
  });
  const { data: items, isLoading } = useSchedule(range.from, range.to, { external: range.view !== 'multiMonthYear' });
  const { data: todayPlan } = useTodayPlan();
  const atRiskTaskIds = useMemo(() => new Set(todayPlan?.atRiskTaskIds ?? []), [todayPlan]);
  const moveBlock = useMoveBlock();
  const scheduleAt = useScheduleTaskAt();
  const unschedule = useUnscheduleTask();
  const updateEvent = useUpdateEvent();
  const [selected, setSelected] = useState<{ item: ScheduleItemDTO; anchor: { x: number; y: number } } | null>(null);
  const [quickSchedule, setQuickSchedule] = useState<{ date: Date; anchor: { x: number; y: number } } | null>(null);
  const [createRange, setCreateRange] = useState<{ start: Date; end: Date; anchor: { x: number; y: number } } | null>(null);
  const [pulsingId, setPulsingId] = useState<string | null>(null);

  const pulse = (id: string) => {
    setPulsingId(id);
    setTimeout(() => setPulsingId((cur) => (cur === id ? null : cur)), 650);
  };

  const events = useMemo(
    () =>
      (items ?? [])
        .filter((item) => filters.has(styleKey(item)))
        .filter((item) => priorities.size === 0 || item.kind !== 'task' || (!!item.priority && priorities.has(item.priority as 1 | 2 | 3 | 4)))
        .map((item) => {
          const s = STYLES[styleKey(item)];
          const cls = ['tb-event', `tb-ev-${styleKey(item)}`];
          if (item.locked) cls.push('tb-locked');
          if (item.kind === 'external') cls.push('tb-external');
          if (pulsingId && (item.id === pulsingId || item.taskId === pulsingId)) cls.push('tb-pulse');
          return {
            id: item.id,
            title: item.title,
            start: item.start,
            end: item.end,
            editable: item.editable,
            classNames: cls,
            extendedProps: { item, style: s },
          };
        }),
    [items, filters, priorities, pulsingId],
  );

  const onDrop = (
    arg: EventDropArg | { event: { id: string; start: Date | null; end: Date | null }; revert: () => void },
  ) => {
    const { event, revert } = arg;
    if (!event.start || !event.end) return revert();

    // Native events carry an `event:<id>` id and are updated through the events API,
    // not the block scheduler.
    if (event.id.startsWith('event:')) {
      const eventId = event.id.slice('event:'.length);
      updateEvent.mutate(
        { id: eventId, patch: { startUtc: event.start.toISOString(), endUtc: event.end.toISOString() } },
        { onError: () => revert(), onSuccess: () => pulse(event.id) },
      );
      return;
    }

    const oldEvent = 'oldEvent' in arg ? arg.oldEvent : null;
    moveBlock.mutate(
      {
        id: event.id,
        startUtc: event.start.toISOString(),
        endUtc: event.end.toISOString(),
        prevStartUtc: oldEvent?.start?.toISOString(),
        prevEndUtc: oldEvent?.end?.toISOString(),
      },
      { onError: () => revert(), onSuccess: () => pulse(event.id) },
    );
  };

  // External task dropped from the sidebar onto a time slot.
  const onExternalDrop = (info: DropArg) => {
    const taskId = info.draggedEl.getAttribute('data-task-id');
    const durationMin = Number(info.draggedEl.getAttribute('data-duration')) || 30;
    if (!taskId) return;
    const start = info.date;
    const end = new Date(start.getTime() + durationMin * 60_000);
    scheduleAt.mutate(
      { id: taskId, startUtc: start.toISOString(), endUtc: end.toISOString() },
      { onSuccess: () => pulse(taskId) },
    );
  };

  return (
    <div className="relative flex min-w-0 flex-1 flex-col rounded-xl border border-slate-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
      {isLoading && <div className="tb-skeleton" />}
      <FullCalendar
        ref={calRef}
        plugins={[timeGridPlugin, dayGridPlugin, multiMonthPlugin, interactionPlugin, luxonPlugin]}
        initialView={initialView}
        initialDate={initialDate}
        headerToolbar={false}
        height={height}
        nowIndicator
        allDaySlot={false}
        slotMinTime="06:00:00"
        slotMaxTime="23:00:00"
        scrollTime={defaultScrollTime()}
        slotDuration={slotDuration}
        snapDuration="00:01:00"
        slotLabelInterval="01:00:00"
        slotLabelFormat={{ hour: 'numeric', minute: '2-digit', omitZeroMinute: true, meridiem: 'short' }}
        expandRows
        firstDay={1}
        dayHeaderFormat={{ weekday: 'short', day: 'numeric' }}
        views={{
          multiMonthYear: { multiMonthMaxColumns: 3, displayEventTime: false, dayMaxEvents: 3 },
          dayGridMonth: { dayMaxEvents: 4 },
        }}
        navLinks
        navLinkDayClick={(date) => {
          calRef.current?.getApi().changeView('timeGridDay', date);
        }}
        events={events}
        eventContent={(arg) => <EventCard arg={arg} atRiskTaskIds={atRiskTaskIds} />}
        editable
        droppable
        selectable
        selectMirror
        selectMinDistance={5}
        eventStartEditable
        eventDurationEditable
        eventResizableFromStart
        dragRevertDuration={0}
        eventDrop={onDrop}
        eventResize={onDrop}
        drop={onExternalDrop}
        eventDragStart={() => onRailDragActive(true)}
        eventDragStop={(info) => {
          onRailDragActive(false);
          const rail = railRef.current;
          if (!rail) return;
          const rect = rail.getBoundingClientRect();
          const { clientX: x, clientY: y } = info.jsEvent;
          const overRail = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
          if (!overRail) return;
          const item = info.event.extendedProps.item as ScheduleItemDTO;
          if (item.kind === 'task' && item.taskId && !item.locked && item.status !== 'done') {
            unschedule.mutate(item.taskId);
          }
        }}
        eventClick={(info) => {
          const item = info.event.extendedProps.item as ScheduleItemDTO;
          setSelected({ item, anchor: { x: info.jsEvent.clientX, y: info.jsEvent.clientY } });
          onPopoverChange?.(true);
        }}
        dateClick={(info) => {
          if (info.view.type !== 'timeGridDay' && info.view.type !== 'timeGridWeek') return;
          setQuickSchedule({ date: info.date, anchor: { x: info.jsEvent.clientX, y: info.jsEvent.clientY } });
          onPopoverChange?.(true);
        }}
        select={(info: DateSelectArg) => {
          if (info.view.type !== 'timeGridDay' && info.view.type !== 'timeGridWeek') return;
          const anchor = info.jsEvent
            ? { x: info.jsEvent.clientX, y: info.jsEvent.clientY }
            : { x: window.innerWidth / 2, y: 160 };
          setCreateRange({ start: info.start, end: info.end, anchor });
          onPopoverChange?.(true);
        }}
        datesSet={(arg) => {
          const view = arg.view.type as CalendarView;
          setRange({ from: arg.start.toISOString(), to: arg.end.toISOString(), view });
          onDatesSet({ title: arg.view.title, view, start: arg.start, end: arg.end });
        }}
      />
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 px-1 pt-2 text-xs text-slate-500 dark:text-neutral-400">
        <span>{(items ?? []).length} items in view</span>
      </div>
      <AnimatePresence>
        {selected && (
          <DetailPopover
            key="detail-popover"
            item={selected.item}
            anchor={selected.anchor}
            onClose={() => {
              setSelected(null);
              onPopoverChange?.(false);
            }}
            onEdit={
              onOpenTask
                ? (taskId) => {
                    onOpenTask(taskId);
                    setSelected(null);
                    onPopoverChange?.(false);
                  }
                : undefined
            }
          />
        )}
        {quickSchedule && (
          <QuickSchedulePopover
            key="quick-schedule-popover"
            date={quickSchedule.date}
            anchor={quickSchedule.anchor}
            onClose={() => {
              setQuickSchedule(null);
              onPopoverChange?.(false);
            }}
            onScheduled={pulse}
          />
        )}
        {createRange && (
          <CreateTaskPopover
            key="create-task-popover"
            start={createRange.start}
            end={createRange.end}
            anchor={createRange.anchor}
            onClose={() => {
              setCreateRange(null);
              calRef.current?.getApi().unselect();
              onPopoverChange?.(false);
            }}
            onCreated={pulse}
          />
        )}
      </AnimatePresence>
    </div>
  );
});
