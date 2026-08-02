import { useEffect, useMemo, useState } from 'react';
import {
  BrainCircuit,
  CheckSquare2,
  Clock3,
  FilePlus2,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  PanelsTopLeft,
  Sun,
  ShoppingBag,
  Dumbbell,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { NavLink, useLocation, useNavigate, useOutlet } from 'react-router-dom';
import { useLiveSync, useSettings, useSetupStatus } from '../hooks.js';
import { useResizableSidebar } from '../hooks/useResizableSidebar.js';
import { useTheme } from '../hooks/useTheme.js';
import CommandPalette from './CommandPalette.js';
import { useUndoRedoShortcuts } from '../lib/undoStack.js';
import { pageVariants, springs } from '../lib/motion.js';
import { setSoundEnabled } from '../lib/sound.js';
import { useCommandPaletteState } from '../lib/commandPalette.js';
import SyncStatusBar from './SyncStatusBar.js';
import ScheduleStateChip from './ScheduleStateChip.js';
import UndoRedoControls from './UndoRedoControls.js';
import CelebrationToasts from './CelebrationToasts.js';
import NotificationCenter from './NotificationCenter.js';
import ReminderToasts from './ReminderToasts.js';
import UndoToasts from './UndoToasts.js';
import ConfettiBurst from './ConfettiBurst.js';
import VoiceCapture from './VoiceCapture.js';
import QuickCaptureModal from './notes/QuickCaptureModal.js';

function ThemeToggle({ gameMode }: { gameMode: boolean }) {
  const { setting, resolved, setSetting } = useTheme();
  const cycle = () => setSetting(setting === 'system' ? (resolved === 'dark' ? 'light' : 'dark') : setting === 'dark' ? 'light' : 'dark');
  const ThemeIcon = setting === 'system' ? Monitor : resolved === 'dark' ? Moon : Sun;
  const label = setting === 'system' ? 'Theme: System' : resolved === 'dark' ? 'Theme: Dark' : 'Theme: Light';
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.9 }}
      onClick={cycle}
      title={`${label} (click to change)`}
      aria-label={label}
      className={`rounded-md p-2 transition-colors ${
        gameMode ? 'text-slate-400 hover:bg-white/5 hover:text-slate-200' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-neutral-400 dark:hover:bg-white/5 dark:hover:text-neutral-200'
      }`}
    >
      <ThemeIcon size={16} strokeWidth={1.8} />
    </motion.button>
  );
}

const tabs = [
  { to: '/tasks', label: 'Tasks', icon: CheckSquare2 },
  { to: '/whiteboard', label: 'Whiteboard', icon: PanelsTopLeft },
  { to: '/notes', label: 'Second Brain', icon: BrainCircuit },
  { to: '/wishlist', label: 'Wishlist', icon: ShoppingBag },
  { to: '/workout', label: 'Workout', icon: Dumbbell },
];

