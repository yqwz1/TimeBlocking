import type { ReactNode } from 'react';

export function SectionCard({ title, badge, children }: { title: string; badge?: ReactNode; children: ReactNode }) {
  return (
    <section className="g-card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--g-text-dim)]">{title}</h3>
        {badge}
      </div>
      {children}
    </section>
  );
}

export function KindIcon({ kind, className = '' }: { kind: 'task' | 'habit' | 'external' | 'event'; className?: string }) {
  if (kind === 'habit')
    return (
      <svg viewBox="0 0 16 16" fill="none" className={`h-3.5 w-3.5 ${className}`} aria-hidden>
        <path
          d="M13.5 8a5.5 5.5 0 1 1-1.61-3.89M13.5 2.5v2.6h-2.6"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  if (kind === 'external' || kind === 'event')
    return (
      <svg viewBox="0 0 16 16" fill="none" className={`h-3.5 w-3.5 ${className}`} aria-hidden>
        <rect x="2" y="3" width="12" height="11" rx="2" stroke="currentColor" strokeWidth="1.5" />
        <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  return (
    <svg viewBox="0 0 16 16" fill="none" className={`h-3.5 w-3.5 ${className}`} aria-hidden>
      <path d="M3 8.5 6.5 12 13 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
