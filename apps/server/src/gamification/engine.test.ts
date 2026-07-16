import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '@timeblock/shared';
import { createDb } from '../db/client.js';
import { blockOutcomes, blocks } from '../db/schema.js';
import {
  applyDayResult,
  awardXp,
  ensureBackfill,
  evaluateDayResult,
  evaluatePendingDays,
  getSummary,
  levelFromXp,
  xpForBlock,
  xpForLevel,
} from './engine.js';

describe('xpForLevel / levelFromXp', () => {
  it('level 1 starts at 0 xp', () => {
    expect(xpForLevel(1)).toBe(0);
  });

  it('boundaries: 0 -> L1, 99 -> L1, 100 -> L2', () => {
    expect(levelFromXp(0).level).toBe(1);
    expect(levelFromXp(99).level).toBe(1);
    expect(levelFromXp(100).level).toBe(2);
  });

  it('is monotonic and xpIntoLevel + remaining sums to xpForNextLevel', () => {
    for (const xp of [0, 50, 100, 250, 300, 4500, 5000]) {
      const r = levelFromXp(xp);
      expect(r.xpIntoLevel).toBeGreaterThanOrEqual(0);
      expect(r.xpIntoLevel).toBeLessThan(r.xpForNextLevel);
      expect(xpForLevel(r.level) + r.xpIntoLevel).toBe(xp);
    }
    expect(levelFromXp(0).level).toBeLessThanOrEqual(levelFromXp(5000).level);
  });
});

describe('xpForBlock', () => {
  it('base amount for a short block', () => {
    expect(xpForBlock(0)).toBe(10);
  });
  it('scales with planned minutes', () => {
    expect(xpForBlock(30)).toBe(16);
    expect(xpForBlock(90)).toBe(28);
  });
  it('caps at 40', () => {
    expect(xpForBlock(150)).toBe(40);
    expect(xpForBlock(1000)).toBe(40);
  });
});

describe('evaluateDayResult', () => {
  it('zero planned is always rest, regardless of rule', () => {
    expect(evaluateDayResult({ done: 0, missed: 0, planned: 0 }, 'one_block')).toBe('rest');
    expect(evaluateDayResult({ done: 0, missed: 0, planned: 0 }, 'half_planned')).toBe('rest');
  });
  it('one_block: any done is met', () => {
    expect(evaluateDayResult({ done: 1, missed: 5, planned: 6 }, 'one_block')).toBe('met');
    expect(evaluateDayResult({ done: 0, missed: 2, planned: 2 }, 'one_block')).toBe('missed');
  });
  it('half_planned: exact 50% boundary counts as met', () => {
    expect(evaluateDayResult({ done: 1, missed: 1, planned: 2 }, 'half_planned')).toBe('met');
    expect(evaluateDayResult({ done: 1, missed: 2, planned: 3 }, 'half_planned')).toBe('missed');
  });
});

describe('applyDayResult', () => {
  const base = { current: 0, longest: 0, freezes: 0 };

  it('rest is a no-op', () => {
    const r = applyDayResult({ current: 5, longest: 5, freezes: 1 }, 'rest');
    expect(r).toEqual({ state: { current: 5, longest: 5, freezes: 1 }, outcome: 'rest', earnedFreeze: false, streakXp: 0 });
  });

  it('met increments streak and awards xp', () => {
    const r = applyDayResult(base, 'met');
    expect(r.state.current).toBe(1);
    expect(r.state.longest).toBe(1);
    expect(r.outcome).toBe('met');
    expect(r.streakXp).toBeGreaterThan(0);
  });

  it('earns a freeze every 7th consecutive day, capped at 3', () => {
    let state = base;
    let earnedCount = 0;
    for (let i = 0; i < 21; i++) {
      const r = applyDayResult(state, 'met');
      state = r.state;
      if (r.earnedFreeze) earnedCount++;
    }
    expect(state.current).toBe(21);
    expect(earnedCount).toBe(3); // days 7, 14, 21
    expect(state.freezes).toBe(3);
    // a 4th 7-multiple should not push past the cap
    const r22 = applyDayResult(state, 'met');
    const rNext7 = applyDayResult({ ...r22.state, current: 27 }, 'met'); // day 28
    expect(rNext7.state.freezes).toBeLessThanOrEqual(3);
  });

  it('a miss with a banked freeze consumes it and preserves the streak', () => {
    const r = applyDayResult({ current: 10, longest: 10, freezes: 1 }, 'missed');
    expect(r.outcome).toBe('freeze');
    expect(r.state.current).toBe(10);
    expect(r.state.freezes).toBe(0);
  });

  it('a miss without a freeze resets the streak', () => {
    const r = applyDayResult({ current: 10, longest: 10, freezes: 0 }, 'missed');
    expect(r.outcome).toBe('missed');
    expect(r.state.current).toBe(0);
  });
});

