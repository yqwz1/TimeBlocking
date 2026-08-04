import { useSyncExternalStore } from 'react';
import type { SortBy, TasksView } from '../components/tasks/types.js';
import type { CalendarView, SlotDuration } from '../components/calendar/CalendarToolbar.js';

export type WorkspaceId = 'tasks' | 'whiteboard' | 'notes' | 'wishlist' | 'workout';
export type ThemeDensity = 'compact' | 'comfortable' | 'spacious';
export type TextScale = 'small' | 'default' | 'large' | 'xlarge';
export type MotionPreference = 'system' | 'reduce' | 'full';
export type SidebarMode = 'remember' | 'expanded' | 'collapsed';

export interface UiPreferences {
  density: ThemeDensity;
  textScale: TextScale;
  motion: MotionPreference;
  highContrast: boolean;
  reduceTransparency: boolean;
  underlineLinks: boolean;
  largeTargets: boolean;
  defaultWorkspace: WorkspaceId;
  workspaceOrder: WorkspaceId[];
  visibleWorkspaces: Record<WorkspaceId, boolean>;
  sidebarMode: SidebarMode;
  sidebarWidth: number;
  showQuickCapture: boolean;
  showSyncStatus: boolean;
  showNotifications: boolean;
  showThemeControl: boolean;
  globalShortcuts: boolean;
  taskDefaultView: Extract<TasksView, 'list' | 'kanban' | 'gantt' | 'upcoming' | 'dashboard'>;
  taskDefaultSort: SortBy;
  taskSidebarMode: SidebarMode;
  calendarDefaultView: CalendarView;
  calendarSlotDuration: SlotDuration;
  calendarRailOpen: boolean;
  focusWorkMin: number;
  focusShortBreakMin: number;
  focusLongBreakMin: number;
  focusLongEvery: number;
  focusAutoStart: boolean;
  focusAmbienceVolume: number;
  notificationRetention: 10 | 25 | 50 | 100;
}

const STORAGE_KEY = 'tb.ui.preferences';
export const UI_PREFERENCES_EVENT = 'tb-ui-preferences-changed';
export const WORKSPACE_PATHS: Record<WorkspaceId, string> = {
  tasks: '/tasks',
  whiteboard: '/whiteboard',
  notes: '/notes',
  wishlist: '/wishlist',
  workout: '/workout',
};

export const DEFAULT_UI_PREFERENCES: UiPreferences = {
  density: 'comfortable',
  textScale: 'default',
  motion: 'system',
  highContrast: false,
  reduceTransparency: false,
  underlineLinks: false,
  largeTargets: false,
  defaultWorkspace: 'tasks',
  workspaceOrder: ['tasks', 'whiteboard', 'notes', 'wishlist', 'workout'],
  visibleWorkspaces: { tasks: true, whiteboard: true, notes: true, wishlist: true, workout: true },
  sidebarMode: 'remember',
  sidebarWidth: 176,
  showQuickCapture: true,
  showSyncStatus: true,
  showNotifications: true,
  showThemeControl: true,
  globalShortcuts: true,
  taskDefaultView: 'list',
  taskDefaultSort: 'manual',
  taskSidebarMode: 'remember',
  calendarDefaultView: 'timeGridWeek',
  calendarSlotDuration: '00:30:00',
  calendarRailOpen: false,
  focusWorkMin: 25,
  focusShortBreakMin: 5,
  focusLongBreakMin: 15,
  focusLongEvery: 4,
  focusAutoStart: false,
  focusAmbienceVolume: 0.45,
  notificationRetention: 50,
};

const WORKSPACE_IDS = Object.keys(WORKSPACE_PATHS) as WorkspaceId[];

