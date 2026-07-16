import { DateTime } from 'luxon';
import type { BlockReason, ReasonCode } from '@timeblock/shared';
import { energyMatch, type EnergyIntervals, type TaskClass } from './energy.js';
import { ceilTo } from './slots.js';
import type { Interval, PlanTaskInput } from './types.js';

/**
 * Additive slot-scoring weights — the single tunable place, mirroring WEIGHTS in score.ts.
 * Phase 1 only uses `early`; later phases wire in the remaining terms so that a slot's
 * score is a sum of independent, explainable contributions.
 */
export const SLOT_WEIGHTS = {
  early: 3, // prefer earlier slots (keeps Phase-1 parity with earliest-fit)
  energy: 2, // deep/shallow work matched to peak/low windows (Phase 4)
  hour: 1, // learned hour-of-day success (Phase 5)
  batch: 0.5, // same-project adjacency / batching (Phase 4)
  contig: 1.5, // keep a task's chunks together (Phase 3)
  pressureBoost: 4, // multiplier on earliness when a deadline is tight (Phase 2)
};

export interface ScorePart {
  code: ReasonCode;
  value: number;
  detail?: string;
}

/**
 * Read-only context shared across all candidates in one placement. Later phases
 * add fields (energy windows, learned rates, same-project index) without changing
 * the call sites.
 */
export interface SlotContext {
  nowCeil: number;
  horizonEnd: number;
  granMs: number;
  bufMs: number;
  /** Per-task deadline pressure in [0,1]; inflates the earliness term (Phase 2+). */
  pressure?: number;
  /** Energy matching (Phase 4). Absent/off → term is skipped (no placement change). */
  energy?: { intervals: EnergyIntervals; taskClass: TaskClass } | null;
  /** Already-placed blocks of this task's project, for batching (Phase 4). */
  sameProjectBlocks?: Interval[];
  /** Learned hour-of-day success (Phase 5). Absent → term skipped. */
  hour?: { rates: number[]; confidence: number; tz: string } | null;
}

/**
 * Score a single candidate slot. The score is a sum of weighted parts; the parts
 * double as the raw material for user-facing reasons. Phase 1: earliness only, so
 * the score strictly decreases with start time — the max-scoring slot is exactly
 * the earliest one, preserving the old findSlot behavior.
 */
export function scoreSlot(cand: Interval, _task: PlanTaskInput | null, ctx: SlotContext): { score: number; parts: ScorePart[] } {
  const span = Math.max(ctx.granMs, ctx.horizonEnd - ctx.nowCeil);
  const earliness = clamp01(1 - (cand.start - ctx.nowCeil) / span);
  const earlyWeight = SLOT_WEIGHTS.early * (1 + SLOT_WEIGHTS.pressureBoost * (ctx.pressure ?? 0));
  const parts: ScorePart[] = [{ code: 'earliest_fit', value: earlyWeight * earliness }];

  // Energy match (deep work → peak windows, shallow → low windows).
  if (ctx.energy) {
    const m = energyMatch(cand, ctx.energy.taskClass, ctx.energy.intervals);
    parts.push({ code: 'energy_match', value: SLOT_WEIGHTS.energy * m });
  }

  // Learned hour-of-day success: bias toward hours the user actually follows through on.
  if (ctx.hour && ctx.hour.confidence > 0) {
    const h = DateTime.fromMillis(cand.start, { zone: ctx.hour.tz }).hour;
    const centered = (ctx.hour.rates[h] - 0.5) * 2; // [-1, 1]
    parts.push({ code: 'learned_hour', value: SLOT_WEIGHTS.hour * ctx.hour.confidence * centered });
  }

  // Batching: reward starting right after (or ending right before) a same-project block.
  if (ctx.sameProjectBlocks && ctx.sameProjectBlocks.length) {
    const near = ctx.bufMs + ctx.granMs;
    const adjacent = ctx.sameProjectBlocks.some(
      (b) =>
        (cand.start >= b.end && cand.start - b.end <= near) || (cand.end <= b.start && b.start - cand.end <= near),
    );
    if (adjacent) parts.push({ code: 'batching', value: SLOT_WEIGHTS.batch });
  }

  const score = parts.reduce((s, p) => s + p.value, 0);
  return { score, parts };
}

/**
 * Best granularity-aligned slot of `durMs` inside `free` (sorted, disjoint),
 * optionally bounded by [notBefore, notAfter]. Enumerates every aligned start,
 * scores it, and keeps the maximum — replacing only on a *strictly greater* score
 * so ties resolve to the earliest start. Returns null if nothing fits the bounds.
 */
export function findBestSlot(
  free: Interval[],
  durMs: number,
  granMs: number,
  notBefore: number | null,
  notAfter: number | null,
  task: PlanTaskInput | null,
  ctx: SlotContext,
): { slot: Interval; parts: ScorePart[] } | null {
  let best: { slot: Interval; parts: ScorePart[]; score: number } | null = null;

  for (const iv of free) {
    const from = ceilTo(Math.max(iv.start, notBefore ?? iv.start), granMs);
    for (let start = from; start + durMs <= iv.end; start += granMs) {
      if (notAfter != null && start + durMs > notAfter) break; // aligned starts only grow → done with this interval
      const cand: Interval = { start, end: start + durMs };
      const { score, parts } = scoreSlot(cand, task, ctx);
      if (!best || score > best.score) best = { slot: cand, parts, score };
    }
  }

  return best ? { slot: best.slot, parts: best.parts } : null;
}

/** Human labels for reason codes. Kept here so the engine and UI stay in sync. */
const REASON_LABELS: Record<ReasonCode, string> = {
  earliest_fit: 'Earliest open slot',
  sticky: 'Kept your existing time',
  preferred_start: 'Your preferred time',
  habit_window: "Inside the habit's window",
  weekly_target: 'Hits your weekly goal',
  deadline_pressure: 'Scheduled early — deadline is close',
  deadline_missed: 'No slot before the deadline',
  picked_today: 'You picked this for today',
  pinned: 'You pinned this in place',
  over_budget: 'Your day is full — placed anyway to hit the deadline',
  energy_match: 'Matched to your focus window',
  learned_hour: 'A time you usually follow through',
  learned_duration: 'Duration adjusted from your history',
  batching: 'Grouped with similar work',
  chunk: 'Part of a split task',
  objective_boost: 'Supports a weekly objective',
  forecast_risk: 'At risk of missing its deadline',
};

export function reason(code: ReasonCode, detail?: string): BlockReason {
  return detail ? { code, label: REASON_LABELS[code], detail } : { code, label: REASON_LABELS[code] };
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