// ---------- DB-backed ----------

function testSettings(overrides: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, timezone: 'UTC', ...overrides };
}

describe('awardXp idempotency', () => {
  it('the same (kind, sourceId) only ever inserts one row', () => {
    const db = createDb(':memory:');
    const settings = testSettings();
    const now = '2026-01-01T12:00:00.000Z';
    const first = awardXp(db, settings, { kind: 'block_done', sourceId: 'block-1', amount: 20, dateLocal: '2026-01-01' }, now);
    const second = awardXp(db, settings, { kind: 'block_done', sourceId: 'block-1', amount: 20, dateLocal: '2026-01-01' }, now);
    expect(first).toBe(true);
    expect(second).toBe(false);
    const summary = getSummary(db, settings);
    expect(summary.totalXp).toBe(20);
  });

  it('is a no-op when gamification is disabled', () => {
    const db = createDb(':memory:');
    const settings = testSettings({ gamificationEnabled: false });
    const inserted = awardXp(db, settings, { kind: 'block_done', sourceId: 'block-1', amount: 20, dateLocal: '2026-01-01' }, '2026-01-01T12:00:00.000Z');
    expect(inserted).toBe(false);
  });
});

describe('evaluatePendingDays', () => {
  it('catches up over a multi-day offline gap and is a no-op on immediate re-run', () => {
    const db = createDb(':memory:');
    const settings = testSettings({ streakRule: 'one_block' });

    // Day 1: one done block (met). Day 2: nothing (rest). Day 3: one missed block (missed, no freeze banked).
    const mk = (id: string, start: string, end: string, status: 'done' | 'missed') =>
      db.insert(blocks).values({ id, startUtc: start, endUtc: end, status, createdAtUtc: start, updatedAtUtc: start }).run();
    mk('b1', '2026-01-01T09:00:00.000Z', '2026-01-01T09:30:00.000Z', 'done');
    mk('b3', '2026-01-03T09:00:00.000Z', '2026-01-03T09:30:00.000Z', 'missed');

    // First call initializes the cursor to "yesterday" of nowIso without judging anything.
    const firstChanged = evaluatePendingDays(db, settings, '2026-01-01T00:00:00.000Z');
    expect(firstChanged).toBe(false);

    // Now advance the clock to Jan 4 — three days (1,2,3) become pending.
    const changed = evaluatePendingDays(db, settings, '2026-01-04T08:00:00.000Z');
    expect(changed).toBe(true);

    const summary = getSummary(db, settings);
    // Day1 met (streak 1) then day3 missed with no freeze -> streak resets to 0.
    expect(summary.streak.current).toBe(0);
    expect(summary.streak.longest).toBe(1);

    // Re-running at the same nowIso must not double-judge already-evaluated days.
    const rerunChanged = evaluatePendingDays(db, settings, '2026-01-04T09:00:00.000Z');
    expect(rerunChanged).toBe(false);
    const summary2 = getSummary(db, settings);
    expect(summary2.totalXp).toBe(summary.totalXp);
  });
});

describe('backfill', () => {
  it('grants xp once from historical done outcomes and is idempotent across calls', () => {
    const db = createDb(':memory:');
    const settings = testSettings();
    db.insert(blockOutcomes)
      .values({ id: 'o1', kind: 'task', outcome: 'done', plannedMin: 30, recordedAtUtc: '2025-12-01T10:00:00.000Z' })
      .run();
    db.insert(blockOutcomes)
      .values({ id: 'o2', kind: 'task', outcome: 'done', plannedMin: 60, recordedAtUtc: '2025-12-02T10:00:00.000Z' })
      .run();

    ensureBackfill(db, settings, '2026-01-01T00:00:00.000Z');
    const summary = getSummary(db, settings);
    expect(summary.totalXp).toBe(16 + 22); // xpForBlock(30) + xpForBlock(60)

    ensureBackfill(db, settings, '2026-01-01T00:00:01.000Z');
    const summary2 = getSummary(db, settings);
    expect(summary2.totalXp).toBe(summary.totalXp);
  });
});
