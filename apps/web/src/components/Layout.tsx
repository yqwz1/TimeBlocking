import { useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { NavLink, useLocation, useOutlet } from 'react-router-dom';
import { useLiveSync, useSettings, useSetupStatus } from '../hooks.js';
import { useTheme } from '../hooks/useTheme.js';
import { useUndoRedoShortcuts } from '../lib/undoStack.js';
import { pageVariants, springs } from '../lib/motion.js';
import { setSoundEnabled } from '../lib/sound.js';
import SyncStatusBar from './SyncStatusBar.js';
import ScheduleStateChip from './ScheduleStateChip.js';
import UndoRedoControls from './UndoRedoControls.js';
import CelebrationToasts from './CelebrationToasts.js';
import NotificationCenter from './NotificationCenter.js';
import ReminderToasts from './ReminderToasts.js';
import UndoToasts from './UndoToasts.js';
import ConfettiBurst from './ConfettiBurst.js';
import VoiceCapture from './VoiceCapture.js';

function ThemeToggle({ gameMode }: { gameMode: boolean }) {
  const { setting, resolved, setSetting } = useTheme();
  const cycle = () => setSetting(setting === 'system' ? (resolved === 'dark' ? 'light' : 'dark') : setting === 'dark' ? 'light' : 'dark');
  const icon = setting === 'system' ? '🖥️' : resolved === 'dark' ? '🌙' : '☀️';
  const label = setting === 'system' ? 'Theme: System' : resolved === 'dark' ? 'Theme: Dark' : 'Theme: Light';
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.88, rotate: -12 }}
      onClick={cycle}
      title={`${label} (click to change)`}
      className={`rounded-md px-2 py-1.5 text-sm ${
        gameMode ? 'text-slate-300 hover:bg-white/5' : 'text-slate-600 hover:bg-slate-100 dark:text-neutral-300 dark:hover:bg-white/5'
      }`}
    >
      {icon}
    </motion.button>
  );
}

const tabs = [
  { to: '/tasks', label: 'Tasks' },
  { to: '/whiteboard', label: 'Whiteboard' },
  { to: '/notes', label: 'Second Brain' },
];

export default function Layout() {
  useLiveSync();
  useUndoRedoShortcuts();
  const { data: settings } = useSettings();
  useEffect(() => {
    if (settings) setSoundEnabled(settings.soundEffects);
  }, [settings?.soundEffects]);
  const { data: setup } = useSetupStatus();
  const setupIncomplete = setup && (!setup.google || !setup.calendarChosen);
  const location = useLocation();
  const outlet = useOutlet();
  const gameMode = location.pathname.startsWith('/today');
  const fullBleed = location.pathname.startsWith('/tasks') || location.pathname.startsWith('/whiteboard') || location.pathname.startsWith('/notes');

  return (
    <div className={`flex h-dvh min-h-0 overflow-hidden flex-col transition-colors duration-300 ${gameMode ? 'bg-[#0b0f1a]' : 'dark:bg-neutral-950'}`}>
      <header
        className={`shrink-0 border-b transition-colors duration-300 ${gameMode ? 'border-slate-800/80 bg-[#0e1424]' : 'border-slate-200 bg-white dark:border-neutral-800 dark:bg-neutral-900'}`}
      >
        <div className="tb-app-header-row flex w-full items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-6">
            <span className={`text-lg font-semibold ${gameMode ? 'text-slate-100' : 'text-slate-900 dark:text-neutral-100'}`}>
              ⏱ TimeBlock
            </span>
            <nav className="flex gap-1">
              {tabs.map((t) => (
                <NavLink
                  key={t.to}
                  to={t.to}
                  className={({ isActive }) =>
                    `relative rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                      gameMode
                        ? isActive
                          ? 'text-teal-300'
                          : 'text-slate-400 hover:bg-white/5'
                        : isActive
                          ? 'text-teal-700 dark:text-teal-300'
                          : 'text-slate-600 hover:bg-slate-50 dark:text-neutral-400 dark:hover:bg-white/5'
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && (
                        <motion.span
                          layoutId="nav-active-pill"
                          transition={springs.snappy}
                          className={`absolute inset-0 rounded-md ${gameMode ? 'bg-teal-500/15' : 'bg-teal-50 dark:bg-teal-500/15'}`}
                        />
                      )}
                      <span className="relative">{t.label}</span>
                    </>
                  )}
                </NavLink>
              ))}
            </nav>
          </div>
          <div className={`flex items-center gap-4 ${gameMode ? '[&_*]:text-slate-300' : ''}`}>
            <VoiceCapture gameMode={gameMode} />
            <UndoRedoControls gameMode={gameMode} />
            <ScheduleStateChip />
            <SyncStatusBar />
            <NotificationCenter gameMode={gameMode} />
            <ThemeToggle gameMode={gameMode} />
          </div>
        </div>
        {setupIncomplete && (
          <div className="bg-amber-50 px-4 py-2 text-center text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
            Setup isn't finished yet.{' '}
            <NavLink to="/setup" className="font-medium underline">
              Finish setup
            </NavLink>{' '}
            to start syncing with Google Calendar.
          </div>
        )}
      </header>
      <main
        className={`relative min-h-0 flex-1 ${
          fullBleed ? 'w-full overflow-hidden' : 'mx-auto w-full max-w-7xl overflow-y-auto px-4 py-6'
        }`}
      >
        <AnimatePresence initial={false}>
          <motion.div
            key={location.pathname}
            className={fullBleed ? 'h-full min-h-0' : 'min-h-full'}
            variants={pageVariants}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            {outlet}
          </motion.div>
        </AnimatePresence>
      </main>
      <CelebrationToasts />
      <ReminderToasts />
      <UndoToasts />
      <ConfettiBurst />
    </div>
  );
}
