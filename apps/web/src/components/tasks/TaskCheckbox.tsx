import { Check } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

export default function TaskCheckbox({
  checked,
  onChange,
  size = 18,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  size?: number;
  label?: string;
}) {
  return (
    <motion.button
      type="button"
      onClick={onChange}
      aria-pressed={checked}
      aria-label={label ?? (checked ? 'Mark as not done' : 'Mark as done')}
      style={{ height: size, width: size }}
      whileTap={{ scale: 0.82 }}
      // A little overshoot when it flips to done makes completion feel rewarding.
      animate={{ scale: checked ? [1, 1.28, 1] : 1 }}
      transition={{ duration: 0.32, ease: 'easeOut' }}
      className={`relative flex shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
        checked
          ? 'border-teal-600 bg-teal-600'
          : 'border-slate-300 hover:border-teal-400 dark:border-neutral-600 dark:hover:border-teal-400'
      }`}
    >
      {/* radiating ring burst on completion */}
      <AnimatePresence>
        {checked && (
          <motion.span
            key="burst"
            aria-hidden
            initial={{ scale: 0.5, opacity: 0.55 }}
            animate={{ scale: 2.1, opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
            className="pointer-events-none absolute inset-0 rounded-full border-2 border-teal-500"
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {checked && (
          <motion.span
            key="check"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 650, damping: 18 }}
            className="flex items-center justify-center"
          >
            <Check size={Math.round(size * 0.65)} strokeWidth={3} className="text-white" />
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
}
