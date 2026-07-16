import { useEffect } from 'react';
import type { CalendarView } from '../components/calendar/CalendarToolbar.js';

function isTypingTarget(el: EventTarget | null) {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/** Global calendar keyboard shortcuts: navigate, jump to today, switch views. Disabled while typing or a popover is open. */
export function useCalendarShortcuts({
  onPrev,
  onNext,
  onToday,
  onView,
  suspended,
}: {
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onView: (v: CalendarView) => void;
  suspended?: boolean;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (suspended || isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      switch (e.key.toLowerCase()) {
        case 'arrowleft':
          onPrev();
          break;
        case 'arrowright':
          onNext();
          break;
        case 't':
          onToday();
          break;
        case 'd':
          onView('timeGridDay');
          break;
        case 'w':
          onView('timeGridWeek');
          break;
        case 'm':
          onView('dayGridMonth');
          break;
        case 'y':
          onView('multiMonthYear');
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onPrev, onNext, onToday, onView, suspended]);
}
