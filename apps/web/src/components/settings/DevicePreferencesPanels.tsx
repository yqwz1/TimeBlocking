import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Accessibility,
  ArrowDown,
  ArrowUp,
  Bell,
  CalendarRange,
  Check,
  Clock3,
  Download,
  Eye,
  Focus,
  Keyboard,
  LayoutPanelLeft,
  Monitor,
  Moon,
  RotateCcw,
  Sun,
  type LucideIcon,
} from 'lucide-react';
import { useTheme } from '../../hooks/useTheme.js';
import {
  type MotionPreference,
  type SidebarMode,
  type TextScale,
  type ThemeDensity,
  type UiPreferences,
  type WorkspaceId,
  useUiPreferences,
  WORKSPACE_PATHS,
} from '../../lib/uiPreferences.js';
import { clearNotifications, getNotifications } from '../../lib/notifications.js';

export type DeviceSettingsSectionId =
  | 'appearance'
  | 'accessibility'
  | 'workspace_navigation'
  | 'task_defaults'
  | 'calendar_defaults'
  | 'focus_timer'
  | 'notifications'
  | 'local_data';

const WORKSPACE_LABELS: Record<WorkspaceId, string> = {
  tasks: 'Tasks',
  whiteboard: 'Whiteboard',
  notes: 'Second Brain',
  wishlist: 'Wishlist',
  workout: 'Workout',
};

function SectionShell({
  id,
  visible,
  icon: Icon,
  title,
  description,
  children,
}: {
  id: DeviceSettingsSectionId;
  visible: boolean;
  icon: LucideIcon;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section hidden={!visible} data-settings-section={id} className="rounded-xl border border-slate-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900 sm:p-6">
      <div className="mb-5 flex items-start justify-between gap-4 border-b border-slate-100 pb-4 dark:border-neutral-800">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-teal-50 text-teal-700 dark:bg-teal-500/10 dark:text-teal-300"><Icon size={18} strokeWidth={1.8} /></span>
          <div>
            <h2 className="font-semibold tracking-[-0.01em] text-slate-900 dark:text-neutral-100">{title}</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-400 dark:text-neutral-500">{description}</p>
          </div>
        </div>
        <span className="hidden shrink-0 items-center gap-1.5 text-[11px] font-medium text-slate-400 sm:flex"><Check size={12} /> Saved on this device</span>
      </div>
      {children}
    </section>
  );
}

