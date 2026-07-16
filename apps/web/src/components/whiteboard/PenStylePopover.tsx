import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { PenTool } from 'lucide-react';
import { popoverVariants } from '../../lib/motion.js';

export type PenPreset = { id: string; label: string; strokeWidth: number; opacity: number };

const PRESETS: PenPreset[] = [
  { id: 'fine', label: 'Fine liner', strokeWidth: 1, opacity: 100 },
  { id: 'pen', label: 'Pen', strokeWidth: 3, opacity: 100 },
  { id: 'marker', label: 'Marker', strokeWidth: 6, opacity: 100 },
  { id: 'highlighter', label: 'Highlighter', strokeWidth: 16, opacity: 40 },
];

export default function PenStylePopover({
  strokeColor,
  onApply,
}: {
  strokeColor: string;
  onApply: (preset: PenPreset) => void;
}) {
  const [open, setOpen] = useState(false);
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
        title="Pen style presets"
        className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 shadow-sm hover:bg-slate-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700/60"
      >
        <PenTool size={13} className="text-teal-500" />
        Pen
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            variants={popoverVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            style={{ transformOrigin: 'top right' }}
            className="absolute right-0 z-30 mt-1.5 w-44 space-y-1 overflow-hidden rounded-xl border border-slate-200 bg-white p-2 shadow-xl dark:border-neutral-800 dark:bg-neutral-900"
          >
            {PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => {
                  onApply(preset);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-xs text-slate-600 hover:bg-slate-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                <span
                  className="h-0 w-6 shrink-0 rounded-full"
                  style={{
                    borderTopWidth: Math.min(preset.strokeWidth, 8),
                    borderTopColor: strokeColor,
                    borderTopStyle: 'solid',
                    opacity: preset.opacity / 100,
                  }}
                />
                {preset.label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
