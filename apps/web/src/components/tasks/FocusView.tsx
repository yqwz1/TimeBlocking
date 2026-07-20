import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AudioLines,
  Check,
  CloudDrizzle,
  CloudLightning,
  CloudRain,
  Coffee,
  Flame,
  Moon,
  Music,
  Pause,
  Piano,
  Play,
  RotateCcw,
  Search,
  Settings2,
  SkipForward,
  Target,
  TreePine,
  Volume2,
  Waves,
  Wind,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { TaskDTO } from '@timeblock/shared';
import { useTaskList, useUpdateTask } from '../../hooks.js';
import { PriorityBadge, formatDuration } from './taskDisplay.js';
import { popoverVariants, springs } from '../../lib/motion.js';
import { playTimerDone } from '../../lib/sound.js';
import {
  AMBIENCE_META,
  getAmbienceVolume,
  setAmbienceVolume,
  startAmbience,
  stopAmbience,
  type AmbienceType,
} from '../../lib/ambience.js';

type Phase = 'work' | 'short_break' | 'long_break';

interface FocusSettings {
  workMin: number;
  shortMin: number;
  longMin: number;
  longEvery: number; // long break after this many work sessions
  autoStart: boolean;
}

interface PersistedState {
  phase: Phase;
  running: boolean;
  endsAt: number | null; // absolute epoch ms when the current phase ends (only meaningful while running)
  remainingMs: number; // authoritative when paused
  completedWork: number; // work sessions finished (for the long-break cadence)
  selectedTaskId: string | null;
}

const DEFAULT_SETTINGS: FocusSettings = { workMin: 25, shortMin: 5, longMin: 15, longEvery: 4, autoStart: false };
const SETTINGS_KEY = 'tb.focus.settings';
const STATE_KEY = 'tb.focus.state';
const AMBIENCE_KEY = 'tb.focus.ambience';

const AMBIENCE_ICONS: Record<AmbienceType, LucideIcon> = {
  rain: CloudRain,
  thunder: CloudLightning,
  fireplace: Flame,
  ocean: Waves,
  wind: Wind,
  forest: TreePine,
  lofi: Music,
  lofi_jazz: Piano,
  lofi_sleep: Moon,
  lofi_rain: CloudDrizzle,
  white: AudioLines,
  brown: AudioLines,
};
const AMBIENCE_ORDER: AmbienceType[] = [
  'rain',
  'thunder',
  'fireplace',
  'ocean',
  'wind',
  'forest',
  'lofi',
  'lofi_jazz',
  'lofi_sleep',
  'lofi_rain',
  'white',
  'brown',
];

const PHASE_META: Record<Phase, { label: string; ring: string; soft: string }> = {
  work: { label: 'Focus', ring: '#0d9488', soft: 'text-teal-600 dark:text-teal-300' },
  short_break: { label: 'Short break', ring: '#0ea5e9', soft: 'text-sky-600 dark:text-sky-300' },
  long_break: { label: 'Long break', ring: '#6366f1', soft: 'text-indigo-600 dark:text-indigo-300' },
};

function loadSettings(): FocusSettings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function phaseMs(phase: Phase, s: FocusSettings): number {
  const min = phase === 'work' ? s.workMin : phase === 'short_break' ? s.shortMin : s.longMin;
  return Math.max(1, min) * 60_000;
}

function loadState(settings: FocusSettings): PersistedState {
  try {
    const raw = JSON.parse(localStorage.getItem(STATE_KEY) ?? 'null') as PersistedState | null;
    if (raw && typeof raw.remainingMs === 'number') return raw;
  } catch {
    /* fall through */
  }
  return { phase: 'work', running: false, endsAt: null, remainingMs: phaseMs('work', settings), completedWork: 0, selectedTaskId: null };
}

