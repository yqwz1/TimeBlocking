import { useState, type ReactNode } from 'react';
import { ChevronDown, type LucideIcon } from 'lucide-react';

type Accent = 'teal' | 'indigo' | 'amber' | 'slate';

const ACCENT: Record<Accent, string> = {
  teal: 'bg-teal-50 text-teal-600 dark:bg-teal-500/15 dark:text-teal-300',
  indigo: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300',
  amber: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300',
  slate: 'bg-slate-100 text-slate-500 dark:bg-neutral-800 dark:text-neutral-400',
};

/**
 * A rail section rendered as a self-contained card with an iconed header.
 * Cards + inter-card spacing give each panel room to breathe instead of the
 * old hairline-divider stack.
 */
export default function CollapsibleSection({
  title,
  icon: Icon,
  accent = 'slate',
  right,
  defaultOpen = true,
  children,
}: {
  title: string;
  icon?: LucideIcon;
  accent?: Accent;
  right?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 px-3.5 py-3 text-left transition hover:bg-slate-50/60 dark:hover:bg-white/[0.02]"
        aria-expanded={open}
      >
        {Icon && (
          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${ACCENT[accent]}`}>
            <Icon size={15} strokeWidth={2.25} />
          </span>
        )}
        <span className="flex-1 truncate text-[13px] font-semibold text-slate-700 dark:text-neutral-200">{title}</span>
        {right}
        <ChevronDown
          size={16}
          className={`shrink-0 text-slate-400 transition-transform dark:text-neutral-500 ${open ? '' : '-rotate-90'}`}
        />
      </button>
      {open && <div className="px-3.5 pb-4 pt-0.5">{children}</div>}
    </section>
  );
}
