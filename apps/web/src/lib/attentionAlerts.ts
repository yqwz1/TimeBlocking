export type AttentionAlertKind = 'reminder' | 'focus';

export interface AttentionAlert {
  id: string;
  kind: AttentionAlertKind;
  title: string;
  body: string;
  link: string;
  createdAt: number;
  snoozedUntil?: number;
}

const STORAGE_KEY = 'tb.attention-alerts';
let alerts: AttentionAlert[] = load();
let wakeTimer: number | null = null;
const listeners = new Set<() => void>();

function load(): AttentionAlert[] {
  if (typeof window === 'undefined') return [];
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(value)
      ? value.filter((item): item is AttentionAlert => !!item && typeof item.id === 'string' && typeof item.title === 'string' && typeof item.link === 'string')
      : [];
  } catch {
    return [];
  }
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(alerts));
}

function scheduleWake() {
  if (wakeTimer != null) window.clearTimeout(wakeTimer);
  const next = alerts.reduce<number | null>((earliest, alert) => {
    if (!alert.snoozedUntil || alert.snoozedUntil <= Date.now()) return earliest;
    return earliest == null ? alert.snoozedUntil : Math.min(earliest, alert.snoozedUntil);
  }, null);
  wakeTimer = next == null ? null : window.setTimeout(() => emit(), Math.max(0, next - Date.now()) + 20);
}

function emit() {
  persist();
  scheduleWake();
  listeners.forEach((listener) => listener());
}

export function getAttentionAlerts() {
  return alerts;
}

export function getActiveAttentionAlert() {
  const now = Date.now();
  return alerts.find((alert) => !alert.snoozedUntil || alert.snoozedUntil <= now) ?? null;
}

export function subscribeAttentionAlerts(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function enqueueAttentionAlert(input: Omit<AttentionAlert, 'createdAt'> & { createdAt?: number }) {
  if (alerts.some((alert) => alert.id === input.id)) return;
  alerts = [...alerts, { ...input, createdAt: input.createdAt ?? Date.now() }];
  emit();
}

export function acknowledgeAttentionAlert(id: string) {
  alerts = alerts.filter((alert) => alert.id !== id);
  emit();
}

export function snoozeAttentionAlert(id: string, minutes: number) {
  alerts = alerts.map((alert) => (alert.id === id ? { ...alert, snoozedUntil: Date.now() + minutes * 60_000 } : alert));
  emit();
}