function ToggleRow({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-5 rounded-lg px-3 py-3 transition hover:bg-slate-50 dark:hover:bg-white/[0.035]">
      <span>
        <span className="block text-sm font-medium text-slate-700 dark:text-neutral-200">{label}</span>
        <span className="mt-0.5 block text-xs leading-5 text-slate-400 dark:text-neutral-500">{description}</span>
      </span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

function ChoiceGrid<T extends string>({ value, options, onChange, columns = 3 }: { value: T; options: Array<{ value: T; label: string; description?: string; icon?: LucideIcon }>; onChange: (value: T) => void; columns?: 2 | 3 | 4 }) {
  return (
    <div className={`grid gap-2 ${columns === 2 ? 'sm:grid-cols-2' : columns === 4 ? 'sm:grid-cols-4' : 'sm:grid-cols-3'}`}>
      {options.map((option) => {
        const Icon = option.icon;
        const selected = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
            className={`min-h-20 rounded-xl border px-3 py-3 text-left transition active:translate-y-px ${selected ? 'border-teal-500 bg-teal-50 text-teal-800 shadow-[0_10px_30px_-24px_rgba(13,148,136,0.9)] dark:bg-teal-500/10 dark:text-teal-200' : 'border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50 dark:border-neutral-800 dark:text-neutral-300 dark:hover:border-neutral-700 dark:hover:bg-white/[0.035]'}`}
          >
            <span className="flex items-center gap-2 text-sm font-semibold">{Icon && <Icon size={15} />}{option.label}</span>
            {option.description && <span className="mt-1.5 block text-[11px] leading-4 opacity-65">{option.description}</span>}
          </button>
        );
      })}
    </div>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <span className="mb-1.5 block text-xs font-medium text-slate-500 dark:text-neutral-400">{children}</span>;
}

function storageBytes() {
  let bytes = 0;
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (key) bytes += (key.length + (localStorage.getItem(key)?.length ?? 0)) * 2;
  }
  return bytes;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function DevicePreferencesPanels({ isVisible }: { isVisible: (id: DeviceSettingsSectionId) => boolean }) {
  const { setting: theme, resolved, setSetting: setTheme } = useTheme();
  const { preferences, updatePreferences, resetPreferences } = useUiPreferences();
  const [resetArmed, setResetArmed] = useState(false);
  const [notificationsCleared, setNotificationsCleared] = useState(false);
  const [storageEstimate, setStorageEstimate] = useState<{ usage?: number; quota?: number }>({});
  const [notificationPermission, setNotificationPermission] = useState(() => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission));

  useEffect(() => {
    void navigator.storage?.estimate?.().then((estimate) => setStorageEstimate({ usage: estimate.usage, quota: estimate.quota }));
  }, []);

  const localBytes = useMemo(storageBytes, [preferences, notificationsCleared]);
  const set = <K extends keyof UiPreferences>(key: K, value: UiPreferences[K]) => updatePreferences({ [key]: value });
  const updateFocus = (patch: Partial<Pick<UiPreferences, 'focusWorkMin' | 'focusShortBreakMin' | 'focusLongBreakMin' | 'focusLongEvery' | 'focusAutoStart' | 'focusAmbienceVolume'>>) => updatePreferences(patch);

  const moveWorkspace = (id: WorkspaceId, direction: -1 | 1) => {
    const index = preferences.workspaceOrder.indexOf(id);
    const target = index + direction;
    if (target < 0 || target >= preferences.workspaceOrder.length) return;
    const next = [...preferences.workspaceOrder];
    [next[index], next[target]] = [next[target], next[index]];
    set('workspaceOrder', next);
  };

  const exportPreferences = () => {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), preferences }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'timeblock-device-preferences.json';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <SectionShell id="appearance" visible={isVisible('appearance')} icon={Eye} title="Appearance" description="Change the visual density, text size, color mode, and overall feel across every workspace.">
        <div className="space-y-6">
          <div><FieldLabel>Color mode</FieldLabel><ChoiceGrid value={theme} onChange={setTheme} options={[
            { value: 'light', label: 'Light', description: 'Bright surfaces and dark text.', icon: Sun },
            { value: 'dark', label: 'Dark', description: 'Low-light neutral workspace.', icon: Moon },
            { value: 'system', label: 'System', description: `Following your device (${resolved}).`, icon: Monitor },
          ]} /></div>
          <div><FieldLabel>Interface density</FieldLabel><ChoiceGrid value={preferences.density} onChange={(value: ThemeDensity) => set('density', value)} options={[
            { value: 'compact', label: 'Compact', description: 'More information in less space.' },
            { value: 'comfortable', label: 'Comfortable', description: 'Balanced spacing for daily use.' },
            { value: 'spacious', label: 'Spacious', description: 'Larger gaps and calmer screens.' },
          ]} /></div>
          <div><FieldLabel>Text size</FieldLabel><ChoiceGrid columns={4} value={preferences.textScale} onChange={(value: TextScale) => set('textScale', value)} options={[
            { value: 'small', label: 'Small', description: '94%' },
            { value: 'default', label: 'Default', description: '100%' },
            { value: 'large', label: 'Large', description: '107%' },
            { value: 'xlarge', label: 'Extra large', description: '114%' },
          ]} /></div>
        </div>
      </SectionShell>

      <SectionShell id="accessibility" visible={isVisible('accessibility')} icon={Accessibility} title="Accessibility & motion" description="Tune contrast, animation, link visibility, transparency, and target sizing to suit how you read and navigate.">
        <div className="space-y-5">
          <div><FieldLabel>Animation preference</FieldLabel><ChoiceGrid value={preferences.motion} onChange={(value: MotionPreference) => set('motion', value)} options={[
            { value: 'system', label: 'Use device setting', description: 'Follow reduced-motion preferences.' },
            { value: 'reduce', label: 'Reduce motion', description: 'Remove non-essential movement.' },
            { value: 'full', label: 'Full motion', description: 'Keep all transitions and feedback.' },
          ]} /></div>
          <div className="divide-y divide-slate-100 rounded-xl bg-slate-50/70 dark:divide-neutral-800 dark:bg-neutral-950/45">
            <ToggleRow label="Higher contrast" description="Strengthen borders, muted text, and separation between surfaces." checked={preferences.highContrast} onChange={(value) => set('highContrast', value)} />
            <ToggleRow label="Reduce transparency" description="Replace blurred and translucent surfaces with solid backgrounds." checked={preferences.reduceTransparency} onChange={(value) => set('reduceTransparency', value)} />
            <ToggleRow label="Underline links" description="Make text links easier to distinguish without relying on color." checked={preferences.underlineLinks} onChange={(value) => set('underlineLinks', value)} />
            <ToggleRow label="Larger click targets" description="Increase the minimum size of buttons and form controls." checked={preferences.largeTargets} onChange={(value) => set('largeTargets', value)} />
          </div>
        </div>
      </SectionShell>

      <SectionShell id="workspace_navigation" visible={isVisible('workspace_navigation')} icon={LayoutPanelLeft} title="Workspace navigation" description="Choose where the app opens, which workspaces appear, their order, and what stays in the global sidebar.">
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <label><FieldLabel>Open TimeBlock to</FieldLabel><select value={preferences.defaultWorkspace} onChange={(event) => set('defaultWorkspace', event.target.value as WorkspaceId)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800">{preferences.workspaceOrder.map((id) => <option key={id} value={id}>{WORKSPACE_LABELS[id]}</option>)}</select></label>
            <label><FieldLabel>Global sidebar behavior</FieldLabel><select value={preferences.sidebarMode} onChange={(event) => set('sidebarMode', event.target.value as SidebarMode)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800"><option value="remember">Remember last state</option><option value="expanded">Always expanded</option><option value="collapsed">Always collapsed</option></select></label>
          </div>
          <label className="block"><div className="mb-2 flex items-center justify-between"><FieldLabel>Expanded sidebar width</FieldLabel><span className="text-xs tabular-nums text-slate-400">{preferences.sidebarWidth}px</span></div><input type="range" min="148" max="220" step="4" value={preferences.sidebarWidth} onChange={(event) => set('sidebarWidth', Number(event.target.value))} className="w-full accent-teal-600" /></label>
          <div>
            <FieldLabel>Visible workspaces and order</FieldLabel>
            <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 dark:divide-neutral-800 dark:border-neutral-800">
              {preferences.workspaceOrder.map((id, index) => (
                <div key={id} className="flex items-center gap-3 px-3 py-2.5">
                  <input type="checkbox" checked={preferences.visibleWorkspaces[id]} onChange={(event) => set('visibleWorkspaces', { ...preferences.visibleWorkspaces, [id]: event.target.checked })} aria-label={`Show ${WORKSPACE_LABELS[id]}`} />
                  <span className="min-w-0 flex-1 text-sm font-medium text-slate-700 dark:text-neutral-200">{WORKSPACE_LABELS[id]}</span>
                  <span className="hidden text-[11px] text-slate-400 sm:block">{WORKSPACE_PATHS[id]}</span>
                  <button type="button" aria-label={`Move ${WORKSPACE_LABELS[id]} up`} disabled={index === 0} onClick={() => moveWorkspace(id, -1)} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 disabled:opacity-25 dark:hover:bg-white/5"><ArrowUp size={14} /></button>
                  <button type="button" aria-label={`Move ${WORKSPACE_LABELS[id]} down`} disabled={index === preferences.workspaceOrder.length - 1} onClick={() => moveWorkspace(id, 1)} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 disabled:opacity-25 dark:hover:bg-white/5"><ArrowDown size={14} /></button>
                </div>
              ))}
            </div>
          </div>
          <div className="divide-y divide-slate-100 rounded-xl bg-slate-50/70 dark:divide-neutral-800 dark:bg-neutral-950/45">
            <ToggleRow label="Quick capture in sidebar" description="Keep the global note capture action visible." checked={preferences.showQuickCapture} onChange={(value) => set('showQuickCapture', value)} />
            <ToggleRow label="Sync status" description="Show schedule state and sync controls in the sidebar." checked={preferences.showSyncStatus} onChange={(value) => set('showSyncStatus', value)} />
            <ToggleRow label="Notification bell" description="Show the notification inbox in the sidebar footer." checked={preferences.showNotifications} onChange={(value) => set('showNotifications', value)} />
            <ToggleRow label="Theme control" description="Keep the quick theme switch in the sidebar footer." checked={preferences.showThemeControl} onChange={(value) => set('showThemeControl', value)} />
          </div>
        </div>
      </SectionShell>

      <SectionShell id="task_defaults" visible={isVisible('task_defaults')} icon={Focus} title="Task workspace defaults" description="Control which task view opens first, how tasks are sorted, and how the project sidebar behaves.">
        <div className="space-y-6">
          <div><FieldLabel>Default task view</FieldLabel><ChoiceGrid value={preferences.taskDefaultView} onChange={(value) => set('taskDefaultView', value)} options={[
            { value: 'list', label: 'List', description: 'Fast scanning and editing.' },
            { value: 'kanban', label: 'Kanban', description: 'Columns grouped by status.' },
            { value: 'gantt', label: 'Timeline', description: 'Plan work across dates.' },
            { value: 'upcoming', label: 'Upcoming', description: 'A forward-looking queue.' },
            { value: 'dashboard', label: 'Dashboard', description: 'Summary and workload signals.' },
          ]} /></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label><FieldLabel>Default task sorting</FieldLabel><select value={preferences.taskDefaultSort} onChange={(event) => set('taskDefaultSort', event.target.value as UiPreferences['taskDefaultSort'])} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800"><option value="manual">Manual order</option><option value="priority">Priority</option><option value="dueDate">Due date</option><option value="difficulty">Difficulty</option></select></label>
            <label><FieldLabel>Project sidebar behavior</FieldLabel><select value={preferences.taskSidebarMode} onChange={(event) => set('taskSidebarMode', event.target.value as SidebarMode)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800"><option value="remember">Remember last state</option><option value="expanded">Always expanded</option><option value="collapsed">Always collapsed</option></select></label>
          </div>
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-500 dark:bg-neutral-950/45 dark:text-neutral-400">Defaults apply when you open Tasks without a view in the URL. Direct links still open the view they specify.</p>
        </div>
      </SectionShell>

      <SectionShell id="calendar_defaults" visible={isVisible('calendar_defaults')} icon={CalendarRange} title="Calendar defaults" description="Choose the opening calendar range, timeline resolution, and whether the planning rail starts open.">
        <div className="space-y-6">
          <div><FieldLabel>Opening view</FieldLabel><ChoiceGrid columns={4} value={preferences.calendarDefaultView} onChange={(value) => set('calendarDefaultView', value)} options={[
            { value: 'timeGridDay', label: 'Day' }, { value: 'timeGridWeek', label: 'Week' }, { value: 'dayGridMonth', label: 'Month' }, { value: 'multiMonthYear', label: 'Year' },
          ]} /></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label><FieldLabel>Timeline increments</FieldLabel><select value={preferences.calendarSlotDuration} onChange={(event) => set('calendarSlotDuration', event.target.value as UiPreferences['calendarSlotDuration'])} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800"><option value="00:15:00">15 minutes</option><option value="00:30:00">30 minutes</option><option value="01:00:00">60 minutes</option></select></label>
            <div className="rounded-xl bg-slate-50/70 dark:bg-neutral-950/45"><ToggleRow label="Open planning rail" description="Show the calendar side rail by default." checked={preferences.calendarRailOpen} onChange={(value) => set('calendarRailOpen', value)} /></div>
          </div>
        </div>
      </SectionShell>

      <SectionShell id="focus_timer" visible={isVisible('focus_timer')} icon={Clock3} title="Focus timer & ambience" description="Set the Pomodoro rhythm and the default soundscape volume before entering Focus mode.">
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {([
              ['focusWorkMin', 'Focus session', preferences.focusWorkMin, 5, 180],
              ['focusShortBreakMin', 'Short break', preferences.focusShortBreakMin, 1, 60],
              ['focusLongBreakMin', 'Long break', preferences.focusLongBreakMin, 1, 120],
              ['focusLongEvery', 'Long break every', preferences.focusLongEvery, 2, 12],
            ] as const).map(([key, label, value, min, max]) => <label key={key}><FieldLabel>{label}{key === 'focusLongEvery' ? ' sessions' : ' (minutes)'}</FieldLabel><input type="number" min={min} max={max} value={value} onChange={(event) => updateFocus({ [key]: Number(event.target.value) })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800" /></label>)}
          </div>
          <div className="rounded-xl bg-slate-50/70 dark:bg-neutral-950/45"><ToggleRow label="Auto-start the next phase" description="Start breaks and focus sessions without an extra click." checked={preferences.focusAutoStart} onChange={(value) => updateFocus({ focusAutoStart: value })} /></div>
          <label className="block"><div className="mb-2 flex items-center justify-between"><FieldLabel>Default ambience volume</FieldLabel><span className="text-xs tabular-nums text-slate-400">{Math.round(preferences.focusAmbienceVolume * 100)}%</span></div><input type="range" min="0" max="1" step="0.05" value={preferences.focusAmbienceVolume} onChange={(event) => updateFocus({ focusAmbienceVolume: Number(event.target.value) })} className="w-full accent-teal-600" /></label>
        </div>
      </SectionShell>

      <SectionShell id="notifications" visible={isVisible('notifications')} icon={Bell} title="Notifications & shortcuts" description="Control the global inbox, stored history, browser permission, and app-wide keyboard actions.">
        <div className="space-y-5">
          <div className="divide-y divide-slate-100 rounded-xl bg-slate-50/70 dark:divide-neutral-800 dark:bg-neutral-950/45">
            <ToggleRow label="Show notification inbox" description="Keep the bell and unread count in the global sidebar." checked={preferences.showNotifications} onChange={(value) => set('showNotifications', value)} />
            <ToggleRow label="Global keyboard shortcuts" description="Enable Ctrl/Cmd+K for commands and Ctrl/Cmd+Shift+C for quick capture." checked={preferences.globalShortcuts} onChange={(value) => set('globalShortcuts', value)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label><FieldLabel>Notification history kept</FieldLabel><select value={preferences.notificationRetention} onChange={(event) => set('notificationRetention', Number(event.target.value) as UiPreferences['notificationRetention'])} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800"><option value="10">10 items</option><option value="25">25 items</option><option value="50">50 items</option><option value="100">100 items</option></select></label>
            <div><FieldLabel>Browser notification permission</FieldLabel><button type="button" disabled={notificationPermission === 'unsupported' || notificationPermission === 'granted'} onClick={() => void Notification.requestPermission().then(setNotificationPermission)} className="flex w-full items-center justify-between rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 transition hover:bg-slate-50 disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-white/5"><span>{notificationPermission === 'unsupported' ? 'Not supported' : notificationPermission === 'granted' ? 'Permission granted' : notificationPermission === 'denied' ? 'Blocked in browser settings' : 'Request permission'}</span><Keyboard size={15} /></button></div>
          </div>
          <button type="button" onClick={() => { clearNotifications(); setNotificationsCleared(true); }} disabled={!getNotifications().length || notificationsCleared} className="text-sm font-medium text-rose-600 hover:underline disabled:text-slate-400 disabled:no-underline">{notificationsCleared ? 'Notification history cleared' : `Clear ${getNotifications().length} stored notifications`}</button>
        </div>
      </SectionShell>

      <SectionShell id="local_data" visible={isVisible('local_data')} icon={Download} title="Local data & reset" description="Inspect browser storage, export device preferences, or return only interface preferences to their defaults.">
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-slate-50 p-4 dark:bg-neutral-950/45"><p className="text-xs text-slate-400">Local preferences</p><p className="mt-1 text-lg font-semibold tabular-nums text-slate-800 dark:text-neutral-100">{formatBytes(localBytes)}</p></div>
            <div className="rounded-xl bg-slate-50 p-4 dark:bg-neutral-950/45"><p className="text-xs text-slate-400">App storage used</p><p className="mt-1 text-lg font-semibold tabular-nums text-slate-800 dark:text-neutral-100">{storageEstimate.usage == null ? 'Unavailable' : formatBytes(storageEstimate.usage)}</p></div>
            <div className="rounded-xl bg-slate-50 p-4 dark:bg-neutral-950/45"><p className="text-xs text-slate-400">Browser quota</p><p className="mt-1 text-lg font-semibold tabular-nums text-slate-800 dark:text-neutral-100">{storageEstimate.quota == null ? 'Unavailable' : formatBytes(storageEstimate.quota)}</p></div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={exportPreferences} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-white/5"><Download size={14} /> Export device preferences</button>
            {!resetArmed ? <button type="button" onClick={() => setResetArmed(true)} className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-rose-600 transition hover:bg-rose-50 dark:hover:bg-rose-500/10"><RotateCcw size={14} /> Reset interface preferences</button> : <div className="flex items-center gap-2 rounded-lg bg-rose-50 p-1 dark:bg-rose-500/10"><span className="px-2 text-xs text-rose-700 dark:text-rose-300">Reset appearance and workspace defaults?</span><button type="button" onClick={() => { resetPreferences(); setResetArmed(false); }} className="rounded-md bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white">Reset</button><button type="button" onClick={() => setResetArmed(false)} className="px-2 py-1.5 text-xs text-slate-500">Cancel</button></div>}
          </div>
          <p className="text-xs leading-5 text-slate-400">This reset does not delete tasks, notes, calendar data, Google connections, or server-backed settings.</p>
        </div>
      </SectionShell>
    </>
  );
}
