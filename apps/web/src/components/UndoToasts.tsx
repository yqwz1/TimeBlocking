import { AnimatePresence, motion } from 'motion/react';
import { RotateCcw, X } from 'lucide-react';
import { actionToasts, useActionToasts } from '../lib/actionToast.js';
import { springs } from '../lib/motion.js';

const slideFromLeft = {
  initial: { opacity: 0, x: -24, scale: 0.96 },
  animate: { opacity: 1, x: 0, scale: 1, transition: springs.snappy },
  exit: { opacity: 0, x: -16, scale: 0.96, transition: { duration: 0.15 } },
};

/** Bottom-left "you just did X — Undo?" toasts. Mounted once at the app root. */
export default function UndoToasts() {
  const toasts = useActionToasts();
  if (!toasts.length) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 left-4 z-50 flex flex-col gap-2">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            variants={slideFromLeft}
            initial="initial"
            animate="animate"
            exit="exit"
            className="pointer-events-auto flex items-center gap-3 rounded-xl border border-slate-200 bg-white py-2 pl-4 pr-2 shadow-lg dark:border-neutral-800 dark:bg-neutral-900"
          >
            <span className="text-sm font-medium text-slate-800 dark:text-neutral-100">{t.message}</span>
            <motion.button
              type="button"
              whileTap={{ scale: 0.94 }}
              onClick={() => void actionToasts.run(t.id)}
              className="flex items-center gap-1.5 rounded-lg bg-teal-600 px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-teal-500"
            >
              <RotateCcw size={13} strokeWidth={2.5} />
              {t.actionLabel ?? 'Undo'}
            </motion.button>
            <button
              type="button"
              onClick={() => actionToasts.dismiss(t.id)}
              aria-label="Dismiss"
              className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
            >
              <X size={14} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
