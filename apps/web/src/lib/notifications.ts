/**
 * In-app notification inbox backing the header bell. Reminders and gamification
 * events already surface as transient toasts; this store keeps them around so a
 * missed toast can still be seen later. Persisted to localStorage, capped.
 */

import { getUiPreferences } from './uiPreferences.js';

export type NotificationKind = 'reminder' | 'achievement' | 'levelup';

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  body?: string;
  /** In-app route to open when clicked, e.g. `/tasks?task=...`. */
  link?: string;
  /** Epoch ms. */
  at: number;
  read: boolean;
}

const STORAGE_KEY = 'tb:notifications';
const maxKept = () => getUiPreferences().notificationRetention;

type Listener = () => void;
const listeners = new Set<Listener>();

function load(): AppNotification[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    if (Array.isArray(raw)) return raw.filter((n) => n && typeof n.id === 'string').slice(0, maxKept());
  } catch {
    /* corrupted — start fresh */
  }
  return [];
}

let items: AppNotification[] = typeof window !== 'undefined' ? load() : [];

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    /* storage full/unavailable — inbox still works in-memory */
  }
}

function emit() {
  persist();
  listeners.forEach((fn) => fn());
}

export function subscribeNotifications(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getNotifications(): AppNotification[] {
  return items;
}

export function getUnreadCount(): number {
  return items.reduce((n, item) => n + (item.read ? 0 : 1), 0);
}

export function addNotification(input: Omit<AppNotification, 'at' | 'read'>) {
  // Re-fired reminders reuse their id — replace instead of duplicating.
  items = [{ ...input, at: Date.now(), read: false }, ...items.filter((n) => n.id !== input.id)].slice(0, maxKept());
  emit();
}

export function markAllNotificationsRead() {
  if (!items.some((n) => !n.read)) return;
  items = items.map((n) => (n.read ? n : { ...n, read: true }));
  emit();
}

export function clearNotifications() {
  if (!items.length) return;
  items = [];
  emit();
}
