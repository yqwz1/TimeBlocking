// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

async function subject() {
  vi.resetModules();
  return import('./attentionAlerts.js');
}

describe('attention alerts', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-08T12:00:00Z'));
  });

  it('keeps FIFO order and ignores duplicate deliveries', async () => {
    const alerts = await subject();
    alerts.enqueueAttentionAlert({ id: 'one', kind: 'reminder', title: 'One', body: '', link: '/tasks' });
    alerts.enqueueAttentionAlert({ id: 'two', kind: 'focus', title: 'Two', body: '', link: '/tasks?view=focus' });
    alerts.enqueueAttentionAlert({ id: 'one', kind: 'reminder', title: 'Duplicate', body: '', link: '/tasks' });
    expect(alerts.getAttentionAlerts().map((alert) => alert.id)).toEqual(['one', 'two']);
    expect(alerts.getActiveAttentionAlert()?.id).toBe('one');
  });

  it('persists a snooze and restores it after the due time', async () => {
    const alerts = await subject();
    alerts.enqueueAttentionAlert({ id: 'one', kind: 'reminder', title: 'One', body: '', link: '/tasks' });
    alerts.snoozeAttentionAlert('one', 10);
    expect(alerts.getActiveAttentionAlert()).toBeNull();
    vi.advanceTimersByTime(10 * 60_000 + 25);
    expect(alerts.getActiveAttentionAlert()?.id).toBe('one');
    expect(JSON.parse(localStorage.getItem('tb.attention-alerts') ?? '[]')).toHaveLength(1);
  });

  it('removes an acknowledgement completely', async () => {
    const alerts = await subject();
    alerts.enqueueAttentionAlert({ id: 'one', kind: 'reminder', title: 'One', body: '', link: '/tasks' });
    alerts.acknowledgeAttentionAlert('one');
    expect(alerts.getAttentionAlerts()).toEqual([]);
  });
});
