import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, ChevronDown } from 'lucide-react';
import { popoverVariants } from '../../lib/motion.js';

export interface FilterOption<T extends string | number> {
  value: T;
  label: string;
  /** Tailwind classes for a small solid dot rendered before the label (e.g. status color). */
  dotClassName?: string;
  /** Tailwind classes for a badge chip rendered instead of a dot (e.g. priority). */
  badgeClassName?: string;
}

export default function FilterDropdown<T extends string | number>({
  label,
  icon,
  value,
  options,
  onChange,
  align = 'left',
}: {
  label: string;
  icon: React.ReactNode;
  value: T | null;
  options: FilterOption<T>[];
  onChange: (value: T | null) => void;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const active = options.find((o) => o.value === value) ?? null;

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

  return (
    <div ref={rootRef} className="relative">
      <motion.button
        type="button"
        whileTap={{ scale: 0.97 }}
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs font-medium transition-colors ${
          active
            ? 'border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-500/30 dark:bg-teal-500/10 dark:text-teal-300'
            : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700/60'
        }`}
      >
        <span className={active ? 'text-teal-500 dark:text-teal-400' : 'text-slate-400 dark:text-neutral-500'}>{icon}</span>
        {active ? active.label : label}
        <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''} ${active ? 'text-teal-400' : 'text-slate-400 dark:text-neutral-500'}`} />
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            variants={popoverVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            style={{ transformOrigin: 'top left' }}
            className={`absolute z-30 mt-1.5 min-w-[170px] overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl dark:border-neutral-800 dark:bg-neutral-900 ${
              align === 'right' ? 'right-0' : 'left-0'
            }`}
          >
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
              className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs text-slate-500 hover:bg-slate-50 dark:text-neutral-400 dark:hover:bg-white/5"
            >
              {label}
              {value === null && <Check size={13} className="text-teal-500" />}
            </button>
            <div className="my-1 h-px bg-slate-100 dark:bg-neutral-800" />
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50 dark:text-neutral-200 dark:hover:bg-white/5"
              >
                <span className="flex items-center gap-2">
                  {o.dotClassName && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${o.dotClassName}`} />}
                  {o.badgeClassName ? (
                    <span className={`rounded px-1 py-0.5 text-[9px] font-bold ${o.badgeClassName}`}>{o.label}</span>
                  ) : (
                    <span>{o.label}</span>
                  )}
                </span>
                {value === o.value && <Check size={13} className="shrink-0 text-teal-500" />}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
