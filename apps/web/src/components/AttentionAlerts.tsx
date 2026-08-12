import { useEffect, useRef, useSyncExternalStore } from 'react';
import { BellRing, ChevronDown, ExternalLink, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { ReminderFiredEventDTO } from '@timeblock/shared';
import { REMINDER_FIRED_EVENT } from '../hooks.js';
import { FOCUS_TIMER_FINISHED_EVENT } from '../lib/focusTimer.js';
import {
  acknowledgeAttentionAlert,
  enqueueAttentionAlert,
  getActiveAttentionAlert,
  getAttentionAlerts,
  snoozeAttentionAlert,
  subscribeAttentionAlerts,
} from '../lib/attentionAlerts.js';
import { getUiPreferences, useUiPreferences } from '../lib/uiPreferences.js';
import { playReminderAlarm } from '../lib/sound.js';
import { addNotification } from '../lib/notifications.js';

function alertFromReminder(dto: ReminderFiredEventDTO) {
  const sourceType = dto.sourceType ?? (dto.reminderId.startsWith('event:') ? 'event' : 'task');
  return {
    id: dto.reminderId,
    kind: 'reminder' as const,
    title: dto.taskContent,
    body: dto.message || 'Reminder',
    link: sourceType === 'event' ? '/tasks?view=calendar' : `/tasks?task=${dto.sourceId ?? dto.taskId}`,
  };
}

/** Persistent, escalating alarm surface for reminders and focus timer completions. */
export default function AttentionAlerts() {
  const navigate = useNavigate();
  const { preferences } = useUiPreferences();
  const alerts = useSyncExternalStore(subscribeAttentionAlerts, getAttentionAlerts, () => []);
  const active = getActiveAttentionAlert();
  const primaryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onReminder = (event: Event) => {
      const dto = (event as CustomEvent<ReminderFiredEventDTO>).detail;
      const alert = alertFromReminder(dto);
      enqueueAttentionAlert(alert);
      addNotification({ id: alert.id, kind: 'reminder', title: alert.title, body: alert.body, link: alert.link });
    };
    const onFocusFinished = (event: Event) => {
      const detail = (event as CustomEvent<{ id: string; title: string; body: string }>).detail;
      enqueueAttentionAlert({ ...detail, kind: 'focus', link: '/tasks?view=focus' });
    };
    window.addEventListener(REMINDER_FIRED_EVENT, onReminder);
    window.addEventListener(FOCUS_TIMER_FINISHED_EVENT, onFocusFinished);
    return () => {
      window.removeEventListener(REMINDER_FIRED_EVENT, onReminder);
      window.removeEventListener(FOCUS_TIMER_FINISHED_EVENT, onFocusFinished);
    };
  }, []);

  useEffect(() => window.desktop?.onAttentionOpen(() => primaryRef.current?.focus()), []);

  useEffect(() => {
    if (!active) return;
    primaryRef.current?.focus();
    let browserNotification: Notification | null = null;
    let stopAudio = () => {};
    const ring = () => {
      stopAudio();
      if (getUiPreferences().alarmSoundEnabled) stopAudio = playReminderAlarm(getUiPreferences().alarmVolume);
    };
    ring();
    if (window.desktop) {
      void window.desktop.showAttention({ id: active.id, title: active.title, body: active.body });
    } else if ('Notification' in window && Notification.permission === 'granted') {
      try {
        browserNotification = new Notification(active.title, { body: active.body, tag: active.id, requireInteraction: true });
        browserNotification.onclick = () => {
          window.focus();
          primaryRef.current?.focus();
        };
      } catch { /* browser notification support is best effort */ }
    }
    const escalation = window.setInterval(() => {
      ring();
      if (window.desktop) void window.desktop.escalateAttention();
    }, 30_000);
    return () => {
      window.clearInterval(escalation);
      stopAudio();
      browserNotification?.close();
      void window.desktop?.clearAttention(active.id);
    };
  }, [active?.id]);

  if (!active) return null;
  const queueCount = alerts.filter((alert) => alert.id !== active.id).length;
  const open = () => {
    acknowledgeAttentionAlert(active.id);
    navigate(active.link);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm" role="presentation">
      <section role="alertdialog" aria-modal="true" aria-labelledby="attention-alert-title" aria-describedby="attention-alert-body" className="w-full max-w-xl overflow-hidden rounded-2xl border-2 border-amber-400 bg-[#10151b] text-white shadow-[0_0_0_1px_rgba(251,191,36,.25),0_28px_100px_rgba(0,0,0,.7)]">
        <div className="flex items-center gap-3 border-b border-amber-400/35 bg-amber-400 px-5 py-3 text-slate-950">
          <BellRing size={24} strokeWidth={2.7} aria-hidden="true" />
          <p className="text-sm font-black uppercase tracking-[0.2em]">Attention required</p>
          {queueCount > 0 && <span className="ml-auto rounded-full bg-slate-950 px-2.5 py-1 text-xs font-bold text-amber-300">+{queueCount} queued</span>}
        </div>
        <div className="p-6 sm:p-8">
          <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-amber-300">{active.kind === 'focus' ? 'Timer complete' : 'Scheduled reminder'}</p>
          <h2 id="attention-alert-title" className="text-3xl font-black tracking-tight text-white sm:text-4xl">{active.title}</h2>
          <p id="attention-alert-body" className="mt-3 text-base leading-7 text-slate-300">{active.body}</p>
          <p className="mt-5 text-sm font-medium text-amber-200">This alarm will repeat every 30 seconds until you respond.</p>
          <div className="mt-7 grid gap-3 sm:grid-cols-[1fr_auto]">
            <button ref={primaryRef} type="button" onClick={open} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-amber-400 px-5 py-3 text-base font-extrabold text-slate-950 transition hover:bg-amber-300 focus:outline-none focus:ring-4 focus:ring-amber-200/40">
              <ExternalLink size={18} /> {active.kind === 'focus' ? 'Open Focus' : active.link.includes('calendar') ? 'Open calendar' : 'Open task'}
            </button>
            <div className="grid grid-cols-2 gap-2">
              {[5, 10, 30, 60].map((minutes) => <button key={minutes} type="button" onClick={() => snoozeAttentionAlert(active.id, minutes)} className="min-h-12 rounded-xl border border-slate-600 px-3 text-sm font-bold text-slate-100 transition hover:border-amber-300 hover:bg-slate-800">{minutes}m</button>)}
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400"><ChevronDown size={14} /> Snooze</span>
            <button type="button" onClick={() => acknowledgeAttentionAlert(active.id)} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-slate-300 hover:bg-white/10 hover:text-white"><X size={16} /> Dismiss</button>
          </div>
        </div>
      </section>
    </div>
  );
}
