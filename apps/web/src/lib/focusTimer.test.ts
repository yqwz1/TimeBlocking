// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { checkFocusTimer, FOCUS_TIMER_FINISHED_EVENT } from './focusTimer.js';

describe('global focus timer monitor', () => {
  it('advances a due timer once and emits a focus alert even without FocusView', () => {
    localStorage.clear();
    localStorage.setItem('tb.focus.settings', JSON.stringify({ workMin: 25, shortMin: 5, longMin: 15, longEvery: 4, autoStart: false }));
    localStorage.setItem('tb.focus.state', JSON.stringify({ phase: 'work', running: true, endsAt: Date.now() - 1, remainingMs: 0, completedWork: 0, selectedTaskId: null }));
    const events: string[] = [];
    window.addEventListener(FOCUS_TIMER_FINISHED_EVENT, (event) => events.push((event as CustomEvent<{ title: string }>).detail.title));
    expect(checkFocusTimer()?.phase).toBe('short_break');
    expect(checkFocusTimer()).toBeNull();
    expect(events).toEqual(['Focus session complete']);
  });
});
