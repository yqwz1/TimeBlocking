export type FocusTimerPhase = 'work' | 'short_break' | 'long_break';

interface FocusSettings { workMin: number; shortMin: number; longMin: number; longEvery: number; autoStart: boolean; }
interface FocusState { phase: FocusTimerPhase; running: boolean; endsAt: number | null; remainingMs: number; completedWork: number; selectedTaskId: string | null; }

export const FOCUS_TIMER_STATE_EVENT = 'tb:focus-timer-state';
export const FOCUS_TIMER_FINISHED_EVENT = 'tb:focus-timer-finished';
const SETTINGS_KEY = 'tb.focus.settings';
const STATE_KEY = 'tb.focus.state';
const defaults: FocusSettings = { workMin: 25, shortMin: 5, longMin: 15, longEvery: 4, autoStart: false };

function readJson<T>(key: string, fallback: T): T {
  try { return { ...fallback, ...JSON.parse(localStorage.getItem(key) ?? '{}') }; } catch { return fallback; }
}

function phaseMs(phase: FocusTimerPhase, settings: FocusSettings) {
  return Math.max(1, phase === 'work' ? settings.workMin : phase === 'short_break' ? settings.shortMin : settings.longMin) * 60_000;
}

function readState(settings: FocusSettings): FocusState {
  const fallback: FocusState = { phase: 'work', running: false, endsAt: null, remainingMs: phaseMs('work', settings), completedWork: 0, selectedTaskId: null };
  return readJson(STATE_KEY, fallback);
}

/** Runs outside FocusView so hidden or navigated-away timers still complete. */
export function checkFocusTimer(): FocusState | null {
  if (typeof window === 'undefined') return null;
  const settings = readJson(SETTINGS_KEY, defaults);
  const current = readState(settings);
  if (!current.running || current.endsAt == null || current.endsAt > Date.now()) return null;
  const completedWork = current.completedWork + (current.phase === 'work' ? 1 : 0);
  const nextPhase: FocusTimerPhase = current.phase === 'work'
    ? (completedWork % settings.longEvery === 0 ? 'long_break' : 'short_break')
    : 'work';
  const duration = phaseMs(nextPhase, settings);
  const next: FocusState = { ...current, phase: nextPhase, completedWork, running: settings.autoStart, endsAt: settings.autoStart ? Date.now() + duration : null, remainingMs: duration };
  localStorage.setItem(STATE_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(FOCUS_TIMER_STATE_EVENT, { detail: next }));
  const title = current.phase === 'work' ? 'Focus session complete' : 'Break complete';
  const body = current.phase === 'work' ? 'Time for a break. Acknowledge when you see this.' : 'Time to return to focus.';
  window.dispatchEvent(new CustomEvent(FOCUS_TIMER_FINISHED_EVENT, { detail: { id: `focus:${current.phase}:${current.endsAt}`, title, body } }));
  return next;
}
