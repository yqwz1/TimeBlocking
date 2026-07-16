import type { TodayPlanDTO } from '@timeblock/shared';
import { Flame, RefreshCw, Snowflake, Zap } from 'lucide-react';
import { useBuyFreeze, useDemoStatus, useGamificationSummary, useManualSync, useResetDemo, useSeedDemo, useSettings } from '../../hooks.js';
import { greeting } from './format.js';

function LevelRing({ level, pct }: { level: number; pct: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - pct / 100);
  return (
    <div className="relative h-16 w-16 shrink-0">
      <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90 tb-glow rounded-full">
        <circle cx="32" cy="32" r={r} fill="none" stroke="var(--g-surface-2)" strokeWidth="6" />
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          stroke="url(#g-level-grad)"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 600ms ease' }}
        />
        <defs>
          <linearGradient id="g-level-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--g-xp-a)" />
            <stop offset="100%" stopColor="var(--g-xp-b)" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-lg font-bold leading-none text-[var(--g-text)]">{level}</span>
        <span className="text-[9px] uppercase tracking-wide text-[var(--g-text-faint)]">lvl</span>
      </div>
    </div>
  );
}

export default function HudHeader({ plan }: { plan: TodayPlanDTO }) {
  const { data: settings } = useSettings();
  const { data: summary } = useGamificationSummary();
  const buyFreeze = useBuyFreeze();
  const manualSync = useManualSync();
  const { data: demoStatus } = useDemoStatus();
  const seedDemo = useSeedDemo();
  const resetDemo = useResetDemo();

  const now = new Date();
  const dateLabel = new Date(plan.date + 'T00:00:00').toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  const gamificationOn = !!settings?.gamificationEnabled && !!summary?.enabled;
  const pct = gamificationOn && summary!.xpForNextLevel > 0 ? Math.min(100, Math.round((summary!.xpIntoLevel / summary!.xpForNextLevel) * 100)) : 0;
  const canBuyFreeze = gamificationOn && summary!.streak.freezes < 3 && summary!.totalXp >= 300;

  return (
    <section className="g-card p-6">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-0">
          <p className="text-sm font-medium text-teal-400">{greeting(now)}</p>
          <h2 className="mt-0.5 text-2xl font-bold tracking-tight text-[var(--g-text)]">{dateLabel}</h2>
          {plan.overloaded && (
            <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-rose-500/15 px-3 py-1 text-xs font-semibold text-rose-300">
              <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />
              Overloaded
            </span>
          )}
        </div>

        {gamificationOn && (
          <div className="flex flex-wrap items-center gap-5">
            <LevelRing level={summary!.level} pct={pct} />

            <div className="w-40">
              <div className="tb-xpbar h-2.5 w-full overflow-hidden rounded-full bg-[var(--g-surface-2)]">
                <div
                  className="h-full rounded-full transition-[width] duration-500"
                  style={{ width: `${pct}%`, background: 'linear-gradient(90deg, var(--g-xp-a), var(--g-xp-b))' }}
                />
              </div>
              <p className="mt-1 text-[11px] text-[var(--g-text-faint)]">
                {summary!.xpIntoLevel} / {summary!.xpForNextLevel} XP · {summary!.totalXp} total
              </p>
            </div>

            <div className="flex items-center gap-1.5">
              <Flame
                className={`tb-flame h-5 w-5 ${summary!.streak.todayMet ? 'text-orange-400' : 'text-slate-600'}`}
                fill={summary!.streak.todayMet ? 'currentColor' : 'none'}
              />
              <span className="text-lg font-bold text-[var(--g-text)]">{summary!.streak.current}</span>
              <span className="text-xs text-[var(--g-text-faint)]">day streak</span>
              {summary!.streak.longest > summary!.streak.current && (
                <span className="text-[10px] text-[var(--g-text-faint)]">(best {summary!.streak.longest})</span>
              )}
            </div>

            <div className="flex items-center gap-1">
              {Array.from({ length: 3 }, (_, i) => (
                <Snowflake key={i} className={`h-4 w-4 ${i < summary!.streak.freezes ? 'text-cyan-300' : 'text-slate-700'}`} />
              ))}
              {canBuyFreeze && (
                <button
                  onClick={() => buyFreeze.mutate()}
                  disabled={buyFreeze.isPending}
                  title="Spend 300 XP for a streak freeze"
                  className="ml-1 flex items-center gap-1 rounded-full border border-[var(--g-border)] bg-[var(--g-surface-2)] px-2 py-0.5 text-[10px] font-medium text-[var(--g-text-dim)] hover:border-cyan-400/50 hover:text-cyan-300 disabled:opacity-50"
                >
                  <Zap className="h-2.5 w-2.5" /> 300 XP
                </button>
              )}
            </div>
          </div>
        )}

        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={() => manualSync.mutate()}
            disabled={manualSync.isPending}
            title="Sync now"
            className="flex items-center gap-1.5 rounded-lg border border-[var(--g-border)] bg-[var(--g-surface-2)] px-2.5 py-1.5 text-xs font-medium text-[var(--g-text-dim)] hover:text-[var(--g-text)] disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${manualSync.isPending ? 'animate-spin' : ''}`} />
            Sync
          </button>
          {import.meta.env.DEV && demoStatus?.available && (
            <>
              {demoStatus.active ? (
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-teal-500/15 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-teal-300">
                    Demo
                  </span>
                  <button
                    onClick={() => resetDemo.mutate()}
                    disabled={resetDemo.isPending}
                    className="rounded-lg border border-[var(--g-border)] bg-[var(--g-surface-2)] px-2.5 py-1.5 text-xs font-medium text-[var(--g-text-dim)] hover:text-[var(--g-text)] disabled:opacity-50"
                  >
                    🧹 Reset demo
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => seedDemo.mutate()}
                  disabled={seedDemo.isPending}
                  className="rounded-lg border border-[var(--g-border)] bg-[var(--g-surface-2)] px-2.5 py-1.5 text-xs font-medium text-[var(--g-text-dim)] hover:text-[var(--g-text)] disabled:opacity-50"
                >
                  🎬 Seed demo day
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
