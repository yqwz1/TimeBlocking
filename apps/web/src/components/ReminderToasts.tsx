import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Bell } from 'lucide-react';
import type { ReminderFiredEventDTO } from '@timeblock/shared';
import { Link } from 'react-router-dom';
import { REMINDER_FIRED_EVENT } from '../hooks.js';
import { toast as toastVariants } from '../lib/motion.js';
import { addNotification } from '../lib/notifications.js';
import { playNotificationPing } from '../lib/sound.js';

let notificationRequested = false;

export default function ReminderToasts() {
  const [toasts, setToasts] = useState<ReminderFiredEventDTO[]>([]);

  useEffect(() => {
    const handler = (ev: Event) => {
      const dto = (ev as CustomEvent<ReminderFiredEventDTO>).detail;
      setToasts((t) => [...t, dto]);
      playNotificationPing();
      addNotification({
        id: dto.reminderId,
        kind: 'reminder',
        title: dto.taskContent,
        body: dto.message || 'Reminder',
        link: `/tasks?task=${dto.taskId}`,
      });

      if (!notificationRequested) {
        notificationRequested = true;
        if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission();
      }
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(dto.taskContent, { body: dto.message || 'Reminder', tag: dto.reminderId });
      }
    };
    window.addEventListener(REMINDER_FIRED_EVENT, handler);
    return () => window.removeEventListener(REMINDER_FIRED_EVENT, handler);
  }, []);

  useEffect(() => {
    if (!toasts.length) return;
    const timer = setTimeout(() => setToasts((t) => t.slice(1)), 6000);
    return () => clearTimeout(timer);
  }, [toasts]);

  if (!toasts.length) return null;

  return (
    <div className="fixed bottom-4 left-4 z-50 flex flex-col gap-2">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.reminderId}
            layout
            variants={toastVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="flex max-w-xs items-start gap-2 rounded-xl border border-teal-200 bg-white px-4 py-2.5 shadow-lg dark:border-teal-500/40 dark:bg-neutral-900"
          >
            <Bell size={16} className="mt-0.5 shrink-0 text-teal-500" />
            <div className="min-w-0">
              <Link to={`/tasks?task=${t.taskId}`} className="block truncate text-sm font-medium text-slate-800 hover:underline dark:text-neutral-100">
                {t.taskContent}
              </Link>
              {t.message && <p className="truncate text-xs text-slate-400 dark:text-neutral-500">{t.message}</p>}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
