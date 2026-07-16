import { Star } from 'lucide-react';

const SIZES = { sm: 'h-4 w-4', md: 'h-5 w-5', lg: 'h-6 w-6' } as const;

/** Small 1..5 star picker. value = null means unrated. Read-only when onChange is omitted. */
export default function StarRating({
  value,
  onChange,
  size = 'md',
}: {
  value: number | null;
  onChange?: (v: number) => void;
  size?: keyof typeof SIZES;
}) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = value != null && n <= value;
        const cls = `${SIZES[size]} ${filled ? 'text-amber-400' : 'text-slate-500/50'}`;
        return onChange ? (
          <button key={n} type="button" onClick={() => onChange(n)} title={`${n} / 5`} className="transition-transform hover:scale-110">
            <Star className={cls} fill={filled ? 'currentColor' : 'none'} />
          </button>
        ) : (
          <Star key={n} className={cls} fill={filled ? 'currentColor' : 'none'} />
        );
      })}
    </div>
  );
}
