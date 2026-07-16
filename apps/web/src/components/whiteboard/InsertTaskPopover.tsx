import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ClipboardList } from 'lucide-react';
import type { TaskDTO } from '@timeblock/shared';
import { useTaskList } from '../../hooks.js';
import { popoverVariants } from '../../lib/motion.js';
import { STATUS_DOT } from '../tasks/taskDisplay.js';

export default function InsertTaskPopover({ onInsert }: { onInsert: (task: TaskDTO) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const { data: results } = useTaskList({ q: query || undefined, includeClosed: false });

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const candidates = (results ?? []).slice(0, 8);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Insert a linked task card"
        className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 shadow-sm hover:bg-slate-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700/60"
      >
        <ClipboardList size={13} className="text-teal-500" />
        Task
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            variants={popoverVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            style={{ transformOrigin: 'top right' }}
            className="absolute right-0 z-30 mt-1.5 w-72 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-neutral-800 dark:bg-neutral-900"
          >
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search tasks…"
              className="w-full border-b border-slate-100 px-3 py-2 text-sm outline-none dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
            />
            <ul className="max-h-64 overflow-y-auto py-1">
              {candidates.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onInsert(t);
                      setOpen(false);
                      setQuery('');
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50 dark:text-neutral-200 dark:hover:bg-white/5"
                  >
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[t.status]}`} />
                    <span className="truncate">{t.content}</span>
                  </button>
                </li>
              ))}
              {candidates.length === 0 && <li className="px-3 py-2 text-xs text-slate-400 dark:text-neutral-500">No matching tasks</li>}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