function fmt(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function FocusView({ onOpenTask }: { onOpenTask: (id: string) => void }) {
  const [settings, setSettings] = useState<FocusSettings>(loadSettings);
  const [state, setState] = useState<PersistedState>(() => loadState(settings));
  const [showSettings, setShowSettings] = useState(false);
  const [picking, setPicking] = useState(false);
  const [pickQuery, setPickQuery] = useState('');
  const [tick, setTick] = useState(0); // forces re-render each second while running
  const pickerRef = useRef<HTMLDivElement>(null);
  const [ambience, setAmbience] = useState<AmbienceType | null>(null);
  const [ambVolume, setAmbVolume] = useState<number>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(AMBIENCE_KEY) ?? '{}') as { volume?: number };
      return typeof saved.volume === 'number' ? saved.volume : getAmbienceVolume();
    } catch {
      return getAmbienceVolume();
    }
  });

  const { data: allTasks } = useTaskList({});
  const update = useUpdateTask();

  const openTasks = useMemo(
    () => (allTasks ?? []).filter((t) => t.status !== 'done' && t.status !== 'cancelled'),
    [allTasks],
  );
  const selectedTask: TaskDTO | undefined = useMemo(
    () => (allTasks ?? []).find((t) => t.id === state.selectedTaskId),
    [allTasks, state.selectedTaskId],
  );

  // Persist state & settings.
  useEffect(() => localStorage.setItem(STATE_KEY, JSON.stringify(state)), [state]);
  useEffect(() => localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)), [settings]);
  useEffect(() => localStorage.setItem(AMBIENCE_KEY, JSON.stringify({ volume: ambVolume })), [ambVolume]);

  // Apply volume and silence the soundscape when leaving the Focus tab.
  useEffect(() => setAmbienceVolume(ambVolume), [ambVolume]);
  useEffect(() => () => stopAmbience(), []);

  const toggleAmbience = (type: AmbienceType) => {
    if (ambience === type) {
      stopAmbience();
      setAmbience(null);
    } else if (startAmbience(type)) {
      setAmbience(type);
    }
  };

  // Live tick while running.
  useEffect(() => {
    if (!state.running) return;
    const id = setInterval(() => setTick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [state.running]);

  // Close the task picker on outside click / Escape, matching FilterDropdown's behavior.
  useEffect(() => {
    if (!picking) return;
    const onDown = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPicking(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPicking(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [picking]);

  const remaining = state.running && state.endsAt != null ? state.endsAt - Date.now() : state.remainingMs;
  const totalMs = phaseMs(state.phase, settings);
  const progress = Math.min(1, Math.max(0, 1 - remaining / totalMs));

  const advance = useCallback(() => {
    setState((prev) => {
      const finishedWork = prev.phase === 'work';
      const completedWork = prev.completedWork + (finishedWork ? 1 : 0);
      let next: Phase;
      if (finishedWork) {
        next = completedWork % settings.longEvery === 0 ? 'long_break' : 'short_break';
      } else {
        next = 'work';
      }
      const dur = phaseMs(next, settings);
      const running = settings.autoStart;
      return {
        ...prev,
        phase: next,
        completedWork,
        running,
        endsAt: running ? Date.now() + dur : null,
        remainingMs: dur,
      };
    });
  }, [settings]);

  // Detect phase completion. `tick` drives the check while running.
  useEffect(() => {
    if (state.running && state.endsAt != null && Date.now() >= state.endsAt) {
      playTimerDone();
      if ('Notification' in window && Notification.permission === 'granted') {
        const done = state.phase === 'work' ? 'Focus session done — time for a break.' : 'Break over — back to it.';
        new Notification('TimeBlock Focus', { body: done });
      }
      advance();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, state.running, state.endsAt]);

  const start = () => {
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
    setState((p) => ({ ...p, running: true, endsAt: Date.now() + p.remainingMs }));
  };
  const pause = () =>
    setState((p) => ({ ...p, running: false, remainingMs: p.endsAt != null ? Math.max(0, p.endsAt - Date.now()) : p.remainingMs, endsAt: null }));
  const reset = () =>
    setState((p) => ({ ...p, running: false, endsAt: null, remainingMs: phaseMs(p.phase, settings) }));
  const skip = () => advance();

  const setPhase = (phase: Phase) =>
    setState((p) => ({ ...p, phase, running: false, endsAt: null, remainingMs: phaseMs(phase, settings) }));

  const selectTask = (id: string | null) => {
    setState((p) => ({ ...p, selectedTaskId: id }));
    setPicking(false);
    setPickQuery('');
  };

  const completeSelected = () => {
    if (!selectedTask) return;
    update.mutate({ id: selectedTask.id, patch: { status: 'done' } });
    selectTask(null);
  };

  const meta = PHASE_META[state.phase];
  const R = 130;
  const C = 2 * Math.PI * R;

  const filteredPick = openTasks.filter((t) => t.content.toLowerCase().includes(pickQuery.toLowerCase())).slice(0, 40);

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-6 py-4">
      {/* Focused task */}
      <div ref={pickerRef} className="relative w-full">
        {selectedTask ? (
          <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-neutral-500">Focusing on</span>
              <button type="button" onClick={() => selectTask(null)} className="rounded p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-neutral-300" aria-label="Clear focused task">
                <X size={14} />
              </button>
            </div>
            <button type="button" onClick={() => onOpenTask(selectedTask.id)} className="block w-full text-left">
              <span className="text-sm font-medium text-slate-800 dark:text-neutral-100">{selectedTask.content}</span>
            </button>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <PriorityBadge priority={selectedTask.priority} />
              {selectedTask.projectName && (
                <span className="flex items-center gap-1 text-xs text-slate-500 dark:text-neutral-400">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: selectedTask.projectColor ?? '#94a3b8' }} />
                  {selectedTask.projectName}
                </span>
              )}
              {selectedTask.durationMin != null && (
                <span className="text-xs text-slate-400 dark:text-neutral-500">{formatDuration(selectedTask.durationMin)}</span>
              )}
              <button
                type="button"
                onClick={completeSelected}
                className="ml-auto flex items-center gap-1 rounded-md bg-teal-50 px-2 py-1 text-xs font-medium text-teal-700 hover:bg-teal-100 dark:bg-teal-500/15 dark:text-teal-300 dark:hover:bg-teal-500/25"
              >
                <Check size={13} /> Mark done
              </button>
              <button
                type="button"
                onClick={() => setPicking((v) => !v)}
                className="rounded-md px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 dark:text-neutral-400 dark:hover:bg-white/5"
              >
                Change
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setPicking((v) => !v)}
            className={`flex w-full items-center justify-center gap-2 rounded-xl border border-dashed py-3 text-sm font-medium transition-colors ${
              picking
                ? 'border-teal-400 text-teal-600 dark:border-teal-500/50 dark:text-teal-300'
                : 'border-slate-300 text-slate-500 hover:border-teal-400 hover:text-teal-600 dark:border-neutral-700 dark:text-neutral-400 dark:hover:border-teal-500/50 dark:hover:text-teal-300'
            }`}
          >
            <Target size={15} /> Choose a task to focus on
          </button>
        )}

        {/* Task picker — anchored dropdown, matching FilterDropdown's pattern */}
        <AnimatePresence>
          {picking && (
            <motion.div
              variants={popoverVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              style={{ transformOrigin: 'top center' }}
              className="absolute left-0 right-0 top-full z-30 mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-900"
            >
              <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2 dark:border-neutral-800">
                <Search size={15} className="shrink-0 text-slate-400" />
                <input
                  autoFocus
                  value={pickQuery}
                  onChange={(e) => setPickQuery(e.target.value)}
                  placeholder="Search tasks to focus on…"
                  className="w-full bg-transparent py-1 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none dark:text-neutral-100 dark:placeholder:text-neutral-500"
                />
                <button type="button" onClick={() => setPicking(false)} className="shrink-0 rounded p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-neutral-300">
                  <X size={16} />
                </button>
              </div>
              <ul className="max-h-72 overflow-y-auto py-1">
                {filteredPick.length === 0 ? (
                  <li className="px-3 py-6 text-center text-sm text-slate-400 dark:text-neutral-500">No open tasks found</li>
                ) : (
                  filteredPick.map((t) => (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => selectTask(t.id)}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-white/5"
                      >
                        <PriorityBadge priority={t.priority} />
                        <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-neutral-200">{t.content}</span>
                        {t.projectName && (
                          <span className="flex shrink-0 items-center gap-1 text-xs text-slate-400 dark:text-neutral-500">
                            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: t.projectColor ?? '#94a3b8' }} />
                            {t.projectName}
                          </span>
                        )}
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Phase switcher */}
      <div className="flex gap-1 rounded-full bg-slate-100 p-1 text-xs font-medium dark:bg-neutral-800">
        {(['work', 'short_break', 'long_break'] as Phase[]).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPhase(p)}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 transition-colors ${
              state.phase === p ? 'bg-white text-slate-800 shadow-sm dark:bg-neutral-700 dark:text-neutral-100' : 'text-slate-500 hover:text-slate-700 dark:text-neutral-400 dark:hover:text-neutral-200'
            }`}
          >
            {p === 'work' ? <Target size={13} /> : <Coffee size={13} />}
            {PHASE_META[p].label}
          </button>
        ))}
      </div>

      {/* Timer ring */}
      <div className="relative flex h-[300px] w-[300px] items-center justify-center">
        <svg viewBox="0 0 300 300" className="h-full w-full -rotate-90">
          <circle cx="150" cy="150" r={R} fill="none" strokeWidth="12" className="stroke-slate-100 dark:stroke-neutral-800" />
          <motion.circle
            cx="150"
            cy="150"
            r={R}
            fill="none"
            strokeWidth="12"
            strokeLinecap="round"
            stroke={meta.ring}
            strokeDasharray={C}
            animate={{ strokeDashoffset: C * progress }}
            transition={{ ease: 'linear', duration: 0.3 }}
          />
        </svg>
        <div className="absolute flex flex-col items-center">
          <span className={`text-xs font-semibold uppercase tracking-wide ${meta.soft}`}>{meta.label}</span>
          <span className="mt-1 font-mono text-6xl font-bold tabular-nums text-slate-800 dark:text-neutral-100">{fmt(remaining)}</span>
          <span className="mt-1 text-xs text-slate-400 dark:text-neutral-500">
            {state.completedWork} session{state.completedWork === 1 ? '' : 's'} today
          </span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={reset}
          title="Reset phase"
          className="rounded-full p-2.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-white/5 dark:hover:text-neutral-300"
        >
          <RotateCcw size={18} />
        </button>
        <motion.button
          type="button"
          whileTap={{ scale: 0.94 }}
          onClick={state.running ? pause : start}
          className="flex h-16 w-16 items-center justify-center rounded-full bg-teal-600 text-white shadow-lg shadow-teal-600/25 hover:bg-teal-700"
        >
          {state.running ? <Pause size={26} fill="currentColor" /> : <Play size={26} fill="currentColor" className="ml-0.5" />}
        </motion.button>
        <button
          type="button"
          onClick={skip}
          title="Skip to next phase"
          className="rounded-full p-2.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-white/5 dark:hover:text-neutral-300"
        >
          <SkipForward size={18} />
        </button>
        <button
          type="button"
          onClick={() => setShowSettings((v) => !v)}
          title="Timer settings"
          className={`rounded-full p-2.5 hover:bg-slate-100 dark:hover:bg-white/5 ${showSettings ? 'text-teal-600 dark:text-teal-300' : 'text-slate-400 hover:text-slate-600 dark:hover:text-neutral-300'}`}
        >
          <Settings2 size={18} />
        </button>
      </div>

      {/* Soundscapes */}
      <div className="w-full rounded-xl border border-slate-200 p-3 dark:border-neutral-800">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-neutral-500">Soundscape</span>
          {ambience && (
            <span className="flex items-center gap-1.5 text-xs font-medium text-teal-600 dark:text-teal-300">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal-500 opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-teal-500" />
              </span>
              {AMBIENCE_META[ambience].label}
            </span>
          )}
        </div>
        <div className="flex flex-wrap justify-center gap-1.5">
          {AMBIENCE_ORDER.map((type) => {
            const Icon = AMBIENCE_ICONS[type];
            const active = ambience === type;
            return (
              <button
                key={type}
                type="button"
                onClick={() => toggleAmbience(type)}
                title={active ? `Stop ${AMBIENCE_META[type].label}` : `Play ${AMBIENCE_META[type].label}`}
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? 'border-teal-400 bg-teal-50 text-teal-700 dark:border-teal-500/50 dark:bg-teal-500/15 dark:text-teal-300'
                    : 'border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700 dark:border-neutral-700 dark:text-neutral-400 dark:hover:border-neutral-600 dark:hover:text-neutral-200'
                }`}
              >
                <Icon size={13} />
                {AMBIENCE_META[type].label}
              </button>
            );
          })}
        </div>
        <AnimatePresence initial={false}>
          {ambience && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={springs.gentle}
              className="overflow-hidden"
            >
              <div className="mt-3 flex items-center gap-2 px-1">
                <Volume2 size={14} className="shrink-0 text-slate-400 dark:text-neutral-500" />
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(ambVolume * 100)}
                  onChange={(e) => setAmbVolume(Number(e.target.value) / 100)}
                  className="w-full accent-teal-600"
                  aria-label="Soundscape volume"
                />
                <span className="w-8 shrink-0 text-right text-[11px] tabular-nums text-slate-400 dark:text-neutral-500">
                  {Math.round(ambVolume * 100)}%
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Settings */}
      <AnimatePresence initial={false}>
        {showSettings && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={springs.gentle}
            className="w-full overflow-hidden"
          >
            <div className="grid grid-cols-3 gap-3 rounded-xl border border-slate-200 p-3 dark:border-neutral-800">
              {([
                ['workMin', 'Focus'],
                ['shortMin', 'Short break'],
                ['longMin', 'Long break'],
              ] as [keyof FocusSettings, string][]).map(([key, label]) => (
                <label key={key} className="flex flex-col gap-1 text-center">
                  <span className="text-[11px] font-medium text-slate-500 dark:text-neutral-400">{label}</span>
                  <input
                    type="number"
                    min={1}
                    max={180}
                    value={settings[key] as number}
                    onChange={(e) => setSettings((s) => ({ ...s, [key]: Math.max(1, Number(e.target.value) || 1) }))}
                    className="rounded-md border border-slate-300 px-2 py-1 text-center text-sm tabular-nums dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                  />
                  <span className="text-[10px] text-slate-400 dark:text-neutral-500">min</span>
                </label>
              ))}
              <label className="col-span-3 flex items-center justify-center gap-2 text-xs text-slate-600 dark:text-neutral-300">
                <input
                  type="checkbox"
                  checked={settings.autoStart}
                  onChange={(e) => setSettings((s) => ({ ...s, autoStart: e.target.checked }))}
                  className="accent-teal-600"
                />
                Auto-start next phase
              </label>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