function clamp(value: unknown, min: number, max: number, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function normalize(input: Partial<UiPreferences> | null | undefined): UiPreferences {
  const merged = { ...DEFAULT_UI_PREFERENCES, ...(input ?? {}) };
  const requestedOrder = Array.isArray(merged.workspaceOrder) ? merged.workspaceOrder : [];
  const workspaceOrder = [...new Set([...requestedOrder.filter((id): id is WorkspaceId => WORKSPACE_IDS.includes(id)), ...WORKSPACE_IDS])];
  return {
    ...merged,
    workspaceOrder,
    visibleWorkspaces: { ...DEFAULT_UI_PREFERENCES.visibleWorkspaces, ...(merged.visibleWorkspaces ?? {}) },
    sidebarWidth: clamp(merged.sidebarWidth, 148, 220, DEFAULT_UI_PREFERENCES.sidebarWidth),
    focusWorkMin: clamp(merged.focusWorkMin, 5, 180, DEFAULT_UI_PREFERENCES.focusWorkMin),
    focusShortBreakMin: clamp(merged.focusShortBreakMin, 1, 60, DEFAULT_UI_PREFERENCES.focusShortBreakMin),
    focusLongBreakMin: clamp(merged.focusLongBreakMin, 1, 120, DEFAULT_UI_PREFERENCES.focusLongBreakMin),
    focusLongEvery: clamp(merged.focusLongEvery, 2, 12, DEFAULT_UI_PREFERENCES.focusLongEvery),
    focusAmbienceVolume: clamp(merged.focusAmbienceVolume, 0, 1, DEFAULT_UI_PREFERENCES.focusAmbienceVolume),
  };
}

function load(): UiPreferences {
  try {
    return normalize(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<UiPreferences> | null);
  } catch {
    return DEFAULT_UI_PREFERENCES;
  }
}

let snapshot = typeof window === 'undefined' ? DEFAULT_UI_PREFERENCES : load();
const listeners = new Set<() => void>();

function syncLegacyPreferences(preferences: UiPreferences) {
  localStorage.setItem('tb.appSidebar.width', String(preferences.sidebarWidth));
  if (preferences.sidebarMode !== 'remember') localStorage.setItem('tb.appSidebar.collapsed', preferences.sidebarMode === 'collapsed' ? '1' : '0');
  if (preferences.taskSidebarMode !== 'remember') localStorage.setItem('tb.taskSidebar.collapsed', preferences.taskSidebarMode === 'collapsed' ? '1' : '0');
  localStorage.setItem('tb-calendar-view', JSON.stringify(preferences.calendarDefaultView));
  localStorage.setItem('tb-calendar-slot', JSON.stringify(preferences.calendarSlotDuration));
  localStorage.setItem('tb-calendar-rail', JSON.stringify(preferences.calendarRailOpen));
  localStorage.setItem(
    'tb.focus.settings',
    JSON.stringify({
      workMin: preferences.focusWorkMin,
      shortMin: preferences.focusShortBreakMin,
      longMin: preferences.focusLongBreakMin,
      longEvery: preferences.focusLongEvery,
      autoStart: preferences.focusAutoStart,
    }),
  );
  localStorage.setItem('tb.focus.ambience', JSON.stringify({ volume: preferences.focusAmbienceVolume }));
}

function apply(preferences: UiPreferences) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.density = preferences.density;
  root.dataset.textScale = preferences.textScale;
  root.classList.toggle('tb-reduce-motion', preferences.motion === 'reduce');
  root.classList.toggle('tb-high-contrast', preferences.highContrast);
  root.classList.toggle('tb-reduce-transparency', preferences.reduceTransparency);
  root.classList.toggle('tb-underline-links', preferences.underlineLinks);
  root.classList.toggle('tb-large-targets', preferences.largeTargets);
}

function emit() {
  apply(snapshot);
  syncLegacyPreferences(snapshot);
  window.dispatchEvent(new CustomEvent(UI_PREFERENCES_EVENT));
  listeners.forEach((listener) => listener());
}

export function getUiPreferences() {
  return snapshot;
}

export function updateUiPreferences(patch: Partial<UiPreferences>) {
  snapshot = normalize({ ...snapshot, ...patch });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  emit();
}

export function resetUiPreferences() {
  snapshot = DEFAULT_UI_PREFERENCES;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  emit();
}

export function subscribeUiPreferences(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useUiPreferences() {
  const preferences = useSyncExternalStore(subscribeUiPreferences, getUiPreferences, () => DEFAULT_UI_PREFERENCES);
  return { preferences, updatePreferences: updateUiPreferences, resetPreferences: resetUiPreferences };
}

if (typeof window !== 'undefined') {
  apply(snapshot);
  syncLegacyPreferences(snapshot);
}
