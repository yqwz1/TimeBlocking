import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Bell, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  clearNotifications,
  getNotifications,
  getUnreadCount,
  markAllNotificationsRead,
  subscribeNotifications,
  type AppNotification,
} from '../lib/notifications.js';

const KIND_ICON: Record<AppNotification['kind'], string> = {
  reminder: '🔔',
  achievement: '🏅',
  levelup: '⬆️',
};

function timeAgo(at: number): string {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/** Header bell: unread badge + dropdown inbox of reminders and gamification events. */
export default function NotificationCenter({ gameMode }: { gameMode: boolean }) {
  const notifications = useSyncExternalStore(subscribeNotifications, getNotifications);
  const unread = useSyncExternalStore(subscribeNotifications, getUnreadCount);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Opening the panel counts as seeing everything in it.
  useEffect(() => {
    if (open) markAllNotificationsRead();
  }, [open, notifications]);

  return (
    <div ref={rootRef} className="relative">
      <motion.button
        type="button"
        whileTap={{ scale: 0.88 }}
        onClick={() => setOpen((v) => !v)}
        title="Notifications"
        aria-label={unread ? `Notifications (${unread} unread)` : 'Notifications'}
        className={`relative rounded-md px-2 py-1.5 text-sm ${
          gameMode ? 'text-slate-300 hover:bg-white/5' : 'text-slate-600 hover:bg-slate-100 dark:text-neutral-300 dark:hover:bg-white/5'
        }`}
      >
        <Bell size={16} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-teal-500 px-1 text-[10px] font-semibold leading-none text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </motion.button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-neutral-800 dark:bg-neutral-900"
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2 dark:border-neutral-800">
              <span className="text-sm font-semibold text-slate-800 dark:text-neutral-100">Notifications</span>
              {notifications.length > 0 && (
                <button
                  type="button"
                  onClick={clearNotifications}
                  title="Clear all"
                  className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-slate-400 hover:bg-slate-50 hover:text-slate-600 dark:text-neutral-500 dark:hover:bg-white/5 dark:hover:text-neutral-300"
                >
                  <Trash2 size={12} /> Clear
                </button>
              )}
            </div>
            <div className="max-h-96 overflow-y-auto">
              {notifications.length === 0 ? (
                <p className="px-3 py-8 text-center text-sm text-slate-400 dark:text-neutral-500">
                  Nothing yet — reminders and achievements land here.
                </p>
              ) : (
                notifications.map((n) => {
                  const inner = (
                    <div className="flex items-start gap-2.5 px-3 py-2.5">
                      <span className="mt-0.5 text-base leading-none">{KIND_ICON[n.kind]}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-800 dark:text-neutral-100">{n.title}</p>
                        {n.body && <p className="truncate text-xs text-slate-400 dark:text-neutral-500">{n.body}</p>}
                        <p className="mt-0.5 text-[11px] text-slate-300 dark:text-neutral-600">{timeAgo(n.at)}</p>
                      </div>
                      {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-teal-500" />}
                    </div>
                  );
                  const rowClass = 'block border-b border-slate-50 last:border-0 hover:bg-slate-50 dark:border-neutral-800/60 dark:hover:bg-white/5';
                  return n.link ? (
                    <Link key={n.id} to={n.link} onClick={() => setOpen(false)} className={rowClass}>
                      {inner}
                    </Link>
                  ) : (
                    <div key={n.id} className={rowClass}>
                      {inner}
                    </div>
                  );
                })
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
