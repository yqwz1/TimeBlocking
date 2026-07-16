import type { ReactNode } from 'react';
import type { TodayPlanDTO } from '@timeblock/shared';
import { fmtDur } from './format.js';

function Tile({ label, value, accent, children }: { label: string; value: string; accent: string; children?: ReactNode }) {
  return (
    <div className="g-card flex flex-col justify-between p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--g-text-faint)]">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums" style={{ color: accent }}>
        {value}
      </p>
      {children}
    </div>
  );
}

export default function StatTiles({ plan }: { plan: TodayPlanDTO }) {
  const now = Date.now();
  const done = plan.blocks.filter((b) => b.status === 'done').length;
  const missed = plan.blocks.filter((b) => b.status === 'missed').length + plan.missedYesterday.length + plan.missedToday.length;
  const blocksLeft = plan.blocks.filter((b) => b.status !== 'done' && b.status !== 'missed' && Date.parse(b.start) >= now).length;
  const freeMin = Math.max(0, plan.capacityMin - plan.plannedMin);
  const pct = plan.capacityMin > 0 ? Math.min(100, Math.round((plan.plannedMin / plan.capacityMin) * 100)) : 0;

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <Tile label="Done" value={String(done)} accent="var(--g-emerald)" />
      <Tile label="Missed" value={String(missed)} accent={missed > 0 ? 'var(--g-rose)' : 'var(--g-text-dim)'} />
      <Tile label="Blocks left" value={String(blocksLeft)} accent="var(--g-cyan)" />
      <div className="g-card col-span-2 flex flex-col justify-between p-4 sm:col-span-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--g-text-faint)]">Planned / free</p>
        <p className="mt-1 text-sm font-semibold tabular-nums text-[var(--g-text)]">
          {fmtDur(plan.plannedMin)} <span className="font-normal text-[var(--g-text-faint)]">/ {plan.capacityMin > 0 ? `${fmtDur(freeMin)} free` : 'day over'}</span>
        </p>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--g-surface-2)]">
          <div
            className="h-full rounded-full transition-[width] duration-500"
            style={{
              width: `${pct}%`,
              background: plan.overloaded ? 'var(--g-rose)' : 'linear-gradient(90deg, var(--g-xp-a), var(--g-cyan))',
            }}
          />
        </div>
      </div>
    </div>
  );
}