export default function Layout() {
  useLiveSync();
  useUndoRedoShortcuts();
  const { data: settings } = useSettings();
  const { scopedCommands } = useCommandPaletteState();
  const navigate = useNavigate();
  const [showQuickCapture, setShowQuickCapture] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const { width, collapsed, dragging, toggleCollapsed, startDrag } = useResizableSidebar('tb.appSidebar', {
    minWidth: 148,
    maxWidth: 220,
    defaultWidth: 176,
    collapsedWidth: 48,
  });
  const [narrowSidebar, setNarrowSidebar] = useState(() => window.matchMedia('(max-width: 767px)').matches);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)');
    const update = () => setNarrowSidebar(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const sidebarCollapsed = collapsed || narrowSidebar;
  const sidebarWidth = narrowSidebar ? 48 : width;

  useEffect(() => {
    if (settings) setSoundEnabled(settings.soundEffects);
  }, [settings?.soundEffects]);
  const { data: setup } = useSetupStatus();
  const setupIncomplete = setup && (!setup.google || !setup.calendarChosen);
  const location = useLocation();
  const outlet = useOutlet();
  const gameMode = location.pathname.startsWith('/today');
  const fullBleed = location.pathname.startsWith('/tasks') || location.pathname.startsWith('/whiteboard') || location.pathname.startsWith('/notes') || location.pathname.startsWith('/wishlist') || location.pathname.startsWith('/workout');
  const paletteCommands = useMemo(
    () => [
      { id: 'nav-tasks', title: 'Go to Tasks', subtitle: 'Open the task manager workspace', shortcut: 'G T', keywords: ['tasks schedule inbox calendar'], run: () => navigate('/tasks') },
      { id: 'nav-whiteboard', title: 'Go to Whiteboard', subtitle: 'Open your whiteboards', shortcut: 'G W', keywords: ['board sketch draw'], run: () => navigate('/whiteboard') },
      { id: 'nav-notes', title: 'Go to Second Brain', subtitle: 'Open your notes workspace', shortcut: 'G N', keywords: ['notes second brain vault'], run: () => navigate('/notes') },
      { id: 'nav-wishlist', title: 'Go to Wishlist', subtitle: 'Plan purchases against your goals and budget', shortcut: 'G L', keywords: ['wishlist shopping budget buy'], run: () => navigate('/wishlist') },
      { id: 'nav-workout', title: 'Go to Workout', subtitle: 'Open the strength coaching workspace', shortcut: 'G F', keywords: ['workout fitness strength training hevy'], run: () => navigate('/workout') },
      { id: 'nav-settings', title: 'Open Settings', subtitle: 'Jump to app settings', shortcut: 'G S', keywords: ['settings preferences'], run: () => navigate('/settings') },
      { id: 'quick-capture', title: 'Quick capture', subtitle: 'Create a fast note from anywhere', shortcut: 'Ctrl/Cmd+Shift+C', keywords: ['capture inbox note'], run: () => setShowQuickCapture(true) },
      ...scopedCommands,
    ],
    [navigate, scopedCommands],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setShowCommandPalette(true);
      } else if (mod && event.shiftKey && event.key.toLowerCase() === 'c') {
        event.preventDefault();
        setShowQuickCapture(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const sidebarSurface = gameMode
    ? 'border-slate-800/80 bg-[#0e1424] text-slate-100'
    : 'border-slate-200 bg-white text-slate-900 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100';

  return (
    <div className={`flex h-dvh min-h-0 overflow-hidden transition-colors duration-300 ${gameMode ? 'bg-[#0b0f1a]' : 'bg-slate-50 dark:bg-neutral-950'}`}>
      <motion.aside
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.18 }}
        style={{ width: sidebarWidth }}
        aria-label="Primary navigation"
        className={`relative z-40 flex shrink-0 flex-col overflow-visible border-r px-1.5 pb-2 pt-[max(0.5rem,env(titlebar-area-height,0px))] ${
          dragging ? 'transition-none' : 'transition-[width] duration-200 ease-out'
        } ${sidebarSurface}`}
      >
        {!sidebarCollapsed && (
          <div
            onMouseDown={startDrag}
            aria-hidden="true"
            className={`absolute -right-0.5 top-0 h-full w-1 cursor-col-resize select-none transition-colors hover:bg-slate-300/70 dark:hover:bg-neutral-600 ${
              dragging ? 'bg-slate-400/70 dark:bg-neutral-500' : 'bg-transparent'
            }`}
          />
        )}

        <div className={`flex h-10 items-center ${sidebarCollapsed ? 'justify-center' : 'justify-between px-1.5'}`}>
          {sidebarCollapsed ? narrowSidebar ? (
            <Clock3 size={17} strokeWidth={1.8} className="text-slate-500 dark:text-neutral-400" />
          ) : (
            <button
              type="button"
              onClick={toggleCollapsed}
              title="Expand sidebar"
              aria-label="Expand sidebar"
              className="rounded-md p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 dark:text-neutral-400 dark:hover:bg-white/5 dark:hover:text-neutral-100"
            >
              <PanelLeftOpen size={17} strokeWidth={1.8} />
            </button>
          ) : (
            <>
              <div className="flex min-w-0 items-center gap-2">
                <Clock3 size={17} strokeWidth={1.8} className="shrink-0 text-slate-500 dark:text-neutral-400" />
                <span className="truncate text-sm font-semibold tracking-[-0.01em]">TimeBlock</span>
              </div>
              <button
                type="button"
                onClick={toggleCollapsed}
                title="Collapse sidebar"
                aria-label="Collapse sidebar"
                className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:text-neutral-500 dark:hover:bg-white/5 dark:hover:text-neutral-200"
              >
                <PanelLeftClose size={16} strokeWidth={1.8} />
              </button>
            </>
          )}
        </div>

        <nav className="mt-3 flex flex-col gap-1" aria-label="Workspaces">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <NavLink
                key={tab.to}
                to={tab.to}
                title={tab.label}
                className={({ isActive }) =>
                  `group relative flex h-9 items-center rounded-md outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-slate-400/60 ${
                    sidebarCollapsed ? 'justify-center px-0' : 'gap-2.5 px-2'
                  } ${
                    gameMode
                      ? isActive
                        ? 'text-slate-100'
                        : 'text-slate-400 hover:bg-white/[0.045] hover:text-slate-200'
                      : isActive
                        ? 'text-slate-900 dark:text-neutral-100'
                        : 'text-slate-500 hover:bg-slate-100/80 hover:text-slate-800 dark:text-neutral-400 dark:hover:bg-white/[0.045] dark:hover:text-neutral-200'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <motion.span
                        layoutId="workspace-nav-active"
                        transition={springs.snappy}
                        className={`absolute inset-0 rounded-md ${
                          gameMode ? 'bg-white/[0.065]' : 'bg-slate-100 dark:bg-white/[0.06]'
                        }`}
                      />
                    )}
                    <span className="relative grid h-6 w-6 shrink-0 place-items-center transition-transform duration-150 group-hover:translate-x-px">
                      <Icon size={16} strokeWidth={1.8} />
                    </span>
                    {!sidebarCollapsed && <span className="relative truncate text-[13px] font-medium">{tab.label}</span>}
                  </>
                )}
              </NavLink>
            );
          })}
        </nav>

        <div className="mt-auto space-y-2">
          {!sidebarCollapsed && (
            <div className="space-y-1.5 border-t border-slate-200/80 pt-3 dark:border-neutral-800">
              <div className="[&>button]:w-full [&>button]:justify-start [&>button]:rounded-md [&>button]:border-slate-200 [&>button]:bg-transparent [&>button]:px-2 [&>button]:text-slate-500 [&>button:hover]:bg-slate-50 dark:[&>button]:border-neutral-800 dark:[&>button]:text-neutral-400 dark:[&>button:hover]:bg-white/[0.04]">
                <ScheduleStateChip />
              </div>
              <div className="[&>div]:grid [&>div]:grid-cols-[auto_1fr] [&>div]:gap-x-2 [&>div]:gap-y-1.5 [&>div]:px-1 [&>div]:text-[11px] [&_button]:col-span-2 [&_button]:w-full [&_button]:border-slate-200 [&_button]:text-slate-500 [&_button:hover]:bg-slate-50 dark:[&_button]:border-neutral-800 dark:[&_button]:text-neutral-400 dark:[&_button:hover]:bg-white/[0.04]">
                <SyncStatusBar />
              </div>
            </div>
          )}

          <motion.button
            type="button"
            whileTap={{ scale: 0.97 }}
            onClick={() => setShowQuickCapture(true)}
            title="Quick capture (Ctrl/Cmd+Shift+C)"
            aria-label="Quick capture"
            className={`flex h-9 w-full items-center rounded-md border border-slate-200 text-slate-600 outline-none transition-colors hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-slate-400/60 dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-white/[0.04] ${
              sidebarCollapsed ? 'justify-center' : 'gap-2 px-2'
            }`}
          >
            <FilePlus2 size={15} strokeWidth={1.8} />
            {!sidebarCollapsed && <span className="truncate text-xs font-medium">Quick capture</span>}
          </motion.button>

          <div
            className={`border-t border-slate-200/80 pt-2 dark:border-neutral-800 ${
              sidebarCollapsed ? 'flex flex-col items-center gap-0.5' : 'flex items-center justify-between'
            }`}
          >
            <VoiceCapture gameMode={gameMode} />
            {!sidebarCollapsed && width >= 172 && <UndoRedoControls gameMode={gameMode} />}
            <NotificationCenter gameMode={gameMode} placement="sidebar" />
            <ThemeToggle gameMode={gameMode} />
          </div>
        </div>
      </motion.aside>

      <div className="flex min-w-0 flex-1 flex-col pt-[env(titlebar-area-height,0px)]">
        {setupIncomplete && (
          <div className="shrink-0 border-b border-amber-200/70 bg-amber-50 px-4 py-2 text-center text-sm text-amber-800 dark:border-amber-500/15 dark:bg-amber-500/10 dark:text-amber-300">
            Setup isn't finished yet.{' '}
            <NavLink to="/setup" className="font-medium underline underline-offset-2">
              Finish setup
            </NavLink>{' '}
            to start syncing with Google Calendar.
          </div>
        )}
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
      </div>
      <CelebrationToasts />
      <ReminderToasts />
      <UndoToasts />
      <ConfettiBurst />
      {showQuickCapture && (
        <QuickCaptureModal
          onClose={() => setShowQuickCapture(false)}
          onCreated={(noteId, options) => {
            setShowQuickCapture(false);
            navigate(`/notes?note=${encodeURIComponent(noteId)}${options?.readingView ? '&view=reading' : ''}`);
          }}
        />
      )}
      {showCommandPalette && <CommandPalette commands={paletteCommands} onClose={() => setShowCommandPalette(false)} />}
    </div>
  );
}
