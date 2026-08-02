import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, type DB } from '../db/client.js';
import { wishlistBudgets, wishlistItems } from '../db/schema.js';
import { buildWishlistSummary, wishlistBudgetFit } from './service.js';

function insertItem(db: DB, overrides: Partial<typeof wishlistItems.$inferInsert> = {}) {
  const now = '2026-08-01T00:00:00.000Z';
  const row = { id: randomUUID(), title: 'Wish', status: 'considering', category: 'Other', priority: 1, goalIds: '[]', createdAtUtc: now, updatedAtUtc: now, ...overrides };
  db.insert(wishlistItems).values(row).run();
  return db.select().from(wishlistItems).all().find((item) => item.id === row.id)!;
}

describe('wishlist accounting', () => {
  let db: DB;
  beforeEach(() => { db = createDb(':memory:'); });

  it('separates actual, planned, and considering value', () => {
    db.insert(wishlistBudgets).values({ month: '2026-08', amountMinor: 100_000, updatedAtUtc: '2026-08-01T00:00:00Z' }).run();
    insertItem(db, { status: 'purchased', priceMinor: 20_000, actualPriceMinor: 18_000, purchasedAt: '2026-08-02' });
    insertItem(db, { status: 'planned', priceMinor: 25_000, targetDate: '2026-08-20', category: 'Games' });
    insertItem(db, { status: 'considering', priceMinor: 70_000, category: 'Games' });
    insertItem(db, { status: 'skipped', priceMinor: 500_000 });
    const summary = buildWishlistSummary(db, '2026-08');
    expect(summary.actualMinor).toBe(18_000);
    expect(summary.plannedMinor).toBe(25_000);
    expect(summary.remainingMinor).toBe(57_000);
    expect(summary.activeValueMinor).toBe(95_000);
    expect(summary.byCategory.find((entry) => entry.category === 'Games')).toEqual({ category: 'Games', valueMinor: 95_000, count: 2 });
  });

  it('uses the actual purchase price and keeps month boundaries isolated', () => {
    db.insert(wishlistBudgets).values({ month: '2026-08', amountMinor: 50_000, updatedAtUtc: '2026-08-01T00:00:00Z' }).run();
    insertItem(db, { status: 'purchased', priceMinor: 20_000, actualPriceMinor: 17_500, purchasedAt: '2026-07-31' });
    insertItem(db, { status: 'purchased', priceMinor: 20_000, actualPriceMinor: 21_500, purchasedAt: '2026-08-01' });
    expect(buildWishlistSummary(db, '2026-08').actualMinor).toBe(21_500);
  });

  it('classifies missing, over-budget, tight, and comfortable purchases', () => {
    const base = { month: '2026-08', currency: 'SAR', budgetMinor: 100_000, actualMinor: 20_000, plannedMinor: 20_000, committedMinor: 40_000, remainingMinor: 60_000, activeValueMinor: 0, missingPriceCount: 0, byCategory: [], verdictCounts: [], monthly: [] };
    expect(wishlistBudgetFit({ id: 'a', priceMinor: null, status: 'considering', targetDate: null }, base)).toBe('needs_data');
    expect(wishlistBudgetFit({ id: 'a', priceMinor: 70_000, status: 'considering', targetDate: null }, base)).toBe('over_budget');
    expect(wishlistBudgetFit({ id: 'a', priceMinor: 45_000, status: 'considering', targetDate: null }, base)).toBe('tight');
    expect(wishlistBudgetFit({ id: 'a', priceMinor: 20_000, status: 'considering', targetDate: null }, base)).toBe('fits');
  });
});
