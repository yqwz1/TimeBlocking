import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '@timeblock/shared';
import { createDb } from '../db/client.js';
import { progressionLedger, progressionRewards } from '../db/schema.js';
import { baseWorkXp, claimReward, getProgressionDashboard, levelFromMasteryXp, recordProgressionFact, upsertReward } from './progression.js';

const settings: Settings = { ...DEFAULT_SETTINGS, timezone: 'UTC' };
const now = '2026-08-17T09:00:00.000Z'; // Monday onboarding window, so Season 1 can begin immediately.

describe('progression v2 formulas and ledger', () => {
  it('uses duration-based base XP with equivalent split totals before the daily cap', () => {
    expect(baseWorkXp(0)).toBe(1);
    expect(baseWorkXp(60)).toBe(12);
    expect(baseWorkXp(600)).toBe(24);
    expect(baseWorkXp(60)).toBe(baseWorkXp(30) + baseWorkXp(30));
  });

  it('has monotonic permanent mastery levels', () => {
    let last = 0;
    for (let xp = 0; xp < 10_000; xp += 13) {
      const current = levelFromMasteryXp(xp).level;
      expect(current).toBeGreaterThanOrEqual(last);
      last = current;
    }
  });

  it('is idempotent and never spends lifetime XP when a reward is claimed', () => {
    const db = createDb(':memory:');
    getProgressionDashboard(db, settings, now);
    recordProgressionFact(db, settings, { kind: 'block_completed', sourceId: 'b-1', plannedMinutes: 60, atUtc: now }, now);
    recordProgressionFact(db, settings, { kind: 'block_completed', sourceId: 'b-2', plannedMinutes: 30, atUtc: now }, now);
    const afterFirst = getProgressionDashboard(db, settings, now);
    recordProgressionFact(db, settings, { kind: 'block_completed', sourceId: 'b-2', plannedMinutes: 30, atUtc: now }, now);
    const before = getProgressionDashboard(db, settings, now);
    expect(before.lifetimeXp).toBe(afterFirst.lifetimeXp);
    db.insert(progressionLedger).values({ resource: 'credits', kind: 'test_grant', sourceId: 'credit-1', amount: 2, formulaVersion: 'gamification-v2.0', metadata: '{}', createdAtUtc: now }).run();
    upsertReward(db, { title: 'Coffee', description: '', icon: null, creditCost: 1, template: 'small', repeatable: true, cooldownDays: 0, active: true, realWorldPrice: null }, now);
    claimReward(db, db.select().from(progressionRewards).get()!.id, now);
    const afterClaim = getProgressionDashboard(db, settings, now);
    expect(afterClaim.lifetimeXp).toBe(before.lifetimeXp);
    expect(afterClaim.credits).toBe(before.credits + 1); // +2 test grant, then -1 reward claim
  });
});
