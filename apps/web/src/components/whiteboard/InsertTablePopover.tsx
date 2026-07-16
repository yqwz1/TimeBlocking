import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Table2 } from 'lucide-react';
import { popoverVariants } from '../../lib/motion.js';

export default function InsertTablePopover({ onInsert }: { onInsert: (rows: number, cols: number) => void }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(3);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Insert a table"
        className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 shadow-sm hover:bg-slate-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700/60"
      >
        <Table2 size={13} className="text-teal-500" />
        Table
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            variants={popoverVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            style={{ transformOrigin: 'top right' }}
            className="absolute right-0 z-30 mt-1.5 w-52 space-y-2 overflow-hidden rounded-xl border border-slate-200 bg-white p-3 shadow-xl dark:border-neutral-800 dark:bg-neutral-900"
          >
            <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-neutral-300">
              <label className="flex flex-1 items-center gap-1.5">
                Rows
                <input
                  type="number"
                  min={1}
                  max={12}
                  value={rows}
                  onChange={(e) => setRows(Math.min(12, Math.max(1, Number(e.target.value) || 1)))}
                  className="w-14 rounded-md border border-slate-300 px-1.5 py-1 dark:border-neutral-700 dark:bg-neutral-800"
                />
              </label>
              <label className="flex flex-1 items-center gap-1.5">
                Cols
                <input
                  type="number"
                  min={1}
                  max={12}
                  value={cols}
                  onChange={(e) => setCols(Math.min(12, Math.max(1, Number(e.target.value) || 1)))}
                  className="w-14 rounded-md border border-slate-300 px-1.5 py-1 dark:border-neutral-700 dark:bg-neutral-800"
                />
              </label>
            </div>
            <button
              type="button"
              onClick={() => {
                onInsert(rows, cols);
                setOpen(false);
              }}
              className="w-full rounded-md bg-teal-600 px-2 py-1.5 text-xs font-medium text-white hover:bg-teal-700"
            >
              Insert
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
