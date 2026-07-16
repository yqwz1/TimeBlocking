import type { CSSProperties } from 'react';
import { DateTime } from 'luxon';
import type { EventContentArg } from '@fullcalendar/core';
import type { ScheduleItemDTO } from '@timeblock/shared';
import { Lock, X } from 'lucide-react';
import { DifficultyBadge, PriorityBadge } from '../tasks/taskDisplay.js';

export type Style = { accent: string; bg: string; text: string };

export const STYLES: Record<string, Style> = {
  task: { accent: 'var(--tb-task)', bg: 'var(--tb-task-bg)', text: 'var(--tb-task-text)' },
  habit: { accent: 'var(--tb-habit)', bg: 'var(--tb-habit-bg)', text: 'var(--tb-habit-text)' },
  done: { accent: 'var(--tb-done)', bg: 'var(--tb-done-bg)', text: 'var(--tb-done-text)' },
  missed: { accent: 'var(--tb-missed)', bg: 'var(--tb-missed-bg)', text: 'var(--tb-missed-text)' },
  external: { accent: 'var(--tb-external)', bg: 'var(--tb-external-bg)', text: 'var(--tb-external-text)' },
  event: { accent: 'var(--tb-event)', bg: 'var(--tb-event-bg)', text: 'var(--tb-event-text)' },
};

export function styleKey(item: ScheduleItemDTO): keyof typeof STYLES {
  if (item.kind === 'external') return 'external';
  if (item.kind === 'event') return 'event';
  if (item.status === 'done') return 'done';
  if (item.status === 'missed') return 'missed';
  if (item.kind === 'habit') return 'habit';
  return 'task';
}

const PRIORITY_COLOR: Record<number, string> = {
  4: 'var(--tb-p1)',
  3: 'var(--tb-p2)',
  2: 'var(--tb-p3)',
  1: 'var(--tb-p4)',
};

export function priorityColor(priority?: number) {
  if (!priority) return undefined;
  return PRIORITY_COLOR[priority] ?? PRIORITY_COLOR[1];
}

export default function EventCard({ arg, atRiskTaskIds }: { arg: EventContentArg; atRiskTaskIds?: Set<string> }) {
  const item = arg.event.extendedProps.item as ScheduleItemDTO | undefined;
  const s = arg.event.extendedProps.style as Style | undefined;

  // FullCalendar renders a transient placeholder event for the drag preview when
  // an external task is dragged in from the sidebar; it has no `item`/`style`
  // extendedProps since TaskSidebar's Draggable only supplies title/duration.
  if (!item || !s) {
    return <div className="tb-ev">{arg.event.title}</div>;
  }

  const compact = arg.view.type === 'dayGridMonth' || arg.view.type === 'multiMonthYear';
  const atRisk = !!(item.taskId && atRiskTaskIds?.has(item.taskId));

  // Duration in minutes — drives the compact single-line layout for short blocks.
  const start = arg.event.start;
  const end = arg.event.end;
  const durationMin = start && end ? (end.getTime() - start.getTime()) / 60_000 : 60;
  const short = durationMin > 0 && durationMin < 45;
  const roomy = !compact && durationMin >= 60;

  const missed = item.status === 'missed';
  const isPast = !!end && end.getTime() < Date.now();

  const cls = ['tb-ev'];
  if (item.status === 'done') cls.push('tb-ev-done');
  if (missed) cls.push('tb-ev-missed');
  if (isPast) cls.push('tb-ev-past');
  if (item.kind === 'external') cls.push('tb-ev-external');
  if (atRisk) cls.push('tb-ev-atrisk');
  if (short && !compact) cls.push('tb-ev-short');
  // Left accent bar: the task's own color if it has one, else a fixed color per kind
  // (task/habit/done/missed/external) — same idea as the list view's colored left border.
  const accent = item.color ?? s.accent;
  const vars = { '--tb-accent': accent } as CSSProperties;
  const dotColor = priorityColor(item.priority);

  const missedTag = missed ? (
    <span className="tb-missed-tag">
      <X size={9} className="shrink-0" /> Missed
    </span>
  ) : null;

  if (compact) {
    return (
      <div className={cls.join(' ')} style={vars}>
        <div className="tb-ev-title">
          {dotColor && <span className="tb-priority-dot" style={{ '--dot': dotColor } as CSSProperties} />}
          {item.locked && <Lock size={9} className="shrink-0" />}
          {missedTag}
          <span className="tb-ev-title-text">{item.title}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={cls.join(' ')} style={vars} title={`${item.title}${arg.timeText ? ` · ${arg.timeText}` : ''}`}>
      <div className={`tb-ev-title${short ? '' : ' tb-ev-title-wrap'}`}>
        {dotColor && <span className="tb-priority-dot" style={{ '--dot': dotColor } as CSSProperties} />}
        {item.locked && <Lock size={10} className="shrink-0" />}
        {missedTag}
        <span className="tb-ev-title-text">{item.title}</span>
        {item.chunk && (
          <span className="tb-chunk-badge">
            {item.chunk.index + 1}/{item.chunk.count}
          </span>
        )}
        {short && start && (
          <span className="tb-ev-time-inline">{DateTime.fromJSDate(start).toFormat('h:mm')}</span>
        )}
      </div>
      {!short && arg.event.end && (
        <div className="tb-ev-meta">
          <span className="tb-ev-time">{arg.timeText}</span>
          {roomy && (item.kind === 'task' || item.kind === 'event') && item.priority ? <PriorityBadge priority={item.priority} /> : null}
          {roomy && item.difficulty ? <DifficultyBadge difficulty={item.difficulty} /> : null}
          {item.projectName ? <span className="tb-ev-project">{item.projectName}</span> : null}
          {item.kind === 'event' && item.location ? <span className="tb-ev-project">{item.location}</span> : null}
        </div>
      )}
    </div>
  );
}
